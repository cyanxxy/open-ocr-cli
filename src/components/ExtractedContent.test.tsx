import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExtractedContent from './ExtractedContent';

// MarkdownRenderer pulls in heavy markdown/katex deps; stub it for these tests.
vi.mock('./MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe('ExtractedContent', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('prepends the document title to the copied plain text (audit U-05)', async () => {
    const user = userEvent.setup();
    const onCopyToClipboard = vi.fn().mockResolvedValue(undefined);

    render(
      <ExtractedContent
        content={{ title: 'Invoice', sections: [{ heading: 'Items', content: ['Widget x2'] }] }}
        onCopyToClipboard={onCopyToClipboard}
      />,
    );

    await user.click(screen.getByRole('button', { name: /copy content to clipboard/i }));

    expect(onCopyToClipboard).toHaveBeenCalledTimes(1);
    const copied = onCopyToClipboard.mock.calls[0][0] as string;
    expect(copied.startsWith('Invoice')).toBe(true);
    expect(copied).toContain('Widget x2');
  });

  it('does not inject the default placeholder title into the copied text', async () => {
    const user = userEvent.setup();
    const onCopyToClipboard = vi.fn().mockResolvedValue(undefined);

    render(
      <ExtractedContent
        content={{ sections: [{ heading: 'Body', content: ['Hello world'] }] }}
        onCopyToClipboard={onCopyToClipboard}
      />,
    );

    await user.click(screen.getByRole('button', { name: /copy content to clipboard/i }));

    const copied = onCopyToClipboard.mock.calls[0][0] as string;
    expect(copied.startsWith('Extracted Text')).toBe(false);
    expect(copied).toContain('Hello world');
  });

  it('restores the exact prior body overflow on minimize (audit U-06)', async () => {
    const user = userEvent.setup();
    // Prior inline value is empty (CSS-class-applied overflow scenario).
    document.body.style.overflow = '';

    render(
      <ExtractedContent
        content={{ title: 'Doc', sections: [{ content: ['line'] }] }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /maximize content view/i }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: /minimize content view/i }));
    // Must restore the empty string, NOT 'unset'.
    expect(document.body.style.overflow).toBe('');
  });
});
