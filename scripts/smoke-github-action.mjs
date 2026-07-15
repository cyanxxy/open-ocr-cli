import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'open-ocr-action-'));

function run(command, args, cwd = root, env = process.env) {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

try {
  const packageDirectory = path.join(temporary, 'package');
  mkdirSync(packageDirectory);
  const tarballName = run('npm', ['pack', './packages/cli', '--pack-destination', packageDirectory])
    .trim()
    .split(/\r?\n/)
    .at(-1);
  if (!tarballName) throw new Error('npm pack did not report a tarball');
  const outputDirectory = path.join(temporary, 'output');
  run('bash', [path.join(root, 'scripts', 'github-action.sh')], root, {
    ...process.env,
    OPEN_OCR_ACTION_INPUTS: `${path.join(root, 'evals', 'corpus', 'raster', 'invoice.png')}\n`,
    OPEN_OCR_ACTION_PROVIDER: 'kimi',
    OPEN_OCR_ACTION_MODEL: 'kimi-k2.6',
    OPEN_OCR_ACTION_API_KEY_ENV: 'MOONSHOT_API_KEY',
    OPEN_OCR_ACTION_BASE_URL: '',
    OPEN_OCR_ACTION_GATEWAY: 'cloudflare',
    OPEN_OCR_ACTION_CLOUDFLARE_ACCOUNT_ID: 'test-account',
    OPEN_OCR_ACTION_CLOUDFLARE_GATEWAY_ID: 'test-gateway',
    OPEN_OCR_ACTION_CLOUDFLARE_PROVIDER: 'moonshot',
    OPEN_OCR_ACTION_CLOUDFLARE_TOKEN_ENV: 'CLOUDFLARE_AI_GATEWAY_TOKEN',
    OPEN_OCR_ACTION_CLOUDFLARE_BYOK: 'true',
    OPEN_OCR_ACTION_CLOUDFLARE_BYOK_ALIAS: 'moonshot-production',
    OPEN_OCR_ACTION_MODE: 'simple',
    OPEN_OCR_ACTION_PRESET: '',
    OPEN_OCR_ACTION_FORMAT: 'markdown',
    OPEN_OCR_ACTION_OUTPUT: outputDirectory,
    OPEN_OCR_ACTION_VERSION: '2.0.0',
    OPEN_OCR_ACTION_DRY_RUN: 'true',
    OPEN_OCR_ACTION_PACKAGE: path.join(packageDirectory, tarballName),
  });
  if (existsSync(outputDirectory)) {
    throw new Error('Action wrapper dry run unexpectedly wrote an output directory');
  }
  process.stdout.write('GitHub Action wrapper smoke passed.\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
