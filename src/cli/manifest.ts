import type { CliManifest, ManifestEntry } from './types';
import { asRecord, isIsoTimestamp } from './jsonValidation';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Parse the on-disk resume manifest without trusting user-editable JSON. */
export function parseCliManifest(value: unknown, manifestPath: string): CliManifest {
  const record = asRecord(value, manifestPath);
  if (record.version !== 1) throw new Error(`Unsupported manifest version in ${manifestPath}`);
  const rawEntries = asRecord(record.entries, `${manifestPath}: entries`);
  const entries: Record<string, ManifestEntry> = {};

  for (const [source, rawEntry] of Object.entries(rawEntries)) {
    if (source.length === 0) throw new Error(`${manifestPath} has an empty source key`);
    const entry = asRecord(rawEntry, `${manifestPath}: entry ${source}`);
    if (entry.status !== 'succeeded' && entry.status !== 'partial' && entry.status !== 'failed') {
      throw new Error(`${manifestPath}: entry ${source} has an invalid status`);
    }
    if (!isStringArray(entry.outputFiles) || entry.outputFiles.some((file) => file.length === 0)) {
      throw new Error(`${manifestPath}: entry ${source} has invalid outputFiles`);
    }
    if (entry.status !== 'failed' && entry.outputFiles.length === 0) {
      throw new Error(`${manifestPath}: entry ${source} has no resumable output files`);
    }
    if (
      typeof entry.fingerprint !== 'string'
      || entry.fingerprint.length === 0
      || !isIsoTimestamp(entry.completedAt)
    ) {
      throw new Error(`${manifestPath}: entry ${source} is incomplete`);
    }
    if (entry.error !== undefined && typeof entry.error !== 'string') {
      throw new Error(`${manifestPath}: entry ${source} has an invalid error`);
    }
    entries[source] = {
      fingerprint: entry.fingerprint,
      status: entry.status,
      outputFiles: [...entry.outputFiles],
      completedAt: entry.completedAt,
      ...(entry.error !== undefined ? { error: entry.error } : {}),
    };
  }

  return { version: 1, entries };
}
