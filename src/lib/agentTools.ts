import { AgentFunctionResult, AgentMemory } from './agentTypes';
import { FunctionDeclaration, GoogleGenAI } from '@google/genai';
import type { AgentClientConfig } from './agentTypes';
import {
  getAgentDocumentSchema,
  getAgentReadiness,
  normalizeAgentDocumentType,
  normalizeAgentFieldName,
} from './agentSchema';
import { applyThinkingConfig, isFatalGeminiError } from './gemini/client';
import { getTopKForModel, parseJsonPayload } from './gemini/structured';
import { assertNormalizedRegion, cropDocumentRegion } from './regionRaster';

// Runtime validation helpers for Gemini function call args

function assertString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new TypeError(`Expected non-empty string for "${key}", got ${typeof v}`);
  }
  return v;
}

function assertNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new TypeError(`Expected number for "${key}", got ${typeof v}`);
  }
  return v;
}

function assertObject(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = args[key];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new TypeError(`Expected object for "${key}", got ${typeof v}`);
  }
  return v as Record<string, unknown>;
}

function assertArray(args: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = args[key];
  if (!Array.isArray(v) || v.length === 0) {
    throw new TypeError(`Expected non-empty array for "${key}", got ${typeof v}`);
  }

  return v.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError(`Expected object at "${key}[${index}]", got ${typeof entry}`);
    }
    return entry as Record<string, unknown>;
  });
}

interface RawRegionFieldPayload {
  fields?: unknown;
}

function parseRegionFieldPayload(rawText: string): Record<string, unknown>[] {
  const parsed = parseJsonPayload<RawRegionFieldPayload>(rawText, 'Re-OCR');

  if (!Array.isArray(parsed.fields)) {
    throw new Error('Re-OCR response must include a "fields" array');
  }

  return parsed.fields.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`Re-OCR response field at index ${index} is not an object`);
    }
    return entry as Record<string, unknown>;
  });
}

function normalizeStructuredFields(
  entries: Record<string, unknown>[],
  memory: Readonly<AgentMemory>,
) {
  const acceptedFields: Record<string, AgentMemory['extractedFields'][string]> = {};
  const extractedSummaries: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    const rawFieldName = assertString(entry, 'field_name');
    const field_name = normalizeAgentFieldName(memory.documentAnalysis.documentType, rawFieldName);
    const field_value = assertString(entry, 'field_value');
    const confidence = assertNumber(entry, 'confidence');
    const validation_rule = typeof entry.validation_rule === 'string'
      ? entry.validation_rule
      : inferValidationRule(field_name);
    const location = typeof entry.location === 'object' && entry.location !== null
      ? assertNormalizedRegion(entry.location, 'location')
      : undefined;

    const validationResult = validation_rule
      ? validateFieldValue(field_value, validation_rule)
      : validateFieldFormat(field_value, field_name);

    const preparedField = {
      value: field_value,
      confidence,
      validation_rule,
      location,
      isValid: validationResult.isValid,
      validationMessage: validationResult.message,
      extractedAt: Date.now(),
    };

    const currentField = acceptedFields[field_name] ?? memory.extractedFields[field_name];
    if (!currentField || preparedField.confidence >= currentField.confidence) {
      acceptedFields[field_name] = preparedField;
    }

    extractedSummaries.push({
      field_name,
      original_field_name: rawFieldName,
      field_value,
      confidence,
      validation_rule,
      ...(location ? { location } : {}),
      isValid: validationResult.isValid,
      validationMessage: validationResult.message,
    });
  }

  return {
    acceptedFields,
    extractedSummaries,
  };
}

export const AGENT_FUNCTIONS: FunctionDeclaration[] = [
  {
    name: 're_ocr_region',
    description: 'Re-process a specific region of the document with higher focus to improve accuracy.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: 'Normalized region box for true region refinement.',
          properties: {
            page: { type: 'number', description: '1-based page number that contains the region.' },
            x: { type: 'number', description: 'Left edge of the region in normalized page coordinates (0-1).' },
            y: { type: 'number', description: 'Top edge of the region in normalized page coordinates (0-1).' },
            width: { type: 'number', description: 'Region width in normalized page coordinates (0-1).' },
            height: { type: 'number', description: 'Region height in normalized page coordinates (0-1).' },
            units: { type: 'string', enum: ['normalized'], description: 'Must always be "normalized".' },
          },
          required: ['page', 'x', 'y', 'width', 'height', 'units'],
        },
        focus: { type: 'string', description: 'Specific text or type of content to focus on within the region.' },
        target_fields: {
          type: 'array',
          description: 'Optional canonical field names that should be improved from this region.',
          items: { type: 'string' },
        },
        confidence_threshold: { type: 'number', description: 'The confidence threshold to aim for (0.0 to 1.0).' },
      },
      required: ['region', 'focus'],
    },
  },
  {
    name: 'extract_fields_batch',
    description: 'Extract all currently visible structured fields in one batch using canonical field names.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'The structured fields extracted from the document in this pass.',
          items: {
            type: 'object',
            properties: {
              field_name: { type: 'string', description: 'Canonical field name (e.g., "invoice_number", "customer_name").' },
              field_value: { type: 'string', description: 'The extracted value of the field.' },
              confidence: { type: 'number', description: 'The confidence score of the extraction (0.0 to 1.0).' },
              validation_rule: { type: 'string', description: 'Optional validation rule such as "email", "phone", "date", or "currency".' },
              location: {
                type: 'object',
                description: 'Optional normalized page region for this field.',
                properties: {
                  page: { type: 'number' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' },
                  units: { type: 'string', enum: ['normalized'] },
                },
                required: ['page', 'x', 'y', 'width', 'height', 'units'],
              },
            },
            required: ['field_name', 'field_value', 'confidence'],
          },
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'analyze_document_structure',
    description: 'Analyze the overall structure and layout of the document.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        document_type: { type: 'string', description: 'The identified type of the document (e.g., "invoice", "resume", "report").' },
        layout_analysis: { type: 'object', description: 'A description of the document layout (e.g., columns, sections, tables).' },
        extraction_strategy: { type: 'string', description: 'The recommended strategy for extraction (e.g., "form-based", "table-based", "full-text").' },
        confidence: { type: 'number', description: 'The confidence in the analysis (0.0 to 1.0).' },
      },
      required: ['document_type', 'layout_analysis', 'extraction_strategy', 'confidence'],
    },
  },
];

/**
 * Tool implementations for agent function calls
 */

/**
 * Re-process a specific region of the document with higher focus
 */
export async function executeReOcrRegion(
  args: Record<string, unknown>,
  fileData: string,
  mimeType: string,
  memory: Readonly<AgentMemory>,
  clientConfig: AgentClientConfig,
): Promise<AgentFunctionResult> {
  try {
    const region = assertNormalizedRegion(args.region);
    const focus = assertString(args, 'focus');
    const explicitTargetFields = Array.isArray(args.target_fields)
      ? args.target_fields.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const confidence_threshold = typeof args.confidence_threshold === 'number' ? args.confidence_threshold : 0.7;
    const readiness = getAgentReadiness(memory);
    const targetFields = explicitTargetFields.length > 0
      ? explicitTargetFields
      : readiness.missingRequiredFields;
    const schema = getAgentDocumentSchema(memory.documentAnalysis.documentType);
    const croppedRegion = await cropDocumentRegion(fileData, mimeType, region);
    const base64Data = croppedRegion.dataUrl.split(',')[1];
    if (!base64Data) {
      throw new Error('Failed to generate cropped region image for refinement');
    }
    const genAI = new GoogleGenAI({ apiKey: clientConfig.apiKey });

    let generationConfig: Record<string, unknown> = {
      temperature: 1,
      maxOutputTokens: 4096,
      topP: 0.95,
      topK: getTopKForModel(clientConfig.model),
      responseMimeType: 'application/json',
    };

    if (clientConfig.abortSignal) {
      generationConfig.abortSignal = clientConfig.abortSignal;
    }

    generationConfig = applyThinkingConfig(generationConfig, clientConfig.model, clientConfig.thinkingConfig);

    const prompt = [
      'Return valid JSON only.',
      'Do not wrap the JSON in markdown fences.',
      'You are re-reading a specific region of a document to recover structured field values.',
      'Respond with {"fields":[{"field_name":"string","field_value":"string","confidence":0.0,"validation_rule":"string","location":{"page":1,"x":0.1,"y":0.1,"width":0.2,"height":0.1,"units":"normalized"}}]}.',
      `This cropped image is from page ${region.page} of the original document.`,
      `Region coordinates in the original document: ${JSON.stringify(region)}.`,
      `Prioritize this focus instruction: ${focus}.`,
      `Document type: ${normalizeAgentDocumentType(memory.documentAnalysis.documentType)}.`,
      schema
        ? `Canonical fields for this document type: ${[...schema.requiredFields, ...schema.optionalFields].join(', ')}.`
        : 'Use concise canonical field names if the document type is still unknown.',
      targetFields.length > 0
        ? `Target fields to recover from this region: ${targetFields.join(', ')}.`
        : 'Recover any high-value structured fields visible in this region.',
      'Only return fields you can see in this region.',
      `Every field confidence must be >= ${confidence_threshold.toFixed(2)} to be worth returning.`,
      'If no useful structured fields are visible, return {"fields":[]}.',
    ].join(' ');

    const response = await genAI.models.generateContent({
      model: clientConfig.model,
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: croppedRegion.mimeType,
              data: base64Data,
            },
          },
        ],
      }],
      config: generationConfig,
    });

    const rawFields = parseRegionFieldPayload(response.text || '');
    const filteredFields = rawFields.filter((entry) => {
      const entryConfidence = typeof entry.confidence === 'number' ? entry.confidence : 0;
      return entryConfidence >= confidence_threshold;
    });
    const { acceptedFields, extractedSummaries } = normalizeStructuredFields(filteredFields, memory);

    // The model only ever saw the CROPPED image, so any location it returns is
    // crop-relative — meaningless in the original document frame. Overwrite each
    // recovered field's location with the known original-frame region so a later
    // re_ocr_region re-crops the correct area instead of a wrong one.
    for (const field of Object.values(acceptedFields)) {
      field.location = region;
    }

    const simulatedFields = { ...memory.extractedFields, ...acceptedFields };
    applyCodeDrivenReviews(simulatedFields);
    const updatedReadiness = getAgentReadiness({
      documentAnalysis: memory.documentAnalysis,
      extractedFields: simulatedFields,
    });

    return {
      success: true,
      data: {
        region,
        focus,
        targetFields,
        fieldCandidates: extractedSummaries,
        fieldCount: Object.keys(acceptedFields).length,
        confidenceThreshold: confidence_threshold,
        crop: {
          mimeType: croppedRegion.mimeType,
          width: croppedRegion.width,
          height: croppedRegion.height,
        },
      },
      memoryUpdate: {
        extractedFields: acceptedFields,
        confidence: updatedReadiness.averageConfidence,
        processingHistoryItem: {
          type: 'function_call',
          content: `Re-OCR recovered ${Object.keys(acceptedFields).length} fields from page ${region.page}, region ${JSON.stringify(region)}`,
          functionCall: { name: 're_ocr_region', arguments: args },
          functionResult: {
            success: true,
            data: {
              fieldCount: Object.keys(acceptedFields).length,
              recoveredFields: Object.keys(acceptedFields),
              missingRequiredFields: updatedReadiness.missingRequiredFields,
            }
          },
          timestamp: Date.now(),
        }
      }
    };
  } catch (error) {
    // Surface non-retryable API failures so the agent loop stops instead of
    // continuing to call tools against an exhausted/unauthorized endpoint.
    if (isFatalGeminiError(error)) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Re-OCR failed',
    };
  }
}

/**
 * Extract and validate a batch of fields.
 */
export async function executeExtractFieldsBatch(
  args: Record<string, unknown>,
  _fileData: string,
  _mimeType: string,
  memory: Readonly<AgentMemory>
): Promise<AgentFunctionResult> {
  try {
    const batch = assertArray(args, 'fields');
    const { acceptedFields, extractedSummaries } = normalizeStructuredFields(batch, memory);
    const simulatedFields = { ...memory.extractedFields, ...acceptedFields };
    applyCodeDrivenReviews(simulatedFields);
    const readiness = getAgentReadiness({
      documentAnalysis: memory.documentAnalysis,
      extractedFields: simulatedFields,
    });

    return {
      success: true,
      data: {
        fieldCount: Object.keys(acceptedFields).length,
        fields: extractedSummaries,
        requiredCoverage: readiness.requiredCoverage,
        missingRequiredFields: readiness.missingRequiredFields,
      },
      memoryUpdate: {
        extractedFields: acceptedFields,
        confidence: readiness.averageConfidence,
        processingHistoryItem: {
          type: 'function_call',
          content: `Batch extracted ${Object.keys(acceptedFields).length} fields`,
          functionCall: { name: 'extract_fields_batch', arguments: args },
          functionResult: {
            success: true,
            data: {
              fieldCount: Object.keys(acceptedFields).length,
              requiredCoverage: readiness.requiredCoverage,
              missingRequiredFields: readiness.missingRequiredFields,
            }
          },
          timestamp: Date.now(),
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Batch field extraction failed',
    };
  }
}

/**
 * Analyze document structure
 */
export async function executeAnalyzeDocumentStructure(
  args: Record<string, unknown>,
  _fileData: string,
  _mimeType: string,
  memory: Readonly<AgentMemory>
): Promise<AgentFunctionResult> {
  try {
    const document_type = normalizeAgentDocumentType(assertString(args, 'document_type'));
    const layout_analysis = assertObject(args, 'layout_analysis');
    const extraction_strategy = assertString(args, 'extraction_strategy');
    const confidence = assertNumber(args, 'confidence');
    const schema = getAgentDocumentSchema(document_type);

    // New document analysis state
    const newDocumentAnalysis = {
      pageCount: memory.documentAnalysis.pageCount,
      documentType: document_type,
      complexity: determineComplexity(layout_analysis),
      specialFeatures: extractSpecialFeatures(layout_analysis),
    };

    return {
      success: true,
      data: {
        document_type,
        layout_analysis,
        extraction_strategy,
        confidence,
        required_fields: schema?.requiredFields ?? [],
        optional_fields: schema?.optionalFields ?? [],
        complexity: newDocumentAnalysis.complexity,
        specialFeatures: newDocumentAnalysis.specialFeatures,
      },
      memoryUpdate: {
        documentAnalysis: newDocumentAnalysis,
        processingHistoryItem: {
          type: 'function_call',
          content: `Document structure analyzed: ${document_type}`,
          functionCall: { name: 'analyze_document_structure', arguments: args },
          functionResult: { success: true, data: { document_type, extraction_strategy, confidence } },
          timestamp: Date.now(),
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Document analysis failed',
    };
  }
}

// Helper functions

/**
 * Validate field value based on validation rule
 */
function validateFieldValue(value: string, rule: string): { isValid: boolean; message: string } {
  switch (rule) {
    case 'email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return {
        isValid: emailRegex.test(value),
        message: emailRegex.test(value) ? 'Valid email format' : 'Invalid email format',
      };
    }
    case 'phone': {
      const phoneRegex = /^\+?[\d\s\-()]+$/;
      return {
        isValid: phoneRegex.test(value) && value.replace(/\D/g, '').length >= 10,
        message: phoneRegex.test(value) ? 'Valid phone format' : 'Invalid phone format',
      };
    }
    case 'date': {
      const dateRegex = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$|^\d{2}\/\d{2}\/\d{4}([ T]\d{2}:\d{2}(:\d{2})?)?$|^\d{2}-\d{2}-\d{4}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
      return {
        isValid: dateRegex.test(value),
        message: dateRegex.test(value) ? 'Valid date format' : 'Invalid date format',
      };
    }
    case 'currency': {
      const currencyRegex = /^\$?\d+(\.\d{2})?$/;
      return {
        isValid: currencyRegex.test(value),
        message: currencyRegex.test(value) ? 'Valid currency format' : 'Invalid currency format',
      };
    }
    case 'number': {
      const numberRegex = /^\d+(\.\d+)?$/;
      return {
        isValid: numberRegex.test(value),
        message: numberRegex.test(value) ? 'Valid number format' : 'Invalid number format',
      };
    }
    default:
      return { isValid: true, message: 'No validation rule applied' };
  }
}

function inferValidationRule(fieldName: string): string | undefined {
  const lowerFieldName = fieldName.toLowerCase();

  if (lowerFieldName.includes('email')) return 'email';
  if (lowerFieldName.includes('phone')) return 'phone';
  if (lowerFieldName.includes('date')) return 'date';
  if (
    lowerFieldName.includes('amount')
    || lowerFieldName === 'total'
    || lowerFieldName === 'subtotal'
    || lowerFieldName.includes('tax')
  ) {
    return 'currency';
  }

  return undefined;
}

function applyCodeDrivenReviews(fields: Record<string, AgentMemory['extractedFields'][string]>) {
  const reviewMemory = {
    extractedFields: fields,
  } as Readonly<AgentMemory>;

  for (const [fieldName, field] of Object.entries(fields)) {
    const formatResult = validateFieldFormat(field.value, fieldName);
    const consistencyResult = validateFieldConsistency(field.value, fieldName, reviewMemory);
    const crossReferenceResult = validateFieldCrossReference(field.value, fieldName, reviewMemory);

    const failedReview = !formatResult.isValid
      ? formatResult
      : !consistencyResult.isValid
        ? consistencyResult
      : !crossReferenceResult.isValid
        ? crossReferenceResult
        : null;

    fields[fieldName] = {
      ...field,
      isValid: failedReview ? false : field.isValid ?? true,
      validationMessage: failedReview
        ? failedReview.message
        : field.validationMessage || formatResult.message,
    };
  }
}

/**
 * Validate field format
 */
function validateFieldFormat(value: string, fieldName: string): { isValid: boolean; message: string } {
  // Basic format validation based on field name patterns
  if (fieldName.toLowerCase().includes('email')) {
    return validateFieldValue(value, 'email');
  } else if (fieldName.toLowerCase().includes('phone')) {
    return validateFieldValue(value, 'phone');
  } else if (fieldName.toLowerCase().includes('date')) {
    return validateFieldValue(value, 'date');
  } else if (fieldName.toLowerCase().includes('amount') || fieldName.toLowerCase().includes('total')) {
    return validateFieldValue(value, 'currency');
  }
  
  return { isValid: true, message: 'Format validation passed' };
}

/**
 * Validate field consistency with other fields
 */
function validateFieldConsistency(value: string, fieldName: string, memory: Readonly<AgentMemory>): { isValid: boolean; message: string } {
  // Check consistency with other extracted fields
  const existingFields = memory.extractedFields;
  
  // Example: Check if total matches sum of line items
  if (fieldName.toLowerCase().includes('total')) {
    const lineItems = Object.entries(existingFields)
      .filter(([key]) => key.toLowerCase().includes('item') || key.toLowerCase().includes('line'))
      .map(([, field]) => parseFloat(field.value) || 0);
    
    if (lineItems.length > 0) {
      const calculatedTotal = lineItems.reduce((sum, item) => sum + item, 0);
      const extractedTotal = parseFloat(value) || 0;
      const isConsistent = Math.abs(calculatedTotal - extractedTotal) < 0.01;
      
      return {
        isValid: isConsistent,
        message: isConsistent ? 'Total matches sum of line items' : 'Total does not match sum of line items',
      };
    }
  }
  
  return { isValid: true, message: 'Consistency validation passed' };
}

/**
 * Validate field cross-reference
 */
function validateFieldCrossReference(value: string, fieldName: string, memory: Readonly<AgentMemory>): { isValid: boolean; message: string } {
  const existingFields = memory.extractedFields;
  const lowerFieldName = fieldName.toLowerCase();

  // Date Cross-References
  if (lowerFieldName.includes('date')) {
    const currentDate = new Date(value);
    if (isNaN(currentDate.getTime())) {
      return { isValid: false, message: 'Invalid date format' };
    }

    // Check Due Date vs Invoice Date
    if (lowerFieldName.includes('due')) {
      const invoiceDateField = Object.entries(existingFields).find(([key]) => key.toLowerCase().includes('invoice') && key.toLowerCase().includes('date'));
      if (invoiceDateField) {
        const invoiceDate = new Date(invoiceDateField[1].value);
        if (!isNaN(invoiceDate.getTime()) && currentDate < invoiceDate) {
          return { isValid: false, message: 'Due date cannot be before invoice date' };
        }
      }
    }
  }

  // Arithmetic Cross-References (Total vs Subtotal + Tax)
  if (lowerFieldName === 'total' || lowerFieldName === 'total_amount' || lowerFieldName === 'grand_total') {
    let subtotal = 0;
    let tax = 0;
    let foundComponents = false;

    for (const [key, field] of Object.entries(existingFields)) {
      const k = key.toLowerCase();
      if (k.includes('subtotal') || k.includes('net_amount')) {
        subtotal = parseFloat(field.value);
        foundComponents = true;
      }
      if (k.includes('tax') || k.includes('vat')) {
        tax = parseFloat(field.value);
        foundComponents = true;
      }
    }

    if (foundComponents) {
      const calculatedTotal = subtotal + tax;
      const extractedTotal = parseFloat(value);
      if (!isNaN(extractedTotal) && Math.abs(calculatedTotal - extractedTotal) > 0.05) { // 0.05 tolerance for rounding
         return { isValid: false, message: `Total (${extractedTotal}) does not match Subtotal + Tax (${calculatedTotal.toFixed(2)})` };
      }
    }
  }

  return { isValid: true, message: 'Cross-reference validation passed' };
}

/**
 * Determine document complexity
 */
function determineComplexity(layoutAnalysis: Record<string, unknown>): 'low' | 'medium' | 'high' {
  // Simple heuristic - can be made more sophisticated
  const features = Array.isArray(layoutAnalysis?.features) ? layoutAnalysis.features : [];
  if (features.length > 10) return 'high';
  if (features.length > 5) return 'medium';
  return 'low';
}

/**
 * Extract special features from layout analysis
 */
function extractSpecialFeatures(layoutAnalysis: Record<string, unknown>): string[] {
  // Extract special features from layout analysis
  const features = layoutAnalysis?.specialFeatures;
  return Array.isArray(features) ? features : [];
}
