import { type Content, type FunctionDeclaration } from '@google/genai';
import { logger } from './logger';
import {
  contentToInteractionInput,
  createInteractionTurn,
  createInteractionFunctionTools,
  createInteractionGenerationConfig,
  extractInteractionFunctionCalls,
  extractInteractionText,
  extractInteractionThoughtSummaries,
  outputsToModelTurn,
  runModelInteraction,
  type InteractionTurn,
} from './gemini/interactions';
import {
  AgentClientConfig,
  AgentFunctionCall,
  AgentLoopConfig,
  AgentMemory,
  AgentStep,
  AgentFunctionResult,
  StepCallback,
  AgentTurnResult
} from './agentTypes';
import { applyMemoryUpdate } from './agentLoop';
import { buildAgentSchemaGuidance, getAgentReadiness } from './agentSchema';

import {
  executeReOcrRegion,
  executeExtractFieldsBatch,
  executeAnalyzeDocumentStructure,
} from './agentTools';

/**
 * Maximum number of inner rounds within a single turn to prevent infinite tool-calling loops
 */
const MAX_INNER_ROUNDS = 10;

/**
 * Execute a full agent turn with multi-turn function calling.
 *
 * This is the core of the agentic protocol: Gemini calls tools, we execute them
 * and send results back, allowing the model to chain tools intelligently rather
 * than firing all tools at once.
 */
export async function executeAgentTurn(
  systemPrompt: string,
  inputContent: Content,
  transcript: InteractionTurn[],
  functions: FunctionDeclaration[],
  fileData: string,
  mimeType: string,
  memory: AgentMemory,
  clientConfig: AgentClientConfig,
  config: AgentLoopConfig,
  onStep: StepCallback,
): Promise<AgentTurnResult> {
  if (!clientConfig.apiKey) {
    throw new Error('Please set your API key in settings');
  }

  const generationConfig = createInteractionGenerationConfig({
    temperature: config.temperature,
    topP: 0.95,
    maxOutputTokens: config.maxTokens || 4096,
    toolChoice: 'validated',
  }, clientConfig.thinkingConfig);
  const tools = createInteractionFunctionTools(functions);
  const allSteps: AgentStep[] = [];
  transcript.push(createInteractionTurn('user', contentToInteractionInput(inputContent)));

  for (let round = 0; round < MAX_INNER_ROUNDS; round++) {
    if (clientConfig.abortSignal?.aborted) {
      throw new Error('Agent processing cancelled');
    }

    const interaction = await runModelInteraction({
      apiKey: clientConfig.apiKey,
      model: clientConfig.model,
      input: transcript,
      systemInstruction: systemPrompt,
      tools,
      generationConfig,
      abortSignal: clientConfig.abortSignal,
      store: false,
    });
    const outputs = interaction.outputs || [];
    const modelTurn = outputsToModelTurn(outputs);
    if (modelTurn) {
      transcript.push(modelTurn);
    }

    for (const thoughtSummary of extractInteractionThoughtSummaries(outputs)) {
      const thinkingStep: AgentStep = {
        type: 'thinking',
        content: thoughtSummary,
        timestamp: Date.now(),
      };
      onStep(thinkingStep);
      allSteps.push(thinkingStep);
    }

    const responseText = extractInteractionText(outputs);
    if (responseText) {
      const responseStep: AgentStep = {
        type: 'thinking',
        content: responseText,
        timestamp: Date.now(),
      };
      onStep(responseStep);
      allSteps.push(responseStep);
    }

    const functionCalls: AgentFunctionCall[] = extractInteractionFunctionCalls(outputs);
    if (functionCalls.length === 0) {
      return {
        finished: true,
        steps: allSteps,
      };
    }

    if (functionCalls.length > 1) {
      const sequencingStep: AgentStep = {
        type: 'thinking',
        content: `Model requested ${functionCalls.length} tool calls in one round; enforcing sequential execution.`,
        timestamp: Date.now(),
      };
      onStep(sequencingStep);
      allSteps.push(sequencingStep);
    }

    const functionResults = [];

    for (const [index, fc] of functionCalls.entries()) {
      const callStep: AgentStep = {
        type: 'function_call',
        content: `Executing: ${fc.name}`,
        functionCall: fc,
        timestamp: Date.now(),
      };
      onStep(callStep);
      allSteps.push(callStep);

      const result = await executeFunctionCall(fc, fileData, mimeType, memory, clientConfig);
      applyMemoryUpdate(memory, result.memoryUpdate);

      const resultStep: AgentStep = {
        type: 'result',
        content: result.success ? `${fc.name} completed` : `${fc.name} returned an error`,
        functionCall: fc,
        functionResult: result,
        timestamp: Date.now(),
      };
      onStep(resultStep);
      allSteps.push(resultStep);

      functionResults.push({
        type: 'function_result' as const,
        call_id: fc.id || `${fc.name}-${round + 1}-${index + 1}`,
        name: fc.name,
        is_error: !result.success,
        result: {
          success: result.success,
          error: result.error ?? null,
          data: result.data ?? null,
        },
      });
    }

    transcript.push(createInteractionTurn('user', functionResults));
  }

  return {
    finished: false,
    steps: allSteps,
  };
}

/**
 * Execute a function call and return the result
 */
export async function executeFunctionCall(
  functionCall: AgentFunctionCall,
  fileData: string,
  mimeType: string,
  memory: Readonly<AgentMemory>,
  clientConfig: AgentClientConfig,
): Promise<AgentFunctionResult> {
  const { name, arguments: args } = functionCall;

  try {
    switch (name) {
      case 're_ocr_region':
        return await executeReOcrRegion(args, fileData, mimeType, memory, clientConfig);

      case 'extract_fields_batch':
        return await executeExtractFieldsBatch(args, fileData, mimeType, memory);

      case 'analyze_document_structure':
        return await executeAnalyzeDocumentStructure(args, fileData, mimeType, memory);

      default:
        throw new Error(`Unknown function: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Function execution failed';
    const errorDetails = {
      functionName: name,
      arguments: args,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    };
    logger.error(`Error executing function ${name}:`, errorDetails);

    return {
      success: false,
      error: `${name} failed: ${errorMessage}`,
      data: { errorDetails },
    };
  }
}

/**
 * Create initial system prompt for the agent
 */
export function createAgentSystemPrompt(documentType?: string): string {
  const schemaGuidance = buildAgentSchemaGuidance(documentType);

  return `You are a structured data extraction agent specialized in identifying and extracting specific fields from documents.

WORKFLOW:
1. **Analyze**: Call analyze_document_structure to understand document type and layout
2. **Extract**: Call extract_fields_batch with every field you can confidently identify in this pass
3. **Refine**: If key fields are missing or low-confidence, call re_ocr_region on the specific normalized page area
4. **Repeat**: After re_ocr_region, call extract_fields_batch again with improved values

IMPORTANT: Call ONE tool at a time. Wait for the result before deciding your next action.
Do NOT call multiple tools simultaneously - chain them sequentially based on results.
After analyze_document_structure, use the returned required_fields and optional_fields as your canonical field names.
The runtime, not you, decides when extraction is complete. Do not try to simulate a finalization step.

FIELD EXTRACTION RULES:
- Extract SPECIFIC FIELDS, not full document text
- Each field represents ONE piece of structured information (name, date, amount, etc.)
- Always provide the ACTUAL TEXT VALUE you see, not a description
- Include confidence score (0.0-1.0) based on text clarity
- Include location for fields that may need refinement as {page, x, y, width, height, units:"normalized"}
- Prefer one high-quality extract_fields_batch call over many tiny batches
- Reuse canonical field names exactly

CORRECT EXAMPLES:
✓ extract_fields_batch(fields=[{field_name:"invoice_number", field_value:"INV-2024-001", confidence:0.95, location:{page:1,x:0.72,y:0.08,width:0.18,height:0.05,units:"normalized"}},{field_name:"customer_name", field_value:"Acme Corporation", confidence:0.92}])
✓ extract_fields_batch(fields=[{field_name:"email", field_value:"jordan@example.com", confidence:0.98, validation_rule:"email", location:{page:1,x:0.18,y:0.62,width:0.34,height:0.05,units:"normalized"}}])
✓ re_ocr_region(region:{page:1,x:0.70,y:0.05,width:0.22,height:0.10,units:"normalized"}, focus:"invoice total")

INCORRECT EXAMPLES:
✗ extract_fields_batch(fields=[{field_name:"invoice", field_value:"I see an invoice number in the top right", confidence:0.8}])
✗ extract_fields_batch(fields=[{field_name:"document", field_value:"This is a financial document", confidence:0.9}])
✗ extract_fields_batch(fields=[{field_name:"text", field_value:"There is text on the page", confidence:0.7}])

DOCUMENT-SPECIFIC FIELDS:
- **Invoices**: vendor_name, invoice_number, invoice_date, customer_name, total_amount, due_date, currency, subtotal_amount, tax_amount, line_items
- **Resumes**: full_name, email, phone_number, location, job_title, skills, experience, education
- **Forms**: All labeled fields and their corresponding values
- **Receipts**: merchant_name, transaction_date, total_amount, receipt_number, payment_method, subtotal_amount, tax_amount, items
- **Business cards**: full_name, job_title, company_name, email, phone_number, website, address
- **Contracts**: parties, effective_date, terms, signatures, clauses

CONFIDENCE SCORING:
- 0.95-1.0: Printed text, clear and unambiguous
- 0.85-0.94: Slightly degraded but readable
- 0.70-0.84: Handwritten or low quality, but interpretable
- Below 0.70: Consider using re_ocr_region to improve

${documentType ? `Document Type: ${documentType}` : 'Document Type: Unknown - analyze first'}
${schemaGuidance}

Remember: You are extracting structured data fields, not performing full OCR. Focus on identifying and extracting key information fields.`;
}

/**
 * Create user prompt for the initial document processing (iteration 1)
 */
export function createUserPrompt(
  fileName: string,
  iteration: number,
  previousResults?: Record<string, unknown>
): string {
  let prompt = `Process this document: ${fileName}

This is iteration ${iteration} of the autonomous extraction process.`;

  if (previousResults && Object.keys(previousResults).length > 0) {
    prompt += `\n\nPrevious extraction results:
${JSON.stringify(previousResults, null, 2)}

Analyze these results and determine if improvement is needed. Focus on fields with low confidence or missing information.`;
  }

  prompt += `\n\nBegin processing now.`;

  return prompt;
}

/**
 * Create a follow-up prompt for iterations 2+ (no image re-send needed)
 */
export function createFollowUpPrompt(
  iteration: number,
  memory: AgentMemory
): string {
  const extractedFields = memory.extractedFields;
  const readiness = getAgentReadiness(memory);
  const fieldCount = Object.keys(extractedFields).length;
  const fieldSummary = Object.entries(extractedFields)
    .map(([name, field]) => `  - ${name}: "${field.value}" (confidence: ${field.confidence.toFixed(2)})`)
    .join('\n');
  const missingRequired = readiness.missingRequiredFields.length > 0
    ? `\nMissing required fields: ${readiness.missingRequiredFields.join(', ')}`
    : '\nMissing required fields: none';
  const canonicalFields = readiness.hasSchema
    ? `\nCanonical required fields: ${readiness.requiredFields.join(', ')}`
    : '';

  return `This is iteration ${iteration}. Review your previous extractions and improve:

Extracted ${fieldCount} fields so far:
${fieldSummary || '  (none)'}
${missingRequired}
${canonicalFields}

Focus on:
- Fields with confidence below 0.85 that need re-extraction
- Missing required fields that should be present for this document type
- Validation of extracted values against each other
- Reusing normalized field locations when you need a true region refinement

If you can improve the result, call re_ocr_region and then extract_fields_batch again. Otherwise stop calling tools.`;
}
