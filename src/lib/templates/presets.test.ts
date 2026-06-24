import { describe, expect, it } from 'vitest';
import { buildPresetCsv, buildPresetMarkdown } from './engine';
import { getExtractionPreset, listExtractionPresets } from './presets';
import type { ExtractionPreset, PresetStructuredOutput } from '../gemini/types';

describe('template presets', () => {
  it('lists the shipped extraction presets', () => {
    const presets = listExtractionPresets();

    expect(presets.map((preset) => preset.id)).toEqual([
      'invoice',
      'receipt',
      'resume',
      'business-card',
    ]);
  });

  it('looks up presets by id', () => {
    const preset = getExtractionPreset('invoice');

    expect(preset.label).toBe('Invoice');
    expect(preset.outputShape).toBe('table');
  });

  // audit T-07: callers must not be able to mutate the shared module state.
  it('returns a frozen snapshot that cannot mutate module state', () => {
    const first = listExtractionPresets();
    const initialCount = first.length;

    // The returned array and its entries are frozen, so writes are no-ops
    // (silently in non-strict, throwing in strict mode — assert either way).
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(() => {
      (first as ExtractionPreset[]).push({
        id: 'dummy',
        label: 'Dummy',
        description: 'x',
        outputShape: 'record',
        rules: [],
      });
    }).toThrow();

    const second = listExtractionPresets();
    expect(second.length).toBe(initialCount);
    expect(second.map((preset) => preset.id)).not.toContain('dummy');
  });

  // audit T-01: the fields map contract is keyed by rule.field, which must be
  // unique within each preset.
  it('uses unique rule.field keys within every preset', () => {
    for (const preset of listExtractionPresets()) {
      const fieldKeys = preset.rules.map((rule) => rule.field);
      expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
    }
  });

  // audit T-03: the invoice currency identifier is text, not a numeric amount.
  it('captures the invoice currency identifier as a text field', () => {
    const invoice = getExtractionPreset('invoice');
    const currencyRule = invoice.rules.find((rule) => rule.field === 'currency');
    expect(currencyRule?.type).toBe('text');
  });

  it('renders markdown and csv artifacts for table presets', () => {
    const preset = getExtractionPreset('invoice');
    const output: PresetStructuredOutput = {
      presetId: preset.id,
      documentType: 'Invoice',
      summary: 'Invoice detected with one line item.',
      fields: {
        invoice_number: { value: 'INV-100', confidence: 0.92, required: true, type: 'text' },
        invoice_date: { value: '2026-02-18', confidence: 0.91, required: true, type: 'date' },
        due_date: { value: '2026-03-18', confidence: 0.77, required: false, type: 'date' },
        vendor_name: { value: 'Northwind Supply Co.', confidence: 0.95, required: true, type: 'text' },
        customer_name: { value: 'Acme Logistics', confidence: 0.83, required: false, type: 'text' },
        currency: { value: 'USD', confidence: 0.84, required: false, type: 'currency' },
        subtotal: { value: '1200.00', confidence: 0.9, required: false, type: 'currency' },
        tax: { value: '162.00', confidence: 0.88, required: false, type: 'currency' },
        total: { value: '1362.00', confidence: 0.97, required: true, type: 'currency' },
      },
      rows: [
        {
          description: 'Monthly retainer',
          quantity: '1',
          unit_price: '1200.00',
          line_total: '1200.00',
        },
      ],
      warnings: ['Tax rounding reviewed manually.'],
    };

    const markdown = buildPresetMarkdown(output, preset);
    const csv = buildPresetCsv(output, preset);

    expect(markdown).toContain('# Invoice Extraction');
    expect(markdown).toContain('Monthly retainer');
    expect(markdown).toContain('Tax rounding reviewed manually.');
    expect(csv).toContain('description,quantity,unit_price,line_total');
    expect(csv).toContain('Monthly retainer,1,1200.00,1200.00');
  });

  it('does not emit csv for record presets', () => {
    const preset = getExtractionPreset('resume');
    const output: PresetStructuredOutput = {
      presetId: preset.id,
      documentType: 'Resume',
      summary: 'Candidate identified successfully.',
      fields: {
        full_name: { value: 'Jordan Lee', confidence: 0.98, required: true, type: 'text' },
        email: { value: 'jordan@example.com', confidence: 0.94, required: true, type: 'email' },
        phone: { value: null, confidence: 0.2, required: false, type: 'phone' },
        location: { value: 'Amsterdam, NL', confidence: 0.81, required: false, type: 'text' },
        headline: { value: 'Senior Product Designer', confidence: 0.88, required: false, type: 'text' },
        skills: { value: ['Figma', 'Research'], confidence: 0.92, required: false, type: 'list' },
        experience_highlights: { value: ['Led redesign'], confidence: 0.9, required: false, type: 'list' },
        education: { value: 'BSc Industrial Design', confidence: 0.86, required: false, type: 'text' },
      },
    };

    expect(buildPresetCsv(output, preset)).toBeUndefined();
  });
});
