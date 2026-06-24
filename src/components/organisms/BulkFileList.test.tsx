import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BulkFileList } from './BulkFileList';
import type { ExtractedContent } from '../../lib/gemini/types';

type Status = 'success' | 'failed' | 'cancelled' | 'partial';

const file = (id: string, name: string) => ({ id, file: new File(['x'], name, { type: 'image/png' }) });

const result = (fileId: string, fileName: string, status: Status, error?: string) => ({
  fileId,
  fileName,
  content: { sections: [] } as ExtractedContent,
  status,
  error,
});

const noop = vi.fn();

describe('BulkFileList (audit H-09)', () => {
  it('shows "Processed" only for successful files, not failed ones', () => {
    render(
      <BulkFileList
        files={[file('1', 'ok.png'), file('2', 'bad.png')]}
        expandedFiles={{}}
        processedResults={[
          result('1', 'ok.png', 'success'),
          result('2', 'bad.png', 'failed', 'boom'),
        ]}
        isProcessing={false}
        onRemoveFile={noop}
        onToggleExpand={noop}
      />
    );

    expect(screen.getByText('Processed')).toBeInTheDocument();
    // The failed file must NOT be rendered as processed.
    expect(screen.getByText('Failed')).toBeInTheDocument();
    // Only one "Processed" status badge (for the single success).
    expect(screen.getAllByText('Processed')).toHaveLength(1);
  });

  it('renders a Cancelled status for cancelled files', () => {
    render(
      <BulkFileList
        files={[file('1', 'x.png')]}
        expandedFiles={{}}
        processedResults={[result('1', 'x.png', 'cancelled', 'Cancelled')]}
        isProcessing={false}
        onRemoveFile={noop}
        onToggleExpand={noop}
      />
    );

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Processed')).not.toBeInTheDocument();
  });

  it('shows Pending for files with no result yet', () => {
    render(
      <BulkFileList
        files={[file('1', 'x.png')]}
        expandedFiles={{}}
        processedResults={[]}
        isProcessing={false}
        onRemoveFile={noop}
        onToggleExpand={noop}
      />
    );

    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});
