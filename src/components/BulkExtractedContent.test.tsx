import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BulkExtractedContent } from './BulkExtractedContent';
import type { ExtractedContent } from '../lib/gemini/types';

// MarkdownRenderer pulls in heavy markdown/katex deps; stub it for these tests.
vi.mock('./MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

type Status = 'success' | 'failed' | 'cancelled' | 'partial';

const trackedFile = (id: string, name: string) => ({
  id,
  file: new File(['x'], name, { type: 'image/png' }),
});

const result = (
  fileId: string,
  fileName: string,
  status: Status,
  content: ExtractedContent,
  error?: string
) => ({ fileId, fileName, content, status, error });

const noop = vi.fn();

describe('BulkExtractedContent (audit H-09)', () => {
  it('shows the failed count in the summary and surfaces the error when expanded', () => {
    render(
      <BulkExtractedContent
        results={[
          result('1', 'ok.png', 'success', {
            sections: [{ heading: 'H', content: ['line'] }],
          }),
          result('2', 'bad.png', 'failed', { sections: [] }, 'network exploded'),
        ]}
        files={[trackedFile('1', 'ok.png'), trackedFile('2', 'bad.png')]}
        expandedFiles={{ '2': true }}
        copiedResults={{}}
        isCopied={false}
        onToggleExpand={noop}
        onCopyAll={noop}
        onCopyResult={noop}
      />
    );

    // Summary reflects 1 failure, and the success contributes 1 section.
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
    // Failed item displays its error message, not "0 sections".
    expect(screen.getByText('network exploded')).toBeInTheDocument();
    // Failed item shows a Failed badge.
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('does not render a copy button for failed items', () => {
    render(
      <BulkExtractedContent
        results={[result('2', 'bad.png', 'failed', { sections: [] }, 'boom')]}
        files={[trackedFile('2', 'bad.png')]}
        expandedFiles={{}}
        copiedResults={{}}
        isCopied={false}
        onToggleExpand={noop}
        onCopyAll={noop}
        onCopyResult={noop}
      />
    );

    // The only copy control should be "Copy All Content" in the header.
    expect(screen.queryByLabelText('Copy content')).not.toBeInTheDocument();
  });

  it('falls back to content text when no explicit error is present', () => {
    render(
      <BulkExtractedContent
        results={[
          result('2', 'bad.png', 'failed', { sections: [], content: 'provider error string' }),
        ]}
        files={[trackedFile('2', 'bad.png')]}
        expandedFiles={{ '2': true }}
        copiedResults={{}}
        isCopied={false}
        onToggleExpand={noop}
        onCopyAll={noop}
        onCopyResult={noop}
      />
    );

    expect(screen.getByText('provider error string')).toBeInTheDocument();
  });
});
