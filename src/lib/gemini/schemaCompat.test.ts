import { describe, expect, it } from 'vitest';

import { findSchemaCompatibilityIssues } from './schemaCompat';

const rowObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    quantity: { type: 'string' },
  },
};

describe('findSchemaCompatibilityIssues', () => {
  it('accepts the constructs confirmed against the live API', () => {
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

  it('flags an array bound whose compiled grammar exceeds the budget', () => {
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
  });

  it('allows a bound small enough to compile', () => {
    const issues = findSchemaCompatibilityIssues({
      type: 'array',
      maxItems: 50,
      items: rowObject,
    });

    expect(issues).toEqual([]);
  });

  it('reports keywords that have not been verified, with their path', () => {
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
