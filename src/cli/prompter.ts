import process from 'node:process';

import {
  confirm as clackConfirm,
  isCancel,
  select as clackSelect,
  text as clackText,
} from '@clack/prompts';

export interface PromptChoice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface CliPrompter {
  ask(question: string, defaultValue: string): Promise<string>;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  choose?<T extends string>(
    question: string,
    choices: ReadonlyArray<PromptChoice<T>>,
    defaultValue: T,
  ): Promise<T>;
  close(): void;
}

export async function promptSelect<T extends string>(
  prompter: CliPrompter,
  writeOutput: (text: string) => void,
  question: string,
  choices: ReadonlyArray<PromptChoice<T>>,
  defaultValue: T,
  normalize: (value: string) => string = (value) => value,
): Promise<T> {
  const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue);
  if (defaultIndex < 0) throw new Error(`Invalid default ${question.toLowerCase()}: ${defaultValue}`);
  if (prompter.choose) return prompter.choose(question, choices, defaultValue);

  writeOutput(`${question}:\n`);
  choices.forEach((choice, index) => {
    writeOutput(
      `  ${index + 1}. ${choice.label}${choice.value === defaultValue ? ' (default)' : ''}\n`,
    );
  });
  while (true) {
    const answer = await prompter.ask(
      `Choose ${question.toLowerCase()} by number or value`,
      String(defaultIndex + 1),
    );
    const normalized = normalize(answer.trim());
    if (/^\d+$/.test(normalized)) {
      const selected = choices[Number(normalized) - 1];
      if (selected) return selected.value;
    }
    const selected = choices.find((choice) => (
      choice.value === normalized || choice.value.toLowerCase() === normalized.toLowerCase()
    ));
    if (selected) return selected.value;
    writeOutput(
      `Invalid ${question.toLowerCase()} "${answer}". Enter 1-${choices.length} or a listed value.\n`,
    );
  }
}

function promptAbortError(): Error & { code: string } {
  return Object.assign(new Error('Aborted with Ctrl+C'), {
    name: 'AbortError',
    code: 'ABORT_ERR',
  });
}

function valueOrAbort<T>(value: T | symbol): T {
  if (isCancel(value)) throw promptAbortError();
  return value;
}

/** Interactive terminal prompts. Tests and embedders can inject CliPrompter instead. */
export function terminalPrompter(): CliPrompter {
  return {
    async ask(question: string, defaultValue: string): Promise<string> {
      return valueOrAbort(await clackText({
        message: question,
        output: process.stderr,
        ...(defaultValue.length > 0 ? { placeholder: defaultValue, defaultValue } : {}),
      }));
    },
    async confirm(question: string, defaultValue: boolean): Promise<boolean> {
      return valueOrAbort(await clackConfirm({
        message: question,
        initialValue: defaultValue,
        output: process.stderr,
      }));
    },
    async choose<T extends string>(
      question: string,
      choices: ReadonlyArray<PromptChoice<T>>,
      defaultValue: T,
    ): Promise<T> {
      const selected = valueOrAbort(await clackSelect<string>({
        message: question,
        options: choices.map((entry) => ({
          value: entry.value,
          label: entry.label,
          ...(entry.hint ? { hint: entry.hint } : {}),
        })),
        initialValue: defaultValue,
        showInstructions: true,
        output: process.stderr,
      }));
      return selected as T;
    },
    close(): void {
      // Clack restores terminal state after every prompt and owns no shared handle.
    },
  };
}

export function isPromptAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ABORT_ERR' || error.name === 'AbortError' || error.message === 'Aborted with Ctrl+C';
}
