import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  BatchSummary,
  CliManifest,
  ManifestEntry,
  OcrArtifacts,
  OcrJobResult,
  ResolvedCliOptions,
  ResolvedInput,
} from './types';

const EMPTY_MANIFEST: CliManifest = { version: 1, entries: {} };

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function primaryArtifact(artifacts: OcrArtifacts, format: ResolvedCliOptions['format']): string {
  if (format === 'json') return `${JSON.stringify(artifacts.json, null, 2)}\n`;
  if (format === 'csv') {
    if (!artifacts.csv) throw new Error('This extraction did not produce tabular CSV output');
    return `${artifacts.csv.replace(/\n?$/, '\n')}`;
  }
  if (!artifacts.markdown) throw new Error('This extraction did not produce Markdown output');
  return artifacts.markdown.replace(/\n?$/, '\n');
}

function artifactEntries(artifacts: OcrArtifacts, format: ResolvedCliOptions['format']): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if ((format === 'markdown' || format === 'all') && artifacts.markdown) {
    entries.push(['md', artifacts.markdown.replace(/\n?$/, '\n')]);
  }
  if ((format === 'json' || format === 'all') && artifacts.json) {
    entries.push(['json', `${JSON.stringify(artifacts.json, null, 2)}\n`]);
  }
  if ((format === 'csv' || format === 'all') && artifacts.csv) {
    entries.push(['csv', artifacts.csv.replace(/\n?$/, '\n')]);
  }
  if (format === 'all' && artifacts.agentSteps) {
    entries.push(['steps.json', `${JSON.stringify(artifacts.agentSteps, null, 2)}\n`]);
  }
  if (format === 'csv' && !artifacts.csv) throw new Error('This extraction did not produce tabular CSV output');
  if (entries.length === 0) throw new Error(`No artifact is available for format ${format}`);
  return entries;
}

function safeOutputRelative(input: ResolvedInput): string {
  const normalized = input.relativePath.replaceAll('\\', '/');
  const parsed = path.posix.parse(normalized);
  const safeDirectory = parsed.dir
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join(path.sep);
  return path.join(safeDirectory, parsed.name);
}

export function defaultOutputDirectory(options: ResolvedCliOptions): string {
  return path.resolve(options.cwd, options.output ?? 'gemini-ocr-output');
}

export async function writeArtifacts(
  input: ResolvedInput,
  artifacts: OcrArtifacts,
  options: ResolvedCliOptions,
  totalInputs: number,
): Promise<string[]> {
  const entries = artifactEntries(artifacts, options.format);
  const explicitSingleFile = totalInputs === 1
    && Boolean(options.output)
    && options.format !== 'all'
    && Boolean(path.extname(options.output!))
    && !(await pathExists(path.resolve(options.cwd, options.output!))
      && (await fs.stat(path.resolve(options.cwd, options.output!))).isDirectory());

  const targets = explicitSingleFile
    ? [[path.resolve(options.cwd, options.output!), entries[0][1]] as const]
    : entries.map(([extension, content]) => [
        path.join(defaultOutputDirectory(options), `${safeOutputRelative(input)}.${extension}`),
        content,
      ] as const);

  for (const [target] of targets) {
    if (!options.overwrite && await pathExists(target)) throw new Error(`Output already exists: ${target} (use --overwrite)`);
  }
  for (const [target, content] of targets) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { encoding: 'utf8', flag: options.overwrite ? 'w' : 'wx' });
  }
  return targets.map(([target]) => target);
}

export class ManifestStore {
  private readonly manifestPath: string;
  private manifest: CliManifest = { ...EMPTY_MANIFEST, entries: {} };
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(outputDirectory: string) {
    this.manifestPath = path.join(outputDirectory, '.gemini-ocr-manifest.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CliManifest>;
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        this.manifest = { version: 1, entries: parsed.entries };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async completed(key: string, fingerprint: string): Promise<boolean> {
    const entry = this.manifest.entries[key];
    if (
      !entry
      || (entry.status !== 'succeeded' && entry.status !== 'partial')
      || entry.fingerprint !== fingerprint
    ) return false;
    return (await Promise.all(entry.outputFiles.map(pathExists))).every(Boolean);
  }

  update(key: string, entry: ManifestEntry): Promise<void> {
    this.manifest.entries[key] = entry;
    this.pendingWrite = this.pendingWrite.then(async () => {
      await fs.mkdir(path.dirname(this.manifestPath), { recursive: true });
      const temporary = `${this.manifestPath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(this.manifest, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, this.manifestPath);
    });
    return this.pendingWrite;
  }
}

export async function writeBatchSummary(summary: BatchSummary, outputDirectory: string): Promise<string> {
  await fs.mkdir(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, 'batch-summary.json');
  await fs.writeFile(target, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return target;
}

export function jsonlResult(result: OcrJobResult): string {
  return JSON.stringify({
    type: 'document',
    status: result.status,
    source: result.input.displayPath,
    mode: result.mode,
    model: result.model,
    durationMs: result.durationMs,
    attempts: result.attempts,
    outputFiles: result.outputFiles,
    output: result.artifacts
      ? {
          markdown: result.artifacts.markdown,
          json: result.artifacts.json,
          csv: result.artifacts.csv,
        }
      : undefined,
    error: result.error,
  });
}
