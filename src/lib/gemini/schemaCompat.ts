/**
 * Static compatibility check for JSON Schemas we send as `responseJsonSchema`.
 *
 * Structured output is served by constrained decoding: the provider compiles the
 * schema into a grammar before generating a single token. A schema the type
 * checker is perfectly happy with can still be rejected at request time with a
 * bare `400 INVALID_ARGUMENT` that names no field, so unit tests over the schema
 * builders cannot tell a working schema from a broken one. This module encodes
 * the two limits we have confirmed against the live API so those tests can.
 *
 * Evidence (gemini-3.1-flash-lite, text-only probes, 2026-07-26):
 *
 *   maxItems | items schema        | grammar cost | result
 *   ---------|---------------------|--------------|--------
 *   (none)   | 4-property object   | -            | accepted
 *   5        | 2-property object   | 10           | accepted
 *   50       | 2-property object   | 100          | accepted
 *   200      | string              | 200          | accepted
 *   200      | 2-property object   | 400          | INVALID_ARGUMENT
 *   500      | string              | 500          | INVALID_ARGUMENT
 *   500      | 4-property object   | 2000         | INVALID_ARGUMENT
 *
 * So an array bound is not rejected as a keyword; it is rejected once the bound
 * multiplied by the per-item complexity exceeds a budget that sits between 200
 * and 400. Prefer enforcing collection caps after parsing and leaving the bound
 * out of the wire schema entirely.
 */

/**
 * Schema keywords confirmed to survive grammar compilation. Anything outside
 * this set is treated as unproven rather than known-broken — extend it only
 * alongside a live probe that shows the keyword being accepted.
 */
export const VERIFIED_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'enum',
  'format',
  'description',
  'title',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'nullable',
]);

/**
 * Largest `bound x per-item complexity` product observed to compile. Chosen at
 * the top of the accepted range in the table above so the check fires before a
 * schema reaches the provider, not after.
 */
export const MAX_ARRAY_GRAMMAR_COST = 200;

export interface SchemaCompatibilityIssue {
  /** JSON-pointer-ish path to the offending node, e.g. `properties.rows`. */
  path: string;
  keyword: string;
  reason: string;
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Approximate the grammar a schema expands into, counting one unit per leaf
 * value the decoder must be able to emit. Deliberately coarse: it only has to
 * order schemas the same way the provider's own budget does.
 */
function schemaComplexity(schema: unknown): number {
  if (!isSchemaObject(schema)) {
    return 1;
  }

  const properties = schema.properties;
  if (isSchemaObject(properties)) {
    const propertyCost = Object.values(properties).reduce<number>(
      (total, child) => total + schemaComplexity(child),
      0,
    );
    return Math.max(1, propertyCost);
  }

  if (Array.isArray(schema.anyOf)) {
    return Math.max(1, ...schema.anyOf.map((child) => schemaComplexity(child)));
  }

  if (schema.items !== undefined) {
    return schemaComplexity(schema.items);
  }

  return 1;
}

/**
 * Walk a `responseJsonSchema` and report constructs that have not been shown to
 * survive the provider's grammar compilation. An empty array means the schema
 * uses only verified constructs — not that the provider is guaranteed to accept
 * it, but that it avoids every rejection we have actually reproduced.
 */
export function findSchemaCompatibilityIssues(
  schema: unknown,
  path = '',
): SchemaCompatibilityIssue[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((entry, index) => findSchemaCompatibilityIssues(entry, `${path}[${index}]`));
  }

  if (!isSchemaObject(schema)) {
    return [];
  }

  const issues: SchemaCompatibilityIssue[] = [];
  const at = (key: string) => (path ? `${path}.${key}` : key);

  for (const keyword of Object.keys(schema)) {
    if (!VERIFIED_SCHEMA_KEYWORDS.has(keyword)) {
      issues.push({
        path: path || '(root)',
        keyword,
        reason: `"${keyword}" has not been verified against the live structured-output API`,
      });
    }
  }

  for (const keyword of ['minItems', 'maxItems'] as const) {
    const bound = schema[keyword];
    if (typeof bound !== 'number') {
      continue;
    }
    const cost = bound * schemaComplexity(schema.items);
    if (cost > MAX_ARRAY_GRAMMAR_COST) {
      issues.push({
        path: path || '(root)',
        keyword,
        reason: `${keyword}=${bound} over items of complexity ${schemaComplexity(schema.items)} compiles to a grammar cost of ${cost}, above the ${MAX_ARRAY_GRAMMAR_COST} the API accepts; cap the collection after parsing instead`,
      });
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'required' || key === 'enum') {
      continue;
    }
    if (key === 'properties' && isSchemaObject(value)) {
      for (const [child, childSchema] of Object.entries(value)) {
        issues.push(...findSchemaCompatibilityIssues(childSchema, `${at(key)}.${child}`));
      }
      continue;
    }
    if (isSchemaObject(value) || Array.isArray(value)) {
      issues.push(...findSchemaCompatibilityIssues(value, at(key)));
    }
  }

  return issues;
}
