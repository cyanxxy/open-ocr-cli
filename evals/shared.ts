import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateEvalCase, validateEvalSuiteConfig, type EvalCase, type EvalRunSummary, type EvalSuiteConfig } from '../src/lib/evals';

const evalsDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(evalsDir, '..');
export const reportsDir = path.resolve(repoRoot, 'evals', 'reports');

export async function loadEvalCases(): Promise<EvalCase[]> {
  const casesDir = path.resolve(repoRoot, 'evals', 'cases');
  const caseFiles = (await fs.readdir(casesDir))
    .filter((entry) => entry.endsWith('.json'))
    .sort();

  const cases = await Promise.all(caseFiles.map(async (entry) => {
    const filePath = path.resolve(casesDir, entry);
    const raw = await fs.readFile(filePath, 'utf8');
    return validateEvalCase(JSON.parse(raw));
  }));

  return cases;
}

export async function loadEvalSuiteConfig(): Promise<EvalSuiteConfig> {
  const configPath = path.resolve(repoRoot, 'evals', 'config.json');

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return validateEvalSuiteConfig(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function assertEvalInputsExist(evalCases: EvalCase[]): Promise<void> {
  for (const evalCase of evalCases) {
    const absoluteInputPath = path.resolve(repoRoot, evalCase.inputPath);
    await fs.access(absoluteInputPath);
  }
}

export function detectMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      throw new Error(`Unsupported eval input extension: ${extension}`);
  }
}

export async function fileToDataUrl(relativePath: string): Promise<{ dataUrl: string; mimeType: string }> {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const mimeType = detectMimeType(absolutePath);
  const bytes = await fs.readFile(absolutePath);
  return {
    dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
    mimeType,
  };
}

export async function writeEvalSummary(summary: EvalRunSummary, markdown: string): Promise<void> {
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(path.resolve(reportsDir, 'latest.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.resolve(reportsDir, 'latest.md'), markdown, 'utf8');
}

export function resolveModelName(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.5-flash';
}
