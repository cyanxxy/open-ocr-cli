import { constants as fsConstants, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import { getGenAIClient } from '../lib/gemini/client';
import { waitForGeminiRequestSlot } from '../lib/gemini/requestPolicy';
import type { GeminiModel, ThinkingLevel } from '../lib/gemini/types';
import { SUPPORTED_MODELS, type CliConfigFile } from './types';
import { credentialSetupGuidance } from './config';

export interface InitFlags {
  global?: boolean;
  force?: boolean;
  yes?: boolean;
  skipValidation?: boolean;
}

export interface InitPrompter {
  ask(question: string, defaultValue: string): Promise<string>;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  close(): void;
}

export interface InitResult {
  configPath: string;
  written: boolean;
  credentialStatus: 'valid' | 'missing' | 'skipped';
  apiKeyEnvironmentVariable: string;
}

interface InitRuntime {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  prompter?: InitPrompter;
  validateCredentials?: (apiKey: string, model: GeminiModel) => Promise<void>;
  writeOutput?: (text: string) => void;
}

function terminalPrompter(): InitPrompter {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async ask(question: string, defaultValue: string): Promise<string> {
      const answer = (await readline.question(`${question} [${defaultValue}]: `)).trim();
      return answer || defaultValue;
    },
    async confirm(question: string, defaultValue: boolean): Promise<boolean> {
      const hint = defaultValue ? 'Y/n' : 'y/N';
      const answer = (await readline.question(`${question} [${hint}]: `)).trim().toLowerCase();
      if (!answer) return defaultValue;
      return answer === 'y' || answer === 'yes';
    },
    close(): void {
      readline.close();
    },
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function choice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function integer(value: string, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function optionalPositiveNumber(value: string, label: string, max: number): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${label} must be greater than zero and at most ${max}`);
  }
  return parsed;
}

export async function validateGeminiCredentials(apiKey: string, model: GeminiModel): Promise<void> {
  const client = getGenAIClient(apiKey);
  await waitForGeminiRequestSlot();
  await client.models.generateContent({
    model,
    contents: 'Reply with OK.',
    config: { maxOutputTokens: 8 },
  });
}

async function writeConfig(configPath: string, config: CliConfigFile): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, configPath);
}

export async function runInit(flags: InitFlags, runtime: InitRuntime = {}): Promise<InitResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const env = runtime.env ?? process.env;
  const writeOutput = runtime.writeOutput ?? ((text: string) => process.stdout.write(text));
  const ownsPrompter = runtime.prompter === undefined;
  const prompter = runtime.prompter ?? terminalPrompter();
  const configPath = flags.global
    ? path.join(homedir(), '.config', 'gemini-ocr', 'config.json')
    : path.join(cwd, '.gemini-ocr.json');

  try {
    if (await pathExists(configPath) && !flags.force) {
      if (flags.yes || !(await prompter.confirm(`Configuration exists at ${configPath}. Replace it?`, false))) {
        writeOutput(`Configuration already exists at ${configPath}; kept it unchanged. Use --force to replace it.\n`);
        return {
          configPath,
          written: false,
          credentialStatus: 'skipped',
          apiKeyEnvironmentVariable: 'GEMINI_API_KEY',
        };
      }
    }

    const ask = async (question: string, defaultValue: string): Promise<string> => (
      flags.yes ? defaultValue : prompter.ask(question, defaultValue)
    );
    const model = choice<GeminiModel>(
      await ask('Default model', 'gemini-3.5-flash'),
      SUPPORTED_MODELS,
      'Default model',
    );
    const thinking = choice<ThinkingLevel>(
      (await ask('Thinking level', 'MEDIUM')).toUpperCase(),
      ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
      'Thinking level',
    );
    const concurrency = integer(await ask('Concurrent documents', '2'), 'Concurrency', 1, 16);
    const requestsPerMinute = integer(
      await ask('Gemini requests per minute (0 for unlimited)', '0'),
      'Requests per minute',
      0,
      60_000,
    );
    const maxCostUsd = optionalPositiveNumber(
      flags.yes ? '' : await prompter.ask('Maximum estimated batch cost in USD (blank for none)', ''),
      'Maximum cost',
      1_000_000,
    );
    const apiKeyEnv = await ask('API key environment variable', 'GEMINI_API_KEY');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
      throw new Error('API key environment variable must be a valid environment-variable name');
    }

    const config: CliConfigFile = {
      model,
      thinking,
      concurrency,
      requestsPerMinute,
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      retries: 3,
      timeoutSeconds: 120,
      resume: true,
      format: 'markdown',
      apiKeyEnv,
    };

    let credentialStatus: InitResult['credentialStatus'] = 'skipped';
    const apiKey = env[apiKeyEnv]?.trim();
    if (!flags.skipValidation) {
      if (!apiKey) credentialStatus = 'missing';
      else {
        await (runtime.validateCredentials ?? validateGeminiCredentials)(apiKey, model);
        credentialStatus = 'valid';
      }
    }

    await writeConfig(configPath, config);
    writeOutput(`Created ${configPath}\n`);
    if (credentialStatus === 'valid') writeOutput(`${apiKeyEnv}: credential validated\n`);
    else if (credentialStatus === 'missing') {
      writeOutput(`${apiKeyEnv}: not set; credential validation skipped\n${credentialSetupGuidance(apiKeyEnv, cwd)}\n`);
    }
    else writeOutput('Credential validation skipped\n');
    return { configPath, written: true, credentialStatus, apiKeyEnvironmentVariable: apiKeyEnv };
  } finally {
    if (ownsPrompter) prompter.close();
  }
}
