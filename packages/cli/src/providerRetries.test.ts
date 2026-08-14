import { describe, expect, it, vi } from 'vitest';

import { resolveCliOptions } from './config';
import { CliExitError } from './errors';
import { runWithProviderRetries } from './providerRetries';

vi.mock('@open-ocr/engine/agentStepStream', () => ({
  waitForAbortableAgentDelay: vi.fn(() => Promise.resolve()),
}));

describe('provider retry policy', () => {
  it('honors typed retryability independently of the selected provider', async () => {
    const options = resolveCliOptions({
      provider: 'openrouter',
      retries: '2',
    }, {}, process.cwd());
    const operation = vi.fn()
      .mockRejectedValueOnce(new CliExitError('Source returned HTTP 503', 2, {
        code: 'INPUT_INVALID',
        category: 'input',
        retryable: true,
      }))
      .mockResolvedValue('ok');

    const result = await runWithProviderRetries(
      options,
      new AbortController().signal,
      operation,
    );

    expect(result).toEqual({ value: 'ok', attempts: 2 });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a typed permanent failure', async () => {
    const options = resolveCliOptions({
      provider: 'openrouter',
      retries: '2',
    }, {}, process.cwd());
    const operation = vi.fn(() => Promise.reject(new CliExitError('Source returned HTTP 404', 2, {
      code: 'INPUT_INVALID',
      category: 'input',
      retryable: false,
    })));

    await expect(runWithProviderRetries(
      options,
      new AbortController().signal,
      operation,
    )).rejects.toMatchObject({ attempts: 1 });
    expect(operation).toHaveBeenCalledOnce();
  });
});
