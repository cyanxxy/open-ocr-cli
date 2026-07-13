import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertCustomSchemaOutput, loadCustomSchema } from './schema';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-schema-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('custom JSON schemas', () => {
  it('loads supported schemas and validates extracted values', async () => {
    const schemaPath = path.join(directory, 'invoice.schema.json');
    await writeFile(schemaPath, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        invoice_number: { type: 'string', description: 'Invoice identifier' },
        invoice_date: { type: 'string', format: 'date' },
        total: { type: 'number', minimum: 0 },
      },
      required: ['invoice_number', 'invoice_date', 'total'],
    }));
    const schema = await loadCustomSchema(schemaPath, directory);
    expect(schema).not.toHaveProperty('$schema');
    expect(() => assertCustomSchemaOutput(
      schema,
      { invoice_number: 'INV-1', invoice_date: '2026-07-13', total: 12.5 },
    )).not.toThrow();
    expect(() => assertCustomSchemaOutput(
      schema,
      { invoice_number: 'INV-1', invoice_date: 'July 13', total: 12.5 },
    )).toThrow('must match format');
  });

  it('rejects unsupported Gemini schema keywords before making requests', async () => {
    const schemaPath = path.join(directory, 'unsupported.json');
    await writeFile(schemaPath, JSON.stringify({ type: 'string', pattern: '^INV-' }));
    await expect(loadCustomSchema(schemaPath, directory)).rejects.toThrow('keyword "pattern" is not supported');
  });

  it('rejects non-metadata siblings next to $ref', async () => {
    const schemaPath = path.join(directory, 'invalid-ref.json');
    await writeFile(schemaPath, JSON.stringify({ $ref: '#/$defs/value', description: 'not allowed' }));
    await expect(loadCustomSchema(schemaPath, directory)).rejects.toThrow('$ref');
  });

  it('rejects external schema references before making a request', async () => {
    const schemaPath = path.join(directory, 'external-ref.json');
    await writeFile(schemaPath, JSON.stringify({ $ref: 'https://example.com/schema.json' }));
    await expect(loadCustomSchema(schemaPath, directory)).rejects.toThrow('this schema document');
  });
});
