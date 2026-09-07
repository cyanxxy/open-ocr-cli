import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { renderEvalSummaryMarkdown, type EvalRunSummary } from '@open-ocr/engine/evals';
import { reportsDir } from './shared';

async function main() {
  const latestJsonPath = path.resolve(reportsDir, 'latest.json');
  const raw = await fs.readFile(latestJsonPath, 'utf8');
  const summary = JSON.parse(raw) as EvalRunSummary;
  const markdown = renderEvalSummaryMarkdown(summary);
  await fs.writeFile(path.resolve(reportsDir, 'latest.md'), markdown, 'utf8');
  console.log(`Rendered ${path.relative(process.cwd(), path.resolve(reportsDir, 'latest.md'))}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
