import { readFile, readdir, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const cliSourceDir = path.resolve('packages/cli/src');
const engineSourceDir = path.resolve('packages/engine/src');
const rootManifestPath = path.resolve('package.json');
const cliManifestPath = path.resolve('packages/cli/package.json');
const engineManifestPath = path.resolve('packages/engine/package.json');

// The engine is an internal workspace package that is bundled into the CLI at
// build time rather than installed by consumers, so its own runtime imports
// still have to be declared by whichever package ships them.
const ENGINE_PACKAGE = '@open-ocr/engine';

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  openOcrBuild?: {
    bundledDependencies?: string[];
  };
}

interface ImportedPackage {
  packageName: string;
  importer: string;
}

interface ImportGraph {
  packages: ImportedPackage[];
  unresolvedEngineSpecifiers: string[];
}

const nodeBuiltins = new Set(builtinModules);

const importPatterns: { pattern: RegExp; typeOnly: boolean }[] = [
  { pattern: /^[ \t]*import\s+type\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, typeOnly: true },
  { pattern: /^[ \t]*export\s+type\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, typeOnly: true },
  { pattern: /^[ \t]*import\s+(?!type\s)[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, typeOnly: false },
  { pattern: /^[ \t]*export\s+(?!type\s)[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, typeOnly: false },
  { pattern: /^[ \t]*import\s+['"]([^'"]+)['"]/gm, typeOnly: false },
  { pattern: /\bimport\s*\(\s*['"]([^'"]+)['"]/g, typeOnly: false },
];

function isTestFile(filePath: string): boolean {
  return filePath.endsWith('.test.ts');
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
    } else if (entry.name.endsWith('.ts') && !isTestFile(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function firstExistingFile(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function resolveRelativeSpecifier(importer: string, specifier: string): Promise<string | null> {
  const base = path.resolve(path.dirname(importer), specifier);
  return firstExistingFile(
    base.endsWith('.ts') ? [base] : [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')],
  );
}

function isEngineSpecifier(specifier: string): boolean {
  return specifier === ENGINE_PACKAGE || specifier.startsWith(`${ENGINE_PACKAGE}/`);
}

/**
 * Mirrors the "exports" map in packages/engine/package.json: the barrel
 * subpaths resolve to `src/<dir>/index.ts` and the `./*` pattern resolves to
 * `src/<subpath>.ts`. Keeping this in step with the manifest is what lets the
 * CLI graph walk keep collecting the engine's transitive runtime packages.
 */
async function resolveEngineSpecifier(specifier: string): Promise<string | null> {
  const subpath = specifier.slice(ENGINE_PACKAGE.length + 1);
  if (!subpath) {
    return null;
  }
  const base = path.join(engineSourceDir, subpath);
  return firstExistingFile([`${base}.ts`, path.join(base, 'index.ts')]);
}

function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function readImports(source: string): { specifier: string; typeOnly: boolean }[] {
  const imports: { specifier: string; typeOnly: boolean }[] = [];
  for (const { pattern, typeOnly } of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push({ specifier: match[1], typeOnly });
    }
  }
  return imports;
}

async function readManifest(manifestPath: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest;
}

/**
 * Every non-test file is a graph root: `mcp.ts` is only reachable through a
 * dynamic import. When `followEngine` is set the walk crosses the
 * `@open-ocr/engine` package boundary, because the engine is bundled into the
 * CLI executable and so its runtime imports are the CLI's to declare.
 */
async function collectImportGraph(sourceDir: string, followEngine: boolean): Promise<ImportGraph> {
  const queue = await collectSourceFiles(sourceDir);
  const visited = new Set(queue);
  const packages = new Map<string, string>();
  const unresolvedEngineSpecifiers: string[] = [];

  const enqueue = (resolved: string | null): void => {
    if (resolved && !isTestFile(resolved) && !visited.has(resolved)) {
      visited.add(resolved);
      queue.push(resolved);
    }
  };

  for (let index = 0; index < queue.length; index += 1) {
    const filePath = queue[index];
    const source = await readFile(filePath, 'utf8');
    for (const { specifier, typeOnly } of readImports(source)) {
      if (specifier.startsWith('.')) {
        enqueue(await resolveRelativeSpecifier(filePath, specifier));
        continue;
      }
      if (followEngine && isEngineSpecifier(specifier)) {
        const resolved = await resolveEngineSpecifier(specifier);
        if (!resolved) {
          unresolvedEngineSpecifiers.push(
            `${specifier} (imported by ${path.relative(path.resolve(), filePath)}) does not resolve under ` +
              `the "exports" map in packages/engine/package.json`,
          );
          continue;
        }
        enqueue(resolved);
        continue;
      }
      // Type-only imports are erased at build time and need no runtime dependency.
      if (typeOnly || specifier.startsWith('node:')) {
        continue;
      }
      const packageName = packageNameOf(specifier);
      if (nodeBuiltins.has(packageName) || packages.has(packageName)) {
        continue;
      }
      packages.set(packageName, path.relative(path.resolve(), filePath));
    }
  }

  return {
    packages: [...packages]
      .map(([packageName, importer]) => ({ packageName, importer }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName)),
    unresolvedEngineSpecifiers: unresolvedEngineSpecifiers.sort(),
  };
}

function undeclaredPackages(
  imported: ImportedPackage[],
  manifest: PackageManifest,
  manifestPath: string,
): string[] {
  const declared = manifest.dependencies ?? {};
  const bundled = new Set(manifest.openOcrBuild?.bundledDependencies ?? []);
  return imported
    .filter(({ packageName }) => !(packageName in declared) && !bundled.has(packageName))
    .map(
      ({ packageName, importer }) =>
        `${packageName} (imported by ${importer}) is missing from ${manifestPath} "dependencies", ` +
        `and from "openOcrBuild.bundledDependencies"; declare it as an external dependency or ` +
        `explicitly allow it to be bundled`,
    );
}

function rangeMismatches(
  cliRanges: Record<string, string>,
  otherRanges: Record<string, string>,
  otherManifestPath: string,
): string[] {
  return Object.entries(cliRanges)
    .filter(([packageName, range]) => packageName in otherRanges && otherRanges[packageName] !== range)
    .map(
      ([packageName, range]) =>
        `${packageName}: ${otherManifestPath} declares "${otherRanges[packageName]}" but ` +
        `packages/cli/package.json declares "${range}"`,
    );
}

describe('CLI dependency manifests', () => {
  it('declares or explicitly bundles every runtime package the CLI imports', async () => {
    const [graph, cliManifest] = await Promise.all([
      collectImportGraph(cliSourceDir, true),
      readManifest(cliManifestPath),
    ]);

    expect(graph.unresolvedEngineSpecifiers).toEqual([]);
    expect(undeclaredPackages(graph.packages, cliManifest, 'packages/cli/package.json')).toEqual([]);
  });

  it('keeps the internal engine out of the published runtime dependencies', async () => {
    const cliManifest = await readManifest(cliManifestPath);

    // The engine is private and never published, so a consumer install must
    // never be asked to fetch it. It is a devDependency for the workspace link
    // and an explicit bundle allowlist entry for tsup (see tsup.config.ts).
    expect(cliManifest.dependencies ?? {}).not.toHaveProperty(ENGINE_PACKAGE);
    expect(cliManifest.devDependencies ?? {}).toHaveProperty(ENGINE_PACKAGE);
    expect(cliManifest.openOcrBuild?.bundledDependencies ?? []).toContain(ENGINE_PACKAGE);
  });

  it('pins shared packages to the same range across the workspace manifests', async () => {
    const [rootManifest, cliManifest, engineManifest] = await Promise.all([
      readManifest(rootManifestPath),
      readManifest(cliManifestPath),
      readManifest(engineManifestPath),
    ]);
    const cliRanges = cliManifest.dependencies ?? {};

    expect(
      rangeMismatches(
        cliRanges,
        { ...rootManifest.dependencies, ...rootManifest.devDependencies },
        'root package.json',
      ),
    ).toEqual([]);
    expect(
      rangeMismatches(
        cliRanges,
        { ...engineManifest.dependencies, ...engineManifest.devDependencies },
        'packages/engine/package.json',
      ),
    ).toEqual([]);
  });
});

describe('engine dependency manifest', () => {
  it('declares every runtime package the engine imports', async () => {
    const [graph, engineManifest] = await Promise.all([
      collectImportGraph(engineSourceDir, false),
      readManifest(engineManifestPath),
    ]);

    expect(undeclaredPackages(graph.packages, engineManifest, 'packages/engine/package.json')).toEqual([]);
  });
});
