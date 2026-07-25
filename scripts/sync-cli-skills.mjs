import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'integrations', 'open-ocr', 'skills');
const destination = path.join(root, 'packages', 'cli', 'skills');

async function collectEntries(directory, prefix = '', entries = new Map()) {
  let contents;
  try {
    contents = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return entries;
    throw error;
  }
  for (const entry of contents) {
    const relative = path.join(prefix, entry.name);
    entries.set(relative, entry.isDirectory() ? 'directory' : 'file');
    if (entry.isDirectory()) await collectEntries(path.join(directory, entry.name), relative, entries);
  }
  return entries;
}

const sourceStats = await stat(source).catch(() => null);
if (!sourceStats?.isDirectory()) {
  throw new Error(`Skill source directory is missing: ${path.relative(root, source)}`);
}

const sourceEntries = await collectEntries(source);
const stale = [...await collectEntries(destination)].filter(([relative, kind]) => sourceEntries.get(relative) !== kind);
for (const [relative] of stale) {
  await rm(path.join(destination, relative), { recursive: true, force: true });
}

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });

const removed = stale.length ? `, removed ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'}` : '';
process.stdout.write(`Synced ${sourceEntries.size} skill entries to ${path.relative(root, destination)}${removed}\n`);
