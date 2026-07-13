import { getGeminiUsage } from './usage';

export interface GeminiRequestPolicy {
  requestsPerMinute?: number;
  maxCostUsd?: number;
}

let intervalMs = 0;
let maxCostUsd: number | undefined;
let previousRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

export class GeminiCostLimitError extends Error {
  constructor(limitUsd: number) {
    super(`Estimated Gemini cost reached the configured limit of $${limitUsd.toFixed(6)}`);
    this.name = 'GeminiCostLimitError';
  }
}

export function isGeminiCostLimitError(error: unknown): error is GeminiCostLimitError {
  return error instanceof GeminiCostLimitError;
}

export function configureGeminiRequestPolicy(policy: GeminiRequestPolicy): void {
  const requestsPerMinute = policy.requestsPerMinute ?? 0;
  intervalMs = requestsPerMinute > 0 ? 60_000 / requestsPerMinute : 0;
  maxCostUsd = policy.maxCostUsd;
  previousRequestAt = 0;
  queue = Promise.resolve();
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError');
}

function assertRequestAllowed(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
  if (maxCostUsd !== undefined && getGeminiUsage().estimatedCostUsd >= maxCostUsd) {
    throw new GeminiCostLimitError(maxCostUsd);
  }
}

function awaitWithAbort(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      () => { cleanup(); resolve(); },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function resetGeminiRequestPolicy(): void {
  configureGeminiRequestPolicy({});
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Queue one request start so all Gemini API surfaces share the same RPM cap. */
export async function waitForGeminiRequestSlot(signal?: AbortSignal): Promise<void> {
  assertRequestAllowed(signal);
  if (intervalMs === 0) return;

  let release: () => void = () => undefined;
  const previous = queue;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired = false;
  try {
    await awaitWithAbort(previous, signal);
    acquired = true;
    assertRequestAllowed(signal);
    const delayMs = Math.max(0, previousRequestAt + intervalMs - Date.now());
    await wait(delayMs, signal);
    assertRequestAllowed(signal);
    previousRequestAt = Date.now();
  } finally {
    if (acquired) release();
    else void previous.finally(release);
  }
}
