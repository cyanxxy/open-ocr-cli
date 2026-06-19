import { describe, expect, it, vi } from 'vitest';

import type { PresetStructuredOutput } from '../gemini/types';
import { buildPresetCsv, buildPresetMarkdown, buildPresetPrompt, normalizeFieldValue, runExtractionPreset } from './engine';
import { getExtractionPreset } from './presets';

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn(async () => ({
        text: JSON.stringify({
          documentType: 'Invoice',
          summary: 'Structured extraction for invoice.',
          fields: {
            total: { value: '1471.5', confidence: 0.97 },
            currency: { value: 'USD', confidence: 0.99 },
          },
          rows: [],
        }),
      })),
    };
  },
}));

describe('template engine helpers', () => {
  it('builds markdown with escaped field and row values', () => {
    const preset = getExtractionPreset('invoice');
    const result: PresetStructuredOutput = {
      presetId: 'invoice',
      documentType: 'Invoice',
      summary: 'Structured extraction for invoice.',
      fields: {
        invoice_number: { value: 'INV|2026|0142', confidence: 0.94, required: true, type: 'text' },
        invoice_date: { value: '2026-02-18', confidence: 0.91, required: true, type: 'date' },
        due_date: { value: null, confidence: 0.2, required: false, type: 'date' },
        vendor_name: { value: 'Northwind Supply Co.', confidence: 0.96, required: true, type: 'text' },
        customer_name: { value: 'Acme Logistics', confidence: 0.88, required: false, type: 'text' },
        currency: { value: 'USD', confidence: 0.99, required: false, type: 'currency' },
        subtotal: { value: '1250.00', confidence: 0.95, required: false, type: 'currency' },
        tax: { value: '112.50', confidence: 0.92, required: false, type: 'currency' },
        total: { value: '1362.50', confidence: 0.97, required: true, type: 'currency' },
      },
      rows: [
        {
          description: 'Support | hours',
          quantity: '3',
          unit_price: '50.00',
          line_total: '150.00',
        },
      ],
      warnings: ['Low confidence on due date'],
    };

    const markdown = buildPresetMarkdown(result, preset);

    expect(markdown).toContain('# Invoice Extraction');
    expect(markdown).toContain('INV\\|2026\\|0142');
    expect(markdown).toContain('Support \\| hours');
    expect(markdown).toContain('Not found');
    expect(markdown).toContain('## Warnings');
  });

  it('builds CSV only for table presets and escapes quoted values', () => {
    const tablePreset = getExtractionPreset('receipt');
    const recordPreset = getExtractionPreset('resume');

    const tableResult: PresetStructuredOutput = {
      presetId: 'receipt',
      documentType: 'Receipt',
      summary: 'Structured extraction for receipt.',
      fields: {},
      rows: [
        { item: 'Coffee "Beans"', quantity: '2', price: '8.50' },
      ],
    };

    expect(buildPresetCsv(tableResult, tablePreset)).toBe(
      'item,quantity,price\n"Coffee ""Beans""",2,8.50',
    );

    expect(buildPresetCsv(tableResult, recordPreset)).toBeUndefined();
  });

  it('builds prompts that reflect the preset output shape', () => {
    const invoicePrompt = buildPresetPrompt(getExtractionPreset('invoice'));
    const resumePrompt = buildPresetPrompt(getExtractionPreset('resume'));

    expect(invoicePrompt).toContain('Also extract line-item rows into a "rows" array.');
    expect(invoicePrompt).toContain('description, quantity, unit_price, line_total');
    expect(resumePrompt).toContain('Do not include a "rows" array unless the preset requires one.');
  });

  it('normalizes numeric currency fields to two decimal places', async () => {
    const preset = getExtractionPreset('invoice');

    const result = await runExtractionPreset(
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      {
        apiKey: 'test-key',
        model: 'gemini-3-flash-preview',
        thinkingConfig: { level: 'MINIMAL', includeThoughts: false },
      },
      preset,
    );

    expect(result.json.fields.total?.value).toBe('1471.50');
    expect(result.json.fields.currency?.value).toBe('USD');
  });
});

describe('normalizeFieldValue number/currency parsing', () => {
  it('parses US-formatted numbers', () => {
    expect(normalizeFieldValue('1,234.56', 'number')).toBe(1234.56);
    expect(normalizeFieldValue('1,234', 'number')).toBe(1234);
    expect(normalizeFieldValue('1,234,567', 'number')).toBe(1234567);
  });

  it('parses European-formatted numbers', () => {
    expect(normalizeFieldValue('1.234,56', 'number')).toBe(1234.56);
    expect(normalizeFieldValue('1.234.567', 'number')).toBe(1234567);
    expect(normalizeFieldValue('1,5', 'number')).toBe(1.5);
  });

  it('parses plain and signed numbers', () => {
    expect(normalizeFieldValue('1234', 'number')).toBe(1234);
    expect(normalizeFieldValue('-1.234,56', 'number')).toBe(-1234.56);
    expect(normalizeFieldValue(19.5, 'number')).toBe(19.5);
  });

  it('falls back to the trimmed string for non-numeric values', () => {
    expect(normalizeFieldValue('not a number', 'number')).toBe('not a number');
    expect(normalizeFieldValue('  N/A  ', 'number')).toBe('N/A');
  });

  it('normalizes currency across US/European/plain formats to two decimals', () => {
    expect(normalizeFieldValue('1,234.56', 'currency')).toBe('1234.56');
    expect(normalizeFieldValue('1.234,56', 'currency')).toBe('1234.56');
    expect(normalizeFieldValue('€1.234,56', 'currency')).toBe('1234.56');
    expect(normalizeFieldValue('1234', 'currency')).toBe('1234.00');
    expect(normalizeFieldValue('1.234.567', 'currency')).toBe('1234567.00');
    expect(normalizeFieldValue(1471.5, 'currency')).toBe('1471.50');
  });

  it('keeps non-numeric currency values verbatim', () => {
    expect(normalizeFieldValue('USD', 'currency')).toBe('USD');
  });
});
