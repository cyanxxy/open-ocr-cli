import { readFile, readdir, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const cliSourceDir = path.resolve('packages/cli/src');
const rootManifestPath = path.resolve('package.json');
const cliManifestPath = path.resolve('packages/cli/package.json');

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ImportedPackage {
  packageName: string;
  importer: string;
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

async function resolveRelativeSpecifier(importer: string, specifier: string): Promise<string | null> {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = base.endsWith('.ts')
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return null;
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

// Every non-test file is a graph root: `mcp.ts` is only reachable through a dynamic import.
async function collectImportedPackages(): Promise<ImportedPackage[]> {
  const queue = await collectSourceFiles(cliSourceDir);
  const visited = new Set(queue);
  const packages = new Map<string, string>();

  for (let index = 0; index < queue.length; index += 1) {
    const filePath = queue[index];
    const source = await readFile(filePath, 'utf8');
    for (const { specifier, typeOnly } of readImports(source)) {
      if (specifier.startsWith('.')) {
        const resolved = await resolveRelativeSpecifier(filePath, specifier);
        if (resolved && !isTestFile(resolved) && !visited.has(resolved)) {
          visited.add(resolved);
          queue.push(resolved);
        }
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

  return [...packages]
    .map(([packageName, importer]) => ({ packageName, importer }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

describe('CLI dependency manifests', () => {
  it('declares every runtime package the CLI imports', async () => {
    const [imported, cliManifest] = await Promise.all([
      collectImportedPackages(),
      readManifest(cliManifestPath),
    ]);
    const declared = cliManifest.dependencies ?? {};

    const undeclared = imported
      .filter(({ packageName }) => !(packageName in declared))
      .map(
        ({ packageName, importer }) =>
          `${packageName} (imported by ${importer}) is missing from packages/cli/package.json "dependencies", ` +
          `so tsup would silently bundle it into packages/cli/dist instead of leaving it external; ` +
          `add "${packageName}" to packages/cli/package.json "dependencies"`,
      );

    expect(undeclared).toEqual([]);
  });

  it('pins shared packages to the same range in both manifests', async () => {
    const [rootManifest, cliManifest] = await Promise.all([
      readManifest(rootManifestPath),
      readManifest(cliManifestPath),
    ]);
    const rootRanges = { ...rootManifest.dependencies, ...rootManifest.devDependencies };
    const cliRanges = cliManifest.dependencies ?? {};

    const mismatches = Object.entries(cliRanges)
      .filter(([packageName, range]) => packageName in rootRanges && rootRanges[packageName] !== range)
      .map(
        ([packageName, range]) =>
          `${packageName}: root package.json declares "${rootRanges[packageName]}" but ` +
          `packages/cli/package.json declares "${range}"`,
      );

    expect(mismatches).toEqual([]);
  });
});
