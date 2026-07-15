import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent, mockRegionCropper } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockRegionCropper: vi.fn(),
}));

vi.mock('@google/genai', async () => {
  const actual = await vi.importActual<typeof import('@google/genai')>('@google/genai');

  return {
    ...actual,
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

import type { AgentMemory, NormalizedRegion } from './agentTypes';
import {
  executeAnalyzeDocumentStructure,
  executeExtractFieldsBatch,
  executeReOcrRegion,
} from './agentTools';

function createMemory(documentType = 'invoice'): AgentMemory {
  return {
    sessionId: 'session-1',
    documentName: 'fixture.pdf',
    currentIteration: 1,
    extractedFields: {
      vendor_name: {
        value: 'Northwind Supply Co.',
        confidence: 0.99,
        extractedAt: 100,
      },
      invoice_number: {
        value: 'INV-2026-0142',
        confidence: 0.97,
        extractedAt: 100,
      },
      invoice_date: {
        value: '2026-02-18',
        confidence: 0.96,
        extractedAt: 100,
      },
    },
    processingHistory: [],
    documentAnalysis: {
      pageCount: 1,
      documentType,
      complexity: 'medium',
      specialFeatures: [],
    },
    confidence: 0.97,
    lastUpdated: 100,
  };
}

const totalRegion: NormalizedRegion = {
  page: 1,
  x: 0.68,
  y: 0.72,
  width: 0.2,
  height: 0.08,
  units: 'normalized',
};

describe('agentTools', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockRegionCropper.mockReset();
    mockRegionCropper.mockResolvedValue({
      dataUrl: 'data:image/png;base64,Y3JvcA==',
      mimeType: 'image/png',
      width: 160,
      height: 64,
    });
  });

  it('normalizes extracted alias field names to canonical schema names in a batch', async () => {
    const result = await executeExtractFieldsBatch(
      {
        fields: [
          {
            field_name: 'email_address',
            field_value: 'nina@orbitpartners.com',
            confidence: 0.99,
            validation_rule: 'email',
          },
        ],
      },
      '',
      '',
      createMemory('business card'),
    );

    expect(result.success).toBe(true);
    expect(result.memoryUpdate?.extractedFields?.email?.value).toBe('nina@orbitpartners.com');
    expect(result.memoryUpdate?.extractedFields?.email_address).toBeUndefined();
  });

  it('stores typed normalized locations for extracted fields', async () => {
    const result = await executeExtractFieldsBatch(
      {
        fields: [
          {
            field_name: 'total_amount',
            field_value: '1471.50',
            confidence: 0.99,
            location: totalRegion,
          },
        ],
      },
      '',
      '',
      createMemory('invoice'),
    );

    expect(result.success).toBe(true);
    expect(result.memoryUpdate?.extractedFields?.total_amount?.location).toEqual(totalRegion);
  });

  it('returns schema guidance from analyze_document_structure', async () => {
    const result = await executeAnalyzeDocumentStructure(
      {
        document_type: 'Business_Card',
        layout_analysis: { description: 'front and back' },
        extraction_strategy: 'form-based',
        confidence: 0.96,
      },
      '',
      '',
      createMemory('unknown'),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      document_type: 'business card',
      required_fields: ['full_name', 'company_name', 'email'],
    });
  });

  it('returns readiness details for incomplete batches', async () => {
    const result = await executeExtractFieldsBatch(
      {
        fields: [
          {
            field_name: 'customer_name',
            field_value: 'Acme Logistics',
            confidence: 0.98,
          },
        ],
      },
      '',
      '',
      createMemory('invoice'),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      fieldCount: 1,
      missingRequiredFields: ['total_amount'],
    });
  });

  it('accepts date-time values for date validation rules', async () => {
    const result = await executeExtractFieldsBatch(
      {
        fields: [
          {
            field_name: 'transaction_date',
            field_value: '2026-01-12 14:22',
            confidence: 0.99,
            validation_rule: 'date',
          },
        ],
      },
      '',
      '',
      createMemory('receipt'),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      fieldCount: 1,
    });
    expect(result.memoryUpdate?.extractedFields?.transaction_date?.isValid).toBe(true);
  });

  it('returns parsed field candidates directly from re_ocr_region and updates memory', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        fields: [
          {
            field_name: 'total_amount',
            field_value: '1471.50',
            confidence: 0.99,
            validation_rule: 'currency',
            location: totalRegion,
          },
        ],
      }),
    });

    const result = await executeReOcrRegion(
      {
        region: totalRegion,
        focus: 'invoice total',
        target_fields: ['total_amount'],
        confidence_threshold: 0.8,
      },
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      createMemory('invoice'),
      {
        apiKey: 'test-key',
        model: 'gemini-3-flash-preview',
        thinkingConfig: {
          level: 'MINIMAL',
          includeThoughts: false,
        },
        regionCropper: mockRegionCropper,
      },
    );

    expect(mockRegionCropper).toHaveBeenCalledWith(
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      totalRegion,
    );
    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        responseMimeType: 'application/json',
        responseJsonSchema: expect.objectContaining({
          type: 'object',
          required: ['fields'],
        }),
      }),
    }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      fieldCount: 1,
      fieldCandidates: [
        {
          field_name: 'total_amount',
          field_value: '1471.50',
          location: totalRegion,
        },
      ],
    });
    expect(result.memoryUpdate?.extractedFields?.total_amount?.value).toBe('1471.50');
    expect(result.memoryUpdate?.extractedFields?.total_amount?.location).toEqual(totalRegion);
  });

  it('does not accept truncated re-OCR JSON as a successful tool result', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ fields: [] }),
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });

    const result = await executeReOcrRegion(
      { region: totalRegion, focus: 'invoice total' },
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      createMemory('invoice'),
      {
        apiKey: 'test-key',
        model: 'gemini-3-flash-preview',
        regionCropper: mockRegionCropper,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/incomplete output/i);
  });

  it('fails closed when re_ocr_region is called without valid normalized coordinates', async () => {
    const result = await executeReOcrRegion(
      {
        region: 'top right total',
        focus: 'invoice total',
      },
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      createMemory('invoice'),
      {
        apiKey: 'test-key',
        model: 'gemini-3-flash-preview',
        regionCropper: mockRegionCropper,
      },
    );

    expect(mockRegionCropper).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('"region" must be a normalized region object');
  });

  it('fails closed when region refinement is not configured for the runtime', async () => {
    const result = await executeReOcrRegion(
      { region: totalRegion, focus: 'invoice total' },
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      createMemory('invoice'),
      { apiKey: 'test-key', model: 'gemini-3-flash-preview' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Region refinement is not configured');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
