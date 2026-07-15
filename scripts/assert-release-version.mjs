import { readFileSync } from 'node:fs';

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag?.startsWith('v')) throw new Error('Release tag must be supplied as v<version>');
const expected = tag.slice(1);
for (const file of ['package.json', 'packages/cli/package.json', 'package-lock.json']) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed.version !== expected) throw new Error(`${file} version ${parsed.version} does not match ${tag}`);
}
process.stdout.write(`Release versions match ${tag}\n`);
