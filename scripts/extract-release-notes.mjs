import { readFileSync, writeFileSync } from 'node:fs';

const tag = process.argv[2];
const outputPath = process.argv[3];

if (!tag?.startsWith('v')) {
  throw new Error('Release tag must be supplied as v<version>');
}
if (!outputPath) {
  throw new Error('Release-notes output path is required');
}

const version = tag.slice(1);
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const heading = `## ${version} - `;
const start = changelog.indexOf(heading);
if (start < 0) {
  throw new Error(`CHANGELOG.md has no release section for ${version}`);
}

const next = changelog.indexOf('\n## ', start + heading.length);
const notes = changelog.slice(start, next < 0 ? undefined : next).trim();
if (!notes.includes('\n### ') || !notes.includes('[Full comparison](')) {
  throw new Error(`CHANGELOG.md release section for ${version} is incomplete`);
}

writeFileSync(outputPath, `${notes}\n`, 'utf8');
process.stdout.write(`Prepared GitHub release notes for ${tag}\n`);
