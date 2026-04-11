import type { PresetRunResult } from './gemini/types';

export type EvalMode = 'simple' | 'template' | 'agentic';

export type EvalAssertion =
  | { type: 'contains'; target: 'markdown' | 'csv'; value: string }
  | { type: 'not_contains'; target: 'markdown' | 'csv'; value: string }
  | { type: 'json_field_equals'; path: string; expected: string | number | boolean | null }
  | { type: 'json_field_exists'; path: string }
  | { type: 'json_field_number_min'; path: string; min: number }
  | { type: 'table_min_rows'; minRows: number; path?: string }
  | { type: 'pass_rate_weight'; value: number }
  | { type: 'overall_score_min'; value: number };

export interface EvalCase {
  id: string;
  mode: EvalMode;
  inputPath: string;
  presetId?: string;
  agentConfig?: {
    maxIterations?: number;
    confidenceThreshold?: number;
  };
  expectedAssertions: EvalAssertion[];
  tags: string[];
}

export interface EvalFailure {
  id: string;
  message: string;
  failedAssertions: string[];
}

export interface EvalRunSummary {
  model: string;
  totalCases: number;
  passCount: number;
  passRate: number;
  weightedScore: number;
  failures: EvalFailure[];
  runAt: string;
  status?: 'success' | 'failed' | 'pending';
  notes?: string[];
}

export interface EvalCaseResult {
  id: string;
  passed: boolean;
  weight: number;
  failedAssertions: string[];
}

export interface EvalRunOutput {
  markdown: string;
  csv?: string;
  json?: Record<string, unknown> | null;
}

export interface EvalSuiteConfig {
  suiteAssertions?: Array<Extract<EvalAssertion, { type: 'overall_score_min' }>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type PathLookup =
  | { found: true; value: unknown }
  | { found: false; value: undefined };

function normalizeEvalMode(mode: unknown): EvalMode | null {
  if (mode === 'ocr') {
    return 'simple';
  }

  if (mode === 'simple' || mode === 'template' || mode === 'agentic') {
    return mode;
  }

  return null;
}

function isAllowedAssertion(assertion: unknown): assertion is EvalAssertion {
  if (!isRecord(assertion) || typeof assertion.type !== 'string') {
    return false;
  }

  switch (assertion.type) {
    case 'contains':
    case 'not_contains':
      return (assertion.target === 'markdown' || assertion.target === 'csv') && typeof assertion.value === 'string';
    case 'json_field_equals':
      return typeof assertion.path === 'string' && 'expected' in assertion;
    case 'json_field_exists':
      return typeof assertion.path === 'string';
    case 'json_field_number_min':
      return typeof assertion.path === 'string' && typeof assertion.min === 'number';
    case 'table_min_rows':
      return typeof assertion.minRows === 'number' && (assertion.path === undefined || typeof assertion.path === 'string');
    case 'pass_rate_weight':
    case 'overall_score_min':
      return typeof assertion.value === 'number';
    default:
      return false;
  }
}

export function validateEvalCase(input: unknown): EvalCase {
  if (!isRecord(input)) {
    throw new Error('Eval case must be an object.');
  }

  if (typeof input.id !== 'string' || !input.id.trim()) {
    throw new Error('Eval case id is required.');
  }

  const mode = normalizeEvalMode(input.mode);
  if (!mode) {
    throw new Error(`Eval case "${input.id}" must use mode "simple", "template", or "agentic".`);
  }

  if (typeof input.inputPath !== 'string' || !input.inputPath.trim()) {
    throw new Error(`Eval case "${input.id}" is missing inputPath.`);
  }

  if (mode === 'template' && (typeof input.presetId !== 'string' || !input.presetId.trim())) {
    throw new Error(`Template eval case "${input.id}" must provide presetId.`);
  }

  if (mode === 'agentic' && input.agentConfig != null) {
    if (!isRecord(input.agentConfig)) {
      throw new Error(`Agentic eval case "${input.id}" must use an object for agentConfig.`);
    }

    const { maxIterations, confidenceThreshold } = input.agentConfig;
    if (maxIterations != null && (typeof maxIterations !== 'number' || maxIterations < 1)) {
      throw new Error(`Agentic eval case "${input.id}" must use a positive number for agentConfig.maxIterations.`);
    }

    if (
      confidenceThreshold != null &&
      (typeof confidenceThreshold !== 'number' || confidenceThreshold < 0 || confidenceThreshold > 1)
    ) {
      throw new Error(`Agentic eval case "${input.id}" must use a 0-1 number for agentConfig.confidenceThreshold.`);
    }
  }

  if (!Array.isArray(input.expectedAssertions) || input.expectedAssertions.length === 0) {
    throw new Error(`Eval case "${input.id}" must include at least one assertion.`);
  }

  if (!input.expectedAssertions.every(isAllowedAssertion)) {
    throw new Error(`Eval case "${input.id}" includes an invalid assertion.`);
  }

  if (!Array.isArray(input.tags) || !input.tags.every((tag) => typeof tag === 'string')) {
    throw new Error(`Eval case "${input.id}" must provide string tags.`);
  }

  return {
    id: input.id,
    mode,
    inputPath: input.inputPath,
    presetId: typeof input.presetId === 'string' ? input.presetId : undefined,
    agentConfig: isRecord(input.agentConfig)
      ? {
          maxIterations: typeof input.agentConfig.maxIterations === 'number' ? input.agentConfig.maxIterations : undefined,
          confidenceThreshold: typeof input.agentConfig.confidenceThreshold === 'number'
            ? input.agentConfig.confidenceThreshold
            : undefined,
        }
      : undefined,
    expectedAssertions: input.expectedAssertions,
    tags: input.tags,
  };
}

export function validateEvalSuiteConfig(input: unknown): EvalSuiteConfig {
  if (input == null) {
    return {};
  }

  if (!isRecord(input)) {
    throw new Error('Eval suite config must be an object.');
  }

  const suiteAssertions = input.suiteAssertions;
  if (suiteAssertions == null) {
    return {};
  }

  if (!Array.isArray(suiteAssertions) || !suiteAssertions.every(isAllowedAssertion)) {
    throw new Error('Eval suite config contains invalid suiteAssertions.');
  }

  const overallAssertions = suiteAssertions.filter(
    (assertion): assertion is Extract<EvalAssertion, { type: 'overall_score_min' }> => assertion.type === 'overall_score_min',
  );

  return { suiteAssertions: overallAssertions };
}

export function getEvalCaseWeight(evalCase: EvalCase): number {
  const weightAssertion = evalCase.expectedAssertions.find(
    (assertion): assertion is Extract<EvalAssertion, { type: 'pass_rate_weight' }> => assertion.type === 'pass_rate_weight',
  );

  return weightAssertion?.value ?? 1;
}

function getValueAtPath(input: unknown, path: string): PathLookup {
  let current: unknown = input;

  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }

      current = current[index];
      continue;
    }

    if (isRecord(current)) {
      if (!(segment in current)) {
        return { found: false, value: undefined };
      }

      current = current[segment];
      continue;
    }

    return { found: false, value: undefined };
  }

  return { found: true, value: current };
}

function formatAssertionFailure(assertion: EvalAssertion): string {
  switch (assertion.type) {
    case 'contains':
      return `Expected ${assertion.target} to contain "${assertion.value}".`;
    case 'not_contains':
      return `Expected ${assertion.target} to omit "${assertion.value}".`;
    case 'json_field_equals':
      return `Expected JSON path "${assertion.path}" to equal ${JSON.stringify(assertion.expected)}.`;
    case 'json_field_exists':
      return `Expected JSON path "${assertion.path}" to exist.`;
    case 'json_field_number_min':
      return `Expected JSON path "${assertion.path}" to be at least ${assertion.min}.`;
    case 'table_min_rows':
      return `Expected table at "${assertion.path ?? 'rows'}" to have at least ${assertion.minRows} rows.`;
    case 'pass_rate_weight':
      return '';
    case 'overall_score_min':
      return `Expected overall weighted score to be at least ${assertion.value}.`;
    default:
      return 'Unknown assertion failure.';
  }
}

export function evaluateEvalCase(evalCase: EvalCase, output: EvalRunOutput): EvalCaseResult {
  const failures: string[] = [];

  for (const assertion of evalCase.expectedAssertions) {
    switch (assertion.type) {
      case 'contains':
        if (!(output[assertion.target] || '').includes(assertion.value)) {
          failures.push(formatAssertionFailure(assertion));
        }
        break;
      case 'not_contains':
        if ((output[assertion.target] || '').includes(assertion.value)) {
          failures.push(formatAssertionFailure(assertion));
        }
        break;
      case 'json_field_equals': {
        const resolved = getValueAtPath(output.json, assertion.path);
        if (!resolved.found || resolved.value !== assertion.expected) {
          failures.push(formatAssertionFailure(assertion));
        }
        break;
      }
      case 'json_field_exists': {
        const resolved = getValueAtPath(output.json, assertion.path);
        if (!resolved.found || resolved.value === null || resolved.value === '') {
          failures.push(formatAssertionFailure(assertion));
        }
        break;
      }
      case 'json_field_number_min': {
        const resolved = getValueAtPath(output.json, assertion.path);
        if (!resolved.found || typeof resolved.value !== 'number' || resolved.value < assertion.min) {
          failures.push(formatAssertionFailure(assertion));
        }
        break;
      }
      case 'table_min_rows': {
        const resolved = getValueAtPath(output.json, assertion.path ?? 'rows');
        const rowCount = resolved.found && Array.isArray(resolved.value) ? resolved.value.length : 0;
        if (rowCount < assertion.minRows) {
          failures.push(formatAssertionFailure(assertion));
        }
        break;
      }
      case 'pass_rate_weight':
      case 'overall_score_min':
        break;
    }
  }

  return {
    id: evalCase.id,
    passed: failures.length === 0,
    weight: getEvalCaseWeight(evalCase),
    failedAssertions: failures,
  };
}

export function buildEvalSummary(
  model: string,
  caseResults: EvalCaseResult[],
  suiteConfig: EvalSuiteConfig = {},
): EvalRunSummary {
  const totalWeight = caseResults.reduce((sum, result) => sum + result.weight, 0);
  const passingWeight = caseResults.reduce((sum, result) => sum + (result.passed ? result.weight : 0), 0);
  const passCount = caseResults.filter((result) => result.passed).length;
  const weightedScore = totalWeight > 0
    ? passingWeight / totalWeight
    : (caseResults.length === 0 ? 0 : passCount / caseResults.length);
  const failures = caseResults
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      message: `Case ${result.id} failed ${result.failedAssertions.length} assertion(s).`,
      failedAssertions: result.failedAssertions,
    }));

  const notes: string[] = [];
  const threshold = suiteConfig.suiteAssertions?.find((assertion) => assertion.type === 'overall_score_min');
  let status: EvalRunSummary['status'] = failures.length > 0 ? 'failed' : 'success';

  if (threshold && weightedScore < threshold.value) {
    status = 'failed';
    notes.push(`Weighted score ${weightedScore.toFixed(2)} is below required threshold ${threshold.value.toFixed(2)}.`);
  }

  return {
    model,
    totalCases: caseResults.length,
    passCount,
    passRate: caseResults.length === 0 ? 0 : passCount / caseResults.length,
    weightedScore,
    failures,
    runAt: new Date().toISOString(),
    status,
    notes: notes.length > 0 ? notes : undefined,
  };
}

export function renderEvalSummaryMarkdown(summary: EvalRunSummary): string {
  const lines = [
    '# AI Eval Report',
    '',
    `- Model: \`${summary.model}\``,
    `- Run at: ${summary.runAt}`,
    `- Status: ${summary.status ?? 'success'}`,
    `- Total cases: ${summary.totalCases}`,
    `- Passed: ${summary.passCount}`,
    `- Pass rate: ${(summary.passRate * 100).toFixed(1)}%`,
    `- Weighted score: ${(summary.weightedScore * 100).toFixed(1)}%`,
    '',
  ];

  if (summary.notes && summary.notes.length > 0) {
    lines.push('## Notes', '', ...summary.notes.map((note) => `- ${note}`), '');
  }

  lines.push('## Failures', '');

  if (summary.failures.length === 0) {
    lines.push('- None');
  } else {
    for (const failure of summary.failures) {
      lines.push(`### ${failure.id}`, '', failure.message, '', ...failure.failedAssertions.map((entry) => `- ${entry}`), '');
    }
  }

  return lines.join('\n').trim() + '\n';
}

export function toEvalRunOutput(result: PresetRunResult): EvalRunOutput {
  return {
    markdown: result.markdown,
    csv: result.csv,
    json: result.json as unknown as Record<string, unknown>,
  };
}
