import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  confirm: mocks.confirm,
  isCancel: () => false,
  select: mocks.select,
  text: mocks.text,
}));

import { terminalPrompter } from './prompter';

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.select.mockReset();
  mocks.text.mockReset();
});

describe('terminal prompter', () => {
  it('passes the string default "0" through to the prompt', async () => {
    mocks.text.mockResolvedValueOnce('0');

    await expect(terminalPrompter().ask('Requests per minute', '0')).resolves.toBe('0');
    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({
      defaultValue: '0',
      placeholder: '0',
      output: process.stderr,
    }));
  });
});
