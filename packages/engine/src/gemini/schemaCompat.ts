/**
 * Static compatibility check for JSON Schemas we send as `responseJsonSchema`.
 *
 * Structured output is served by constrained decoding: the provider compiles the
 * schema into a grammar before generating a single token. A schema the type
 * checker is perfectly happy with can still be rejected at request time with a
 * bare `400 INVALID_ARGUMENT` that names no field, so unit tests over the schema
 * builders cannot tell a working schema from a broken one. This module encodes
 * the one limit we have confirmed against the live API so those tests can.
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
 *
 * Every row above varied `maxItems`. `minItems` was never probed, so this module
 * says nothing about it — see `findSchemaCompatibilityIssues`.
 *
 * Findings carry a confidence, because the two things this module can notice are
 * not equally good evidence. A grammar cost over the measured ceiling reproduces
 * a rejection we have actually seen (`confident`). A keyword outside the
 * documented subset only means we have not tested it — the provider documents
 * that it commonly *ignores* properties it does not support, and rejects on
 * complexity instead — so that is a hint, never a diagnosis (`advisory`).
 */

/**
 * Keywords the provider documents for `responseJsonSchema`. Mirrors
 * `SUPPORTED_KEYWORDS` in `packages/cli/src/schema.ts`, which is the gate a
 * user-supplied schema must already pass; the two are kept in sync by hand
 * because `packages/engine` cannot import from the package that depends on it. Anything
 * accepted there must be accepted here, or the CLI would warn about schemas it
 * just told the caller were supported.
 *
 * `oneOf` appears in that portable subset while the provider docs list only
 * `anyOf`; it is kept here so the CLI's own allowlist is not contradicted, but
 * prefer `anyOf` in schemas we generate.
 */
const PORTABLE_SCHEMA_KEYWORDS: readonly string[] = [
  '$schema', '$id', '$defs', '$ref', '$anchor',
  'type', 'format', 'title', 'description', 'enum',
  'items', 'prefixItems', 'minItems', 'maxItems',
  'minimum', 'maximum', 'anyOf', 'oneOf',
  'properties', 'additionalProperties', 'required', 'propertyOrdering',
];

/**
 * Schema keywords we do not flag: the documented subset above, plus keywords our
 * own builders emit and the live probes exercised. Anything outside this set is
 * reported as unproven rather than known-broken — extend it alongside either a
 * live probe or a documented guarantee.
 */
export const KNOWN_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  ...PORTABLE_SCHEMA_KEYWORDS,
  // OpenAPI spelling the provider still accepts alongside `anyOf: [..., null]`.
  'nullable',
]);

/**
 * Keywords whose value is a *map of schemas* keyed by a name the author chose.
 * Recursing into one of these as if it were a schema reports the author's own
 * definition names as unknown keywords, which is how a legitimate `$defs`
 * document used to produce findings for `Money` and `LineItem`.
 */
const CHILD_SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  '$defs',
  'definitions',
  'patternProperties',
  'dependentSchemas',
]);

/**
 * Keywords whose value is data rather than a schema. Their contents are the
 * author's payload — object keys inside a `const` or `default` are values, not
 * keywords — so the walk stops at them.
 */
const NON_SCHEMA_VALUE_KEYWORDS: ReadonlySet<string> = new Set([
  'required',
  'enum',
  'const',
  'default',
  'examples',
  'propertyOrdering',
  'dependentRequired',
]);

/**
 * Largest `bound x per-item complexity` product observed to compile. There is no
 * published provider limit; this is an empirical threshold read off the probe
 * table above, chosen at the top of the accepted range so the check fires before
 * a schema reaches the provider rather than after.
 */
export const MAX_ARRAY_GRAMMAR_COST = 200;

/**
 * How much weight a finding carries.
 *
 * - `confident`: reproduces a rejection measured against the live API. Enough to
 *   tell a caller their schema is why the request failed.
 * - `advisory`: untested construct. Worth mentioning, never worth blaming.
 */
export type SchemaCompatibilityConfidence = 'confident' | 'advisory';

export interface SchemaCompatibilityIssue {
  /** JSON-pointer-ish path to the offending node, e.g. `properties.rows`. */
  path: string;
  keyword: string;
  reason: string;
  confidence: SchemaCompatibilityConfidence;
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Approximate the grammar a schema expands into, counting one unit per leaf
 * value the decoder must be able to emit. Deliberately coarse: it only has to
 * order schemas the same way the provider's own budget does. `$ref` is not
 * resolved, so a referenced object counts as one unit and the result is a lower
 * bound on the true cost.
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
 * uses only known constructs — not that the provider is guaranteed to accept it,
 * but that it avoids every rejection we have actually reproduced.
 *
 * Callers deciding whether to blame the schema for a failure must filter to
 * `confidence: 'confident'`; the advisory findings say only "untested".
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
    if (!KNOWN_SCHEMA_KEYWORDS.has(keyword)) {
      issues.push({
        path: path || '(root)',
        keyword,
        reason: `"${keyword}" is outside the documented structured-output subset and has not been verified `
          + 'against the live API; the provider commonly ignores properties it does not support and rejects '
          + 'on grammar complexity instead, so treat this as a hint rather than a cause',
        confidence: 'advisory',
      });
    }
  }

  // Only `maxItems` was measured. `minItems` shares the same shape in a grammar
  // and may well share the ceiling, but no probe ever exercised it, so asserting
  // a bound on it would be inventing evidence.
  const maxItems = schema.maxItems;
  if (typeof maxItems === 'number') {
    const itemComplexity = schemaComplexity(schema.items);
    const cost = maxItems * itemComplexity;
    if (cost > MAX_ARRAY_GRAMMAR_COST) {
      issues.push({
        path: path || '(root)',
        keyword: 'maxItems',
        reason: `maxItems=${maxItems} over items of complexity ${itemComplexity} compiles to a grammar cost `
          + `of ${cost}, above the largest cost (${MAX_ARRAY_GRAMMAR_COST}) observed to compile in live probes; `
          + 'cap the collection after parsing instead',
        confidence: 'confident',
      });
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (NON_SCHEMA_VALUE_KEYWORDS.has(key)) {
      continue;
    }
    if (CHILD_SCHEMA_MAP_KEYWORDS.has(key) && isSchemaObject(value)) {
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
