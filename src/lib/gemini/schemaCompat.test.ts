import { describe, expect, it } from 'vitest';

import { KNOWN_SCHEMA_KEYWORDS, findSchemaCompatibilityIssues } from './schemaCompat';

const rowObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    quantity: { type: 'string' },
  },
};

/**
 * A schema written the way JSON Schema itself recommends: shared shapes hoisted
 * into `$defs` and referenced by `$ref`. Every keyword here is in the portable
 * subset the CLI already accepts from users, so nothing about it is suspect.
 */
const MODULAR_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.invalid/invoice.json',
  type: 'object',
  additionalProperties: false,
  required: ['total', 'lines'],
  properties: {
    total: { $ref: '#/$defs/Money' },
    lines: { type: 'array', items: { $ref: '#/$defs/Line' } },
  },
  $defs: {
    Money: {
      type: 'object',
      additionalProperties: false,
      required: ['amount', 'currency'],
      properties: {
        amount: { type: 'string' },
        currency: { type: 'string' },
      },
    },
    Line: {
      type: 'object',
      additionalProperties: false,
      required: ['description'],
      properties: {
        description: { type: 'string' },
        unitPrice: { $ref: '#/$defs/Money' },
      },
    },
  },
};

describe('findSchemaCompatibilityIssues', () => {
  it('reports nothing for a schema built only from known constructs', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['documentType', 'fields', 'warnings'],
      properties: {
        documentType: { type: 'string' },
        fields: {
          type: 'object',
          additionalProperties: false,
          required: ['total'],
          properties: {
            total: {
              type: 'object',
              additionalProperties: false,
              required: ['value', 'confidence'],
              properties: {
                value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
        },
        rows: { type: 'array', items: rowObject },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    };

    expect(findSchemaCompatibilityIssues(schema)).toEqual([]);
  });

  // A `$defs` document used to produce three findings: `$defs` and `$ref` as
  // unknown keywords, plus the author's own definition names — `Money`, `Line` —
  // reported as if they were keywords, because the walk recursed into the
  // definition map as though it were a schema.
  it('reports nothing for a modular $defs/$ref schema', () => {
    expect(findSchemaCompatibilityIssues(MODULAR_SCHEMA)).toEqual([]);
  });

  it('never treats a $defs definition name as a keyword', () => {
    const issues = findSchemaCompatibilityIssues({
      type: 'object',
      properties: { total: { $ref: '#/$defs/Money' } },
      $defs: {
        Money: { type: 'string', pattern: '^[0-9.]+$' },
      },
    });

    // The one finding is the unknown keyword inside the definition, addressed by
    // the path through it — not the definition's name.
    expect(issues).toEqual([
      expect.objectContaining({ path: '$defs.Money', keyword: 'pattern', confidence: 'advisory' }),
    ]);
  });

  it('does not walk into the payload of a data-valued keyword', () => {
    const issues = findSchemaCompatibilityIssues({
      type: 'object',
      properties: {
        status: { type: 'string', default: { arbitrary: 'user data', nested: { deeper: 1 } } },
      },
    });

    // `default` itself is outside the subset; the object it holds is the
    // author's data and its keys are not keywords.
    expect(issues).toEqual([
      expect.objectContaining({ path: 'properties.status', keyword: 'default' }),
    ]);
  });

  it('accepts every keyword the CLI portable subset already lets through', () => {
    // Mirrors SUPPORTED_KEYWORDS in packages/cli/src/schema.ts. That module
    // validates user schemas before they reach the provider, so a keyword it
    // admits must not be flagged here — otherwise the CLI warns about a schema
    // it just called supported. Kept as a literal because src/lib must not
    // import from the package that depends on it.
    const portable = [
      '$schema', '$id', '$defs', '$ref', '$anchor',
      'type', 'format', 'title', 'description', 'enum',
      'items', 'prefixItems', 'minItems', 'maxItems',
      'minimum', 'maximum', 'anyOf', 'oneOf',
      'properties', 'additionalProperties', 'required', 'propertyOrdering',
    ];

    expect(portable.filter((keyword) => !KNOWN_SCHEMA_KEYWORDS.has(keyword))).toEqual([]);
  });

  it('flags an array bound whose compiled grammar exceeds the measured ceiling', () => {
    const issues = findSchemaCompatibilityIssues({
      type: 'object',
      properties: {
        rows: { type: 'array', maxItems: 500, items: rowObject },
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('properties.rows');
    expect(issues[0].keyword).toBe('maxItems');
    expect(issues[0].reason).toContain('grammar cost of 1000');
    // The only finding backed by a reproduced live rejection.
    expect(issues[0].confidence).toBe('confident');
  });

  it('allows a bound small enough to compile', () => {
    const issues = findSchemaCompatibilityIssues({
      type: 'array',
      maxItems: 50,
      items: rowObject,
    });

    expect(issues).toEqual([]);
  });

  // The probe table only ever varied `maxItems`. `minItems` plausibly shares the
  // ceiling, but nothing measured it, so the check stays silent rather than
  // asserting a limit no probe established.
  it('says nothing about minItems, which was never probed', () => {
    expect(findSchemaCompatibilityIssues({
      type: 'array',
      minItems: 500,
      items: rowObject,
    })).toEqual([]);
  });

  it('reports keywords outside the subset as advisory, with their path', () => {
    const issues = findSchemaCompatibilityIssues({
      type: 'object',
      properties: {
        code: { type: 'string', pattern: '^[A-Z]+$' },
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('properties.code');
    expect(issues[0].keyword).toBe('pattern');
    expect(issues[0].reason).toContain('has not been verified');
    // Untested is not broken: the provider is documented to ignore properties it
    // does not support, so this must never be reported as the cause of a failure.
    expect(issues[0].confidence).toBe('advisory');
  });

  it('does not descend into required or enum string lists', () => {
    const issues = findSchemaCompatibilityIssues({
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['open', 'closed'] } },
    });

    expect(issues).toEqual([]);
  });
});
