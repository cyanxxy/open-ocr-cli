import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { EvalRunSummary } from '../src/lib/evals';
import { GATEWAY_IDS, PROVIDER_IDS } from '../src/lib/providers';
import { repoRoot, reportsDir, resolveSuiteName } from './shared';

interface MatrixEntry {
  id: string;
  provider: string;
  model: string;
  gateway?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  cloudflareProvider?: string;
}

interface MatrixConfig {
  providers: MatrixEntry[];
}

interface MatrixResult {
  entry: MatrixEntry;
  exitCode: number;
  summary?: EvalRunSummary;
  error?: string;
}

function runChild(entry: MatrixEntry, suite: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'evals/run.ts', '--suite', suite], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        EVAL_PROVIDER: entry.provider,
        EVAL_GATEWAY: entry.gateway ?? 'direct',
        OPEN_OCR_MODEL: entry.model,
        ...(entry.apiKeyEnv ? { EVAL_API_KEY_ENV: entry.apiKeyEnv } : {}),
        ...(entry.baseUrl ? { OPEN_OCR_BASE_URL: entry.baseUrl } : {}),
        ...(entry.cloudflareProvider ? { CLOUDFLARE_AI_GATEWAY_PROVIDER: entry.cloudflareProvider } : {}),
      },
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

function matrixMarkdown(results: MatrixResult[], suite: string): string {
  return `${[
    '# Multi-provider OCR Evaluation',
    '',
    `Suite: \`${suite}\``,
    '',
    '| Run | Provider | Gateway | Model | Cases | Pass rate | Score | Status |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- |',
    ...results.map(({ entry, summary, exitCode }) => `| ${[
      entry.id,
      entry.provider,
      entry.gateway ?? 'direct',
      `\`${entry.model}\``,
      summary?.totalCases ?? '-',
      summary ? `${(summary.passRate * 100).toFixed(1)}%` : '-',
      summary ? `${(summary.weightedScore * 100).toFixed(1)}%` : '-',
      exitCode === 0 ? 'passed' : summary?.status ?? 'runtime failed',
    ].join(' | ')} |`),
    '',
  ].join('\n')}\n`;
}

async function main(): Promise<void> {
  const suite = resolveSuiteName();
  const dryRun = process.argv.includes('--dry-run');
  const configPath = path.resolve(
    repoRoot,
    process.env.EVAL_MATRIX_CONFIG ?? 'evals/providers.example.json',
  );
  const parsed = JSON.parse(await fs.readFile(configPath, 'utf8')) as MatrixConfig;
  if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
    throw new Error('Eval matrix config must contain a non-empty providers array');
  }
  const ids = new Set<string>();
  for (const entry of parsed.providers) {
    if (!entry.id || ids.has(entry.id)) throw new Error(`Eval matrix provider id must be unique: ${entry.id}`);
    ids.add(entry.id);
    if (!PROVIDER_IDS.includes(entry.provider as (typeof PROVIDER_IDS)[number])) {
      throw new Error(`Unsupported matrix provider: ${entry.provider}`);
    }
    if (!GATEWAY_IDS.includes((entry.gateway ?? 'direct') as (typeof GATEWAY_IDS)[number])) {
      throw new Error(`Unsupported matrix gateway: ${entry.gateway}`);
    }
    if (!entry.model) throw new Error(`Matrix entry ${entry.id} requires a model`);
  }
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ valid: true, suite, providers: parsed.providers }, null, 2)}\n`);
    return;
  }
  const results: MatrixResult[] = [];
  const matrixDirectory = path.join(reportsDir, 'matrix');
  await fs.mkdir(matrixDirectory, { recursive: true });
  for (const entry of parsed.providers) {
    process.stdout.write(`\n=== ${entry.id}: ${entry.provider}/${entry.model} ===\n`);
    await fs.rm(path.join(reportsDir, 'latest.json'), { force: true });
    const exitCode = await runChild(entry, suite);
    let summary: EvalRunSummary | undefined;
    let error: string | undefined;
    try {
      summary = JSON.parse(await fs.readFile(path.join(reportsDir, 'latest.json'), 'utf8')) as EvalRunSummary;
      await fs.writeFile(
        path.join(matrixDirectory, `${entry.id}.json`),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8',
      );
    } catch (readError) {
      error = readError instanceof Error ? readError.message : String(readError);
    }
    results.push({ entry, exitCode, summary, error });
  }
  await fs.writeFile(path.join(reportsDir, 'matrix-latest.json'), `${JSON.stringify({ suite, results }, null, 2)}\n`);
  await fs.writeFile(path.join(reportsDir, 'matrix-latest.md'), matrixMarkdown(results, suite));
  if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
