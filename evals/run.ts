import process from 'node:process';
import path from 'node:path';

import { extractTextFromFile, type ExtractedContent, type GeminiModel, type ThinkingLevel } from '../src/lib/gemini';
import { agentLoop } from '../src/lib/agentLoop';
import { getAgentReadiness, normalizeAgentDocumentType, normalizeAgentFieldName } from '../src/lib/agentSchema';
import {
  buildEvalSummary,
  evaluateEvalCase,
  renderEvalSummaryMarkdown,
  type EvalCase,
  type EvalExecutionMetadata,
  type EvalRunOutput,
  toEvalRunOutput,
} from '../src/lib/evals';
import type { AgentClientConfig, AgentMemory } from '../src/lib/agentTypes';
import { getGeminiUsage, resetGeminiUsage, type GeminiUsageSnapshot } from '../src/lib/gemini/usage';
import { getExtractionPreset, runExtractionPreset } from '../src/lib/templates';
import {
  assertEvalInputsExist,
  fileToDataUrl,
  loadEvalCases,
  loadEvalGroundTruth,
  loadEvalSuiteConfig,
  resolveModelName,
  resolveRepeatCount,
  resolveSuiteName,
  writeEvalArtifacts,
  writeEvalSummary,
  type EvalArtifact,
} from './shared';

function extractedContentToMarkdown(result: ExtractedContent): string {
  if (result.markdown) {
    return result.markdown;
  }

  const sections = result.sections.flatMap((section) => {
    const heading = section.heading ? [`## ${section.heading}`] : [];
    return [...heading, ...section.content, ''];
  });

  return [result.title ? `# ${result.title}` : '# OCR Extraction', '', ...sections].join('\n').trim();
}

function agentMemoryToMarkdown(memory: AgentMemory): string {
  const fields = Object.entries(memory.extractedFields);
  const lines = [
    '# Agentic OCR Extraction',
    '',
    `Document type: ${memory.documentAnalysis.documentType || 'unknown'}`,
    `Confidence: ${(memory.confidence * 100).toFixed(0)}%`,
    `Iterations: ${memory.currentIteration}`,
    `Fields extracted: ${fields.length}`,
    '',
    '## Fields',
    '',
  ];

  if (fields.length === 0) {
    lines.push('- None');
  } else {
    for (const [fieldName, field] of fields) {
      lines.push(`- ${fieldName}: ${field.value}`);
    }
  }

  return lines.join('\n');
}

function normalizeAgentFields(fields: AgentMemory['extractedFields'], documentType: string) {
  const normalized: Record<string, unknown> = {};
  const normalizedDocumentType = normalizeAgentDocumentType(documentType);

  for (const [fieldName, field] of Object.entries(fields)) {
    const canonicalName = normalizeAgentFieldName(normalizedDocumentType, fieldName);
    if (!(canonicalName in normalized)) {
      normalized[canonicalName] = field;
    }
  }

  return normalized;
}

function agentMemoryToEvalOutput(memory: AgentMemory) {
  const readiness = getAgentReadiness(memory);

  return {
    markdown: agentMemoryToMarkdown(memory),
    json: {
      documentType: normalizeAgentDocumentType(memory.documentAnalysis.documentType || 'unknown'),
      confidence: memory.confidence,
      currentIteration: memory.currentIteration,
      fieldCount: Object.keys(memory.extractedFields).length,
      extractedFields: memory.extractedFields,
      normalizedFields: normalizeAgentFields(memory.extractedFields, memory.documentAnalysis.documentType),
      specialFeatures: memory.documentAnalysis.specialFeatures,
      requiredFields: readiness.requiredFields,
      missingRequiredFields: readiness.missingRequiredFields,
      requiredCoverage: readiness.requiredCoverage,
    },
  };
}

async function runSimpleEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig): Promise<EvalRunOutput> {
  const { dataUrl, mimeType } = await fileToDataUrl(evalCase.inputPath);
  const result = await extractTextFromFile(
    dataUrl,
    mimeType,
    clientConfig,
    undefined,
    {
      outputFormat: 'markdown',
    },
  );

  return {
    markdown: extractedContentToMarkdown(result),
    json: result,
  };
}

async function runTemplateEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig): Promise<EvalRunOutput> {
  const { dataUrl, mimeType } = await fileToDataUrl(evalCase.inputPath);
  const result = await runExtractionPreset(
    dataUrl,
    mimeType,
    clientConfig,
    getExtractionPreset(evalCase.presetId || ''),
  );

  return toEvalRunOutput(result);
}

interface AgenticEvalOutput {
  output: EvalRunOutput;
  iterations: number;
  toolCalls: number;
}

async function runAgenticEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig): Promise<AgenticEvalOutput> {
  const { dataUrl, mimeType } = await fileToDataUrl(evalCase.inputPath);
  const file = new File(['eval fixture'], path.basename(evalCase.inputPath), { type: mimeType });
  const generator = agentLoop(
    file,
    dataUrl,
    clientConfig,
    {
      maxIterations: evalCase.agentConfig?.maxIterations ?? 4,
      confidenceThreshold: evalCase.agentConfig?.confidenceThreshold ?? 0.65,
      maxTokens: 4096,
    },
  );

  let current = await generator.next();
  while (!current.done) {
    current = await generator.next();
  }

  const memory = current.value as AgentMemory;
  return {
    output: agentMemoryToEvalOutput(memory),
    iterations: memory.currentIteration,
    toolCalls: memory.processingHistory.length,
  };
}

interface CompletedEvalCase {
  result: ReturnType<typeof evaluateEvalCase>;
  artifact: EvalArtifact;
}

function estimateCost(usage: GeminiUsageSnapshot): number | undefined {
  const inputRate = Number(process.env.EVAL_INPUT_USD_PER_MILLION);
  const outputRate = Number(process.env.EVAL_OUTPUT_USD_PER_MILLION);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate) || inputRate < 0 || outputRate < 0) return undefined;
  const billableInput = usage.inputTokens + usage.toolTokens;
  const billableOutput = usage.outputTokens + usage.thoughtTokens;
  return ((billableInput * inputRate) + (billableOutput * outputRate)) / 1_000_000;
}

function executionMetadata(
  startedAt: number,
  extras: Pick<EvalExecutionMetadata, 'iterations' | 'toolCalls'>,
  runtimeError?: string,
  repeatIndex?: number,
): EvalExecutionMetadata {
  const usage = getGeminiUsage();
  return {
    durationMs: performance.now() - startedAt,
    repeatIndex,
    ...extras,
    apiRequests: usage.requests,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    thoughtTokens: usage.thoughtTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: estimateCost(usage),
    runtimeError,
  };
}

async function runEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig, repeatIndex: number): Promise<CompletedEvalCase> {
  resetGeminiUsage();
  const startedAt = performance.now();
  let output: EvalRunOutput = { markdown: '' };
  let executionExtras: Pick<EvalExecutionMetadata, 'iterations' | 'toolCalls'> = {};
  try {
    if (evalCase.mode === 'template') {
      output = await runTemplateEvalCase(evalCase, clientConfig);
    } else if (evalCase.mode === 'agentic') {
      const agenticResult = await runAgenticEvalCase(evalCase, clientConfig);
      output = agenticResult.output;
      executionExtras = { iterations: agenticResult.iterations, toolCalls: agenticResult.toolCalls };
    } else {
      output = await runSimpleEvalCase(evalCase, clientConfig);
    }
    const groundTruth = await loadEvalGroundTruth(evalCase);
    const execution = executionMetadata(startedAt, executionExtras, undefined, repeatIndex);
    return {
      result: evaluateEvalCase(evalCase, output, groundTruth, execution),
      artifact: { evalCase, output, repeatIndex },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const execution = executionMetadata(startedAt, executionExtras, message, repeatIndex);
    let groundTruth;
    try {
      groundTruth = await loadEvalGroundTruth(evalCase);
    } catch {
      // The runtime error below remains the actionable failure if loading the
      // reference also fails.
    }
    return {
      result: evaluateEvalCase(evalCase, output, groundTruth, execution),
      artifact: { evalCase, output, repeatIndex },
    };
  }
}

function resolveThinkingLevel(model: GeminiModel): ThinkingLevel {
  const isFlashFamily = model === 'gemini-3-flash-preview'
    || model === 'gemini-3.5-flash'
    || model === 'gemini-3.1-flash-lite';
  const allowedLevels: ThinkingLevel[] = isFlashFamily
    ? ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']
    : ['LOW', 'MEDIUM', 'HIGH'];
  const envLevel = process.env.GEMINI_THINKING_LEVEL?.toUpperCase();

  if (envLevel && allowedLevels.includes(envLevel as ThinkingLevel)) {
    return envLevel as ThinkingLevel;
  }

  if (model === 'gemini-3.1-flash-lite') return 'MINIMAL';
  if (model === 'gemini-3.5-flash') return 'MEDIUM';
  return 'HIGH';
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to run live evals.');
  }

  const model = resolveModelName() as GeminiModel;
  const suite = resolveSuiteName();
  const repeatCount = resolveRepeatCount();
  const thinkingLevel = resolveThinkingLevel(model);
  const evalCases = await loadEvalCases(suite);
  if (evalCases.length === 0) {
    const setupHint = suite === 'benchmark' ? ' Run `npm run evals:setup` first.' : '';
    throw new Error(`No eval cases are installed for the "${suite}" suite.${setupHint}`);
  }
  const suiteConfig = await loadEvalSuiteConfig();
  const clientConfig: AgentClientConfig = {
    apiKey,
    model,
    thinkingConfig: {
      level: thinkingLevel,
      includeThoughts: false,
    },
  };

  await assertEvalInputsExist(evalCases);

  const caseResults = [];
  const artifacts: EvalArtifact[] = [];

  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
    for (const evalCase of evalCases) {
      const completed = await runEvalCase(evalCase, clientConfig, repeatIndex);
      caseResults.push(completed.result);
      artifacts.push(completed.artifact);
    }
  }

  const summary = buildEvalSummary(model, caseResults, suiteConfig, suite);
  if (repeatCount > 1) {
    summary.notes = [...(summary.notes ?? []), `Each case was run ${repeatCount} times; aggregate metrics include all repetitions.`];
  }
  const markdown = renderEvalSummaryMarkdown(summary);

  await writeEvalSummary(summary, markdown);
  const artifactDirectory = await writeEvalArtifacts(summary, artifacts);
  console.log(`Wrote eval artifacts to ${path.relative(process.cwd(), artifactDirectory)}`);

  if (summary.status === 'failed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
