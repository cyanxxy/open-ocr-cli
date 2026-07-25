export interface BatchLockOwner {
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  startedAt: string;
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function parseBatchLockOwner(value: unknown): BatchLockOwner | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const owner = value as Record<string, unknown>;
  if (
    owner.version !== 1
    || typeof owner.token !== 'string'
    || owner.token.length === 0
    || typeof owner.pid !== 'number'
    || !Number.isInteger(owner.pid)
    || owner.pid <= 0
    || typeof owner.hostname !== 'string'
    || owner.hostname.length === 0
    || !isIsoTimestamp(owner.startedAt)
  ) return undefined;
  return {
    version: 1,
    token: owner.token,
    pid: owner.pid,
    hostname: owner.hostname,
    startedAt: owner.startedAt,
  };
}
