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
import { applyMemoryUpdate } from './agentMemory';
import { isFatalGeminiError, isRetryableGeminiError } from './gemini/client';
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
  }, clientConfig.model, clientConfig.thinkingConfig);
  const tools = createInteractionFunctionTools(functions);
  const allSteps: AgentStep[] = [];
  let hasCalledTools = false;
  let nudgedToUseTools = false;

  // Snapshot the transcript length before appending this iteration's input.
  // If a model call throws partway through, we roll back to here so the shared
  // transcript never ends on a dangling user turn that would collide with the
  // next iteration's follow-up turn and produce two consecutive user turns
  // (audit A-04). Extracted fields already live in `memory`, so nothing is lost.
  const baseLength = transcript.length;
  transcript.push(createInteractionTurn('user', contentToInteractionInput(inputContent)));

  try {
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
      // outputsToModelTurn preserves thought blocks + signatures verbatim, which
      // stateless multi-turn function calling requires (audit C-02).
      const modelTurn = outputsToModelTurn(outputs);
      if (modelTurn) {
        // We answer only the first tool call this round (audit A-02). Keep only
        // the first function_call block in the replayed model turn so the single
        // function_result we send back correlates 1:1 — a model turn declaring
        // two calls with only one result would leave the second unanswered.
        let keptCall = false;
        modelTurn.content = modelTurn.content.filter((block) => {
          if (block.type !== 'function_call') return true;
          if (keptCall) return false;
          keptCall = true;
          return true;
        });
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

      const functionCalls: AgentFunctionCall[] = extractInteractionFunctionCalls(outputs);
      if (functionCalls.length === 0) {
        // Closing prose (no tool call) is surfaced here as activity; prose that
        // merely precedes a tool call is not (it would read as misleading
        // "reasoning" — audit A-09).
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

        // A turn with no tool calls is only a genuine completion if the agent has already
        // done work. Models (especially with thinking enabled) sometimes open with a prose
        // preamble and no tool call; treating that as "done" would end the run with zero
        // extracted fields. Nudge the model toward the tool workflow once before giving up.
        const hasExtraction = Object.keys(memory.extractedFields).length > 0;
        if (!hasCalledTools && !hasExtraction && !nudgedToUseTools && round < MAX_INNER_ROUNDS - 1) {
          nudgedToUseTools = true;
          const nudgeStep: AgentStep = {
            type: 'thinking',
            content: 'No tool call received yet; prompting the agent to begin extraction with its tools.',
            timestamp: Date.now(),
          };
          onStep(nudgeStep);
          allSteps.push(nudgeStep);
          transcript.push(createInteractionTurn('user', [{
            type: 'text',
            text: 'You have not called any tools yet and no fields have been extracted. '
              + 'Begin now by calling analyze_document_structure, then extract_fields_batch. '
              + 'Respond with a tool call, not prose.',
          }]));
          continue;
        }
        return {
          finished: true,
          steps: allSteps,
        };
      }

      hasCalledTools = true;

      // Enforce sequential DECISION-making, not just sequential execution: run
      // only the FIRST requested call, send its result back, and let the model
      // pick the next tool with that result in hand. Executing a whole batch
      // before the model sees any result deprives it of the chance to react
      // (audit A-02) and contradicts the "one tool at a time" system prompt.
      if (functionCalls.length > 1) {
        const sequencingStep: AgentStep = {
          type: 'thinking',
          content: `Model requested ${functionCalls.length} tool calls at once; executing only the first and returning its result before the next decision.`,
          timestamp: Date.now(),
        };
        onStep(sequencingStep);
        allSteps.push(sequencingStep);
      }

      const fc = functionCalls[0];

      // Re-check abort immediately before the (potentially expensive) tool call
      // so a cancellation between rounds is honored without running more work
      // (audit A-03).
      if (clientConfig.abortSignal?.aborted) {
        throw new Error('Agent processing cancelled');
      }

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

      transcript.push(createInteractionTurn('user', [{
        type: 'function_result' as const,
        call_id: fc.id || `${fc.name}-${round + 1}`,
        name: fc.name,
        is_error: !result.success,
        result: {
          success: result.success,
          error: result.error ?? null,
          data: result.data ?? null,
        },
      }]));
    }

    return {
      finished: false,
      steps: allSteps,
    };
  } catch (error) {
    transcript.length = baseLength;
    throw error;
  }
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
    // API-level failures must NOT be downgraded to a per-tool error result:
    // terminal ones (bad key, permission) should stop the run, and transient
    // ones (rate limit, 5xx, network) should bubble to the outer loop's backoff
    // instead of letting the model keep hammering the endpoint (audit H-17).
    if (isFatalGeminiError(error) || isRetryableGeminiError(error)) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Function execution failed';
    // Full diagnostics (arguments — which may contain extracted PII — and the
    // stack) stay in local logs only. The model receives a minimal, stable
    // message with no arguments or stack trace (audit H-15).
    logger.error(`Error executing function ${name}:`, {
      functionName: name,
      arguments: args,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      error: `${name} failed: ${errorMessage}`,
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
  iteration: number
): string {
  return `Process this document: ${fileName}

This is iteration ${iteration} of the autonomous extraction process.

Begin processing now.`;
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
