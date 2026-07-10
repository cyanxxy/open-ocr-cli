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
  type EvalCaseResult,
  toEvalRunOutput,
} from '../src/lib/evals';
import type { AgentClientConfig, AgentMemory } from '../src/lib/agentTypes';
import { getExtractionPreset, runExtractionPreset } from '../src/lib/templates';
import {
  assertEvalInputsExist,
  fileToDataUrl,
  loadEvalCases,
  loadEvalSuiteConfig,
  resolveModelName,
  writeEvalSummary,
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

function runtimeFailure(evalCase: EvalCase, error: unknown): EvalCaseResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: evalCase.id,
    passed: false,
    weight: evalCase.expectedAssertions.find((assertion) => assertion.type === 'pass_rate_weight')?.value ?? 1,
    failedAssertions: [`Eval runner error: ${message}`],
  };
}

async function runSimpleEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig) {
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

  return evaluateEvalCase(evalCase, {
    markdown: extractedContentToMarkdown(result),
    json: result,
  });
}

async function runTemplateEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig) {
  const { dataUrl, mimeType } = await fileToDataUrl(evalCase.inputPath);
  const result = await runExtractionPreset(
    dataUrl,
    mimeType,
    clientConfig,
    getExtractionPreset(evalCase.presetId || ''),
  );

  return evaluateEvalCase(evalCase, toEvalRunOutput(result));
}

async function runAgenticEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig) {
  const { dataUrl, mimeType } = await fileToDataUrl(evalCase.inputPath);
  const file = new File(['eval fixture'], path.basename(evalCase.inputPath), { type: mimeType });
  const generator = agentLoop(
    file,
    dataUrl,
    clientConfig,
    {
      maxIterations: evalCase.agentConfig?.maxIterations ?? 4,
      confidenceThreshold: evalCase.agentConfig?.confidenceThreshold ?? 0.65,
      temperature: 1,
      maxTokens: 4096,
    },
  );

  let current = await generator.next();
  while (!current.done) {
    current = await generator.next();
  }

  return evaluateEvalCase(evalCase, agentMemoryToEvalOutput(current.value as AgentMemory));
}

async function runEvalCase(evalCase: EvalCase, clientConfig: AgentClientConfig) {
  try {
    if (evalCase.mode === 'template') {
      return await runTemplateEvalCase(evalCase, clientConfig);
    }

    if (evalCase.mode === 'agentic') {
      return await runAgenticEvalCase(evalCase, clientConfig);
    }

    return await runSimpleEvalCase(evalCase, clientConfig);
  } catch (error) {
    return runtimeFailure(evalCase, error);
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

  // Prefer medium for 3.5 Flash (API default); low for Pro eval speed.
  return isFlashFamily ? 'MEDIUM' : 'LOW';
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to run live evals.');
  }

  const model = resolveModelName() as GeminiModel;
  const thinkingLevel = resolveThinkingLevel(model);
  const evalCases = await loadEvalCases();
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

  for (const evalCase of evalCases) {
    caseResults.push(await runEvalCase(evalCase, clientConfig));
  }

  const summary = buildEvalSummary(model, caseResults, suiteConfig);
  const markdown = renderEvalSummaryMarkdown(summary);

  await writeEvalSummary(summary, markdown);

  if (summary.status === 'failed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
