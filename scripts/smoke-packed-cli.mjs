import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'open-ocr-cli-pack-'));

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

try {
  const tarballName = run('npm', ['pack', './packages/cli', '--pack-destination', temporary]).trim().split(/\r?\n/).at(-1);
  if (!tarballName) throw new Error('npm pack did not report a tarball');
  const installDirectory = path.join(temporary, 'install');
  mkdirSync(installDirectory);
  writeFileSync(path.join(installDirectory, 'package.json'), '{"private":true}\n');
  run('npm', ['install', path.join(temporary, tarballName)], installDirectory);
  const binaryDirectory = path.join(installDirectory, 'node_modules', '.bin');
  const executable = path.join(binaryDirectory, process.platform === 'win32' ? 'open-ocr-cli.cmd' : 'open-ocr-cli');
  const alias = path.join(binaryDirectory, process.platform === 'win32' ? 'gemini-ocr.cmd' : 'gemini-ocr');
  const help = run(executable, ['--help']);
  if (!help.includes('Provider-neutral multimodal OCR')) throw new Error('Packed CLI help did not contain the expected identity');
  const providers = JSON.parse(run(executable, ['providers', '--json']));
  if (!Array.isArray(providers) || !providers.some((entry) => entry.id === 'openrouter')) {
    throw new Error('Packed CLI did not expose the OpenRouter provider');
  }
  run(alias, ['--version']);
  run(executable, [
    'extract',
    path.join(root, 'evals', 'corpus', 'raster', 'invoice.png'),
    '--provider',
    'kimi',
    '--dry-run',
    '--quiet',
  ]);
  process.stdout.write(`Packed install smoke passed: ${tarballName}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
