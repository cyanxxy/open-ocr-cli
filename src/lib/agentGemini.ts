import { type Content, type FunctionDeclaration } from '@google/genai';
import { logger } from './logger';
import {
  contentToInteractionInput,
  createUserInputStep,
  createInteractionFunctionTools,
  createInteractionGenerationConfig,
  extractInteractionFunctionCalls,
  extractInteractionModelErrors,
  extractInteractionText,
  extractInteractionThoughtSummaries,
  getInteractionSteps,
  selectModelStepsForReplay,
  runModelInteraction,
  type InteractionStep,
} from './gemini/interactions';
import {
  AgentClientConfig,
  AgentFunctionCall,
  AgentLoopConfig,
  AgentMemory,
  AgentStep,
  AgentFunctionResult,
  AgentInteractionState,
  StepCallback,
  AgentTurnResult
} from './agentTypes';
import { applyMemoryUpdate } from './agentMemory';
import { isFatalGeminiError, isRetryableGeminiError } from './gemini/client';
import { isGeminiCostLimitError } from './gemini/requestPolicy';
import { buildAgentSchemaGuidance, getAgentReadiness } from './agentSchema';
import type { GeminiModel } from './gemini/types';

import {
  executeReOcrRegion,
  executeExtractFieldsBatch,
  executeAnalyzeDocumentStructure,
} from './agentTools';

/**
 * Maximum number of inner rounds within a single turn to prevent infinite tool-calling loops
 */
const MAX_INNER_ROUNDS = 10;

interface FunctionResultPayload {
  success: boolean;
  error: string | null;
  data: unknown;
}

/** Build the documented Interactions function-result content-block shape. */
function createFunctionResultInput(
  callId: string,
  name: string,
  payload: FunctionResultPayload,
  isError: boolean,
): InteractionStep {
  return {
    type: 'function_result',
    call_id: callId,
    name,
    is_error: isError,
    result: [{
      type: 'text',
      text: JSON.stringify(payload),
    }],
  };
}

/**
 * Execute a full agent turn with multi-turn function calling.
 *
 * This is the core of the agentic protocol: Gemini calls tools, we execute them
 * and send results back, allowing the model to chain tools intelligently rather
 * than firing all tools at once.
 *
 * The API conversation is stateful: the first request contains the document,
 * then each request chains from `previous_interaction_id` with incremental
 * function results or follow-up text. `transcript` is a faithful local audit
 * log; it is not resent to the API.
 */
export async function executeAgentTurn(
  systemPrompt: string,
  inputContent: Content,
  transcript: InteractionStep[],
  interactionState: AgentInteractionState,
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
    maxOutputTokens: config.maxTokens || 16384,
    toolChoice: 'validated',
  }, clientConfig.model as GeminiModel, clientConfig.thinkingConfig);
  const tools = createInteractionFunctionTools(functions);
  const allSteps: AgentStep[] = [];
  let hasCalledTools = false;
  let nudgedToUseTools = false;

  // A transient failure can resume the exact uncommitted input without
  // duplicating the user turn or re-running an already completed local tool.
  if (!interactionState.pendingInput?.length) {
    const userInput = createUserInputStep(contentToInteractionInput(inputContent));
    transcript.push(userInput);
    interactionState.pendingInput = [userInput];
  }

  for (let round = 0; round < MAX_INNER_ROUNDS; round++) {
    if (clientConfig.abortSignal?.aborted) {
      throw new Error('Agent processing cancelled');
    }

    const previousInteractionId = interactionState.previousInteractionId;
    const streamProgress = clientConfig.progress !== undefined && clientConfig.progress !== 'off';
    const interaction = await runModelInteraction({
      apiKey: clientConfig.apiKey,
      model: clientConfig.model as GeminiModel,
      baseUrl: clientConfig.baseUrl,
      headers: clientConfig.headers,
      input: interactionState.pendingInput,
      // previous_interaction_id preserves conversation history only. Tools,
      // system instructions, and generation settings are interaction-scoped,
      // so Gemini requires them on every continuation request. Input remains
      // incremental, which avoids retransmitting the document image.
      systemInstruction: systemPrompt,
      tools,
      generationConfig,
      ...(previousInteractionId ? { previousInteractionId } : {}),
      abortSignal: clientConfig.abortSignal,
      store: true,
      runtime: clientConfig.runtime,
      ...(streamProgress ? {
        onProgress: (delta): void => {
          const liveStep: AgentStep = {
            type: 'thinking',
            source: delta.kind,
            id: delta.stepId,
            delta: true,
            content: delta.text,
            timestamp: Date.now(),
          };
          onStep(liveStep);
          allSteps.push(liveStep);
        },
      } : {}),
    });

    if (interaction.status !== 'completed' && interaction.status !== 'requires_action') {
      throw new Error(`Agent interaction ended with unsuccessful status "${interaction.status ?? 'unknown'}"`);
    }
    if (!interaction.id) {
      throw new Error('Agent interaction returned no interaction ID');
    }

    interactionState.previousInteractionId = interaction.id;
    interactionState.pendingInput = undefined;

    const steps = getInteractionSteps(interaction);
    const modelErrors = extractInteractionModelErrors(steps);
    if (modelErrors.length > 0) {
      throw new Error(`Agent model output failed: ${modelErrors.join('; ')}`);
    }

    const functionCalls = extractInteractionFunctionCalls(steps);
    if (interaction.status === 'requires_action' && functionCalls.length === 0) {
      throw new Error('Agent interaction requires action but returned no function call');
    }

    // Keep every returned step object untouched in the local transcript.
    const replaySteps = selectModelStepsForReplay(steps);
    if (replaySteps.length > 0) {
      transcript.push(...replaySteps);
    }

    if (!interaction.streamedProgressKinds?.includes('thought_summary')) {
      for (const thoughtSummary of extractInteractionThoughtSummaries(steps)) {
        const thinkingStep: AgentStep = {
          type: 'thinking',
          source: 'thought_summary',
          content: thoughtSummary,
          timestamp: Date.now(),
        };
        onStep(thinkingStep);
        allSteps.push(thinkingStep);
      }
    }

    if (functionCalls.length === 0) {
      // Closing prose (no tool call) is surfaced here as activity; prose that
      // merely precedes a tool call is not (audit A-09).
      const responseText = extractInteractionText(steps, interaction.output_text);
      if (responseText && !interaction.streamedProgressKinds?.includes('model_output')) {
        const responseStep: AgentStep = {
          type: 'thinking',
          source: 'model_output',
          content: responseText,
          timestamp: Date.now(),
        };
        onStep(responseStep);
        allSteps.push(responseStep);
      }

      // A turn with no tool calls is only a genuine completion if the agent has already
      // done work. Nudge once before giving up on an empty opener.
      const hasExtraction = Object.keys(memory.extractedFields).length > 0;
      if (!hasCalledTools && !hasExtraction && !nudgedToUseTools && round < MAX_INNER_ROUNDS - 1) {
        nudgedToUseTools = true;
        const nudgeStep: AgentStep = {
          type: 'thinking',
          source: 'runtime',
          content: 'No tool call received yet; prompting the agent to begin extraction with its tools.',
          timestamp: Date.now(),
        };
        onStep(nudgeStep);
        allSteps.push(nudgeStep);
        const nudgeInput = createUserInputStep([{
          type: 'text',
          text: 'You have not called any tools yet and no fields have been extracted. '
            + 'Begin now by calling analyze_document_structure, then extract_fields_batch. '
            + 'Respond with a tool call, not prose.',
        }]);
        transcript.push(nudgeInput);
        interactionState.pendingInput = [nudgeInput];
        continue;
      }
      return {
        finished: true,
        steps: allSteps,
      };
    }

    hasCalledTools = true;

    // Prefer sequential decision-making: execute the first call for real.
    // Any additional parallel calls stay in the local history and receive
    // explicit error function_results so call/result counts match (Gemini
    // strict matching). The model can re-issue them after seeing the first result.
    if (functionCalls.length > 1) {
      const sequencingStep: AgentStep = {
        type: 'thinking',
        source: 'runtime',
        content: `Model requested ${functionCalls.length} tool calls at once; executing the first and returning explicit skip results for the rest so history stays valid.`,
        timestamp: Date.now(),
      };
      onStep(sequencingStep);
      allSteps.push(sequencingStep);
    }

    if (clientConfig.abortSignal?.aborted) {
      throw new Error('Agent processing cancelled');
    }

    // Surface every model-requested call before producing any matching result.
    // This keeps machine consumers' call/result correlation complete even when
    // the runtime deliberately declines parallel calls or the first tool fails.
    for (let callIndex = 0; callIndex < functionCalls.length; callIndex += 1) {
      const fc = functionCalls[callIndex];
      const callStep: AgentStep = {
        type: 'function_call',
        source: 'tool_call',
        id: fc.id,
        content: callIndex === 0
          ? `Executing: ${fc.name}`
          : `Queued parallel call for explicit sequential handling: ${fc.name}`,
        functionCall: fc,
        timestamp: Date.now(),
      };
      onStep(callStep);
      allSteps.push(callStep);
    }

    const functionResultInputs: InteractionStep[] = [];
    for (let callIndex = 0; callIndex < functionCalls.length; callIndex++) {
      const fc = functionCalls[callIndex];
      // extractInteractionFunctionCalls always assigns a stable id that matches
      // the ID from the unchanged function_call step.
      const callId = fc.id;

      if (callIndex === 0) {
        let result: AgentFunctionResult;
        try {
          result = await executeFunctionCall(fc, fileData, mimeType, memory, clientConfig);
        } catch (error) {
          const retryable = isRetryableGeminiError(error);
          const failureMessage = retryable
            ? `Temporary Gemini API failure while executing ${fc.name}; retry this tool.`
            : `Tool ${fc.name} failed: ${error instanceof Error ? error.message : String(error)}`;
          const failureResult: AgentFunctionResult = { success: false, error: failureMessage };
          const failureStep: AgentStep = {
            type: 'error',
            source: 'tool_result',
            id: callId,
            content: failureMessage,
            functionCall: fc,
            functionResult: failureResult,
            timestamp: Date.now(),
          };
          onStep(failureStep);
          allSteps.push(failureStep);

          const skippedCalls = functionCalls.slice(callIndex + 1);
          for (const skippedCall of skippedCalls) {
            const skippedMessage = retryable
              ? 'Skipped because an earlier parallel tool call failed transiently; re-issue this call.'
              : 'Not executed because an earlier parallel tool call failed.';
            const skippedResult: AgentFunctionResult = { success: false, error: skippedMessage };
            const skippedStep: AgentStep = {
              type: 'error',
              source: 'tool_result',
              id: skippedCall.id,
              content: skippedMessage,
              functionCall: skippedCall,
              functionResult: skippedResult,
              timestamp: Date.now(),
            };
            onStep(skippedStep);
            allSteps.push(skippedStep);
          }

          if (retryable) {
            // The model turn has already been committed and is waiting for a
            // matching function_result. Queue an explicit transient failure
            // before bubbling to the outer backoff loop; the retry will send
            // this incremental result instead of creating a new user turn.
            const transientResult = createFunctionResultInput(
              callId,
              fc.name,
              {
                success: false,
                error: failureMessage,
                data: null,
              },
              true,
            );
            transcript.push(transientResult);
            functionResultInputs.push(transientResult);

            // Gemini requires one result for every parallel function call.
            for (const skippedCall of skippedCalls) {
              const skippedResult = createFunctionResultInput(
                skippedCall.id,
                skippedCall.name,
                {
                  success: false,
                  error: 'Skipped because an earlier parallel tool call failed transiently; re-issue this call.',
                  data: null,
                },
                true,
              );
              transcript.push(skippedResult);
              functionResultInputs.push(skippedResult);
            }
            interactionState.pendingInput = functionResultInputs;
          }
          throw error;
        }
        applyMemoryUpdate(memory, result.memoryUpdate);

        const resultStep: AgentStep = {
          type: 'result',
          source: 'tool_result',
          id: callId,
          content: result.success ? `${fc.name} completed` : `${fc.name} returned an error`,
          functionCall: fc,
          functionResult: result,
          timestamp: Date.now(),
        };
        onStep(resultStep);
        allSteps.push(resultStep);

        const functionResultInput = createFunctionResultInput(
          callId,
          fc.name,
          {
            success: result.success,
            error: result.error ?? null,
            data: result.data ?? null,
          },
          !result.success,
        );
        transcript.push(functionResultInput);
        functionResultInputs.push(functionResultInput);
      } else {
        // Declined parallel call: still answer it so history validation succeeds.
        const skipMessage = 'Skipped: this agent executes one tool at a time. '
          + 'Re-issue this call after reviewing the prior tool result.';
        const skipResult: AgentFunctionResult = {
          success: false,
          error: skipMessage,
        };
        const resultStep: AgentStep = {
          type: 'result',
          source: 'tool_result',
          id: callId,
          content: `${fc.name} skipped (parallel batch)`,
          functionCall: fc,
          functionResult: skipResult,
          timestamp: Date.now(),
        };
        onStep(resultStep);
        allSteps.push(resultStep);

        const functionResultInput = createFunctionResultInput(
          callId,
          fc.name,
          {
            success: false,
            error: skipMessage,
            data: null,
          },
          true,
        );
        transcript.push(functionResultInput);
        functionResultInputs.push(functionResultInput);
      }
    }
    interactionState.pendingInput = functionResultInputs;
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
    // API-level failures must NOT be downgraded to a per-tool error result:
    // terminal ones (bad key, permission) should stop the run, and transient
    // ones (rate limit, 5xx, network) should bubble to the outer loop's backoff
    // instead of letting the model keep hammering the endpoint (audit H-17).
    if (
      isFatalGeminiError(error)
      || isRetryableGeminiError(error)
      || isGeminiCostLimitError(error)
      || (error instanceof Error && (error.name === 'ProviderApiError' || error.name === 'ProviderCostLimitError'))
    ) {
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
