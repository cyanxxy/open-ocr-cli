/**
 * The one place every numeric request bound is declared.
 *
 * The request JSON Schema, the MCP tool schemas, the option resolver, and the
 * `capabilities` document all state these ranges. They used to each carry a
 * private copy, and nothing tied the copies together: the schema could accept
 * a value the resolver refused, and `capabilities` published only a subset, so
 * an agent still had to read the schema to learn a ceiling. `protocol.test.ts`
 * asserts the bundled request schema matches this table, and the other three
 * read from it directly.
 */
export interface NumericRange {
  min: number;
  max: number;
}

export const OCR_REQUEST_LIMITS = {
  concurrency: { min: 1, max: 16 },
  retries: { min: 0, max: 10 },
  timeoutSeconds: { min: 1, max: 3600 },
  maxFiles: { min: 1, max: 100_000 },
  maxTotalMb: { min: 1, max: 1_048_576 },
  maxCostUsd: { min: 0.000001, max: 1_000_000 },
  requestsPerMinute: { min: 0, max: 60_000 },
  maxTokens: { min: 256, max: 1_048_576 },
  maxIterations: { min: 1, max: 20 },
  confidenceThreshold: { min: 0, max: 1 },
  /** URL inputs per request; also the `web` command's argument ceiling. */
  urlInputs: { min: 1, max: 20 },
} as const satisfies Record<string, NumericRange>;

export type OcrRequestLimitKey = keyof typeof OCR_REQUEST_LIMITS;

/** Custom price-per-million ceilings, shared by the flag and config surfaces. */
export const PRICE_PER_MILLION_LIMIT: NumericRange = { min: 0, max: 1_000_000 };
