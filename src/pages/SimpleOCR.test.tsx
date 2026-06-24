import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Stub heavy children so we can focus on SimpleOCR's own state logic.
vi.mock('../components/organisms/FileDropzone', () => ({
  FileDropzone: ({ onFileSelect }: { onFileSelect?: (file: File) => void }) => (
    <button
      type="button"
      data-testid="select-file"
      onClick={() => onFileSelect?.((window as unknown as { __nextFile: File }).__nextFile)}
    >
      drop
    </button>
  ),
}));

vi.mock('../components/organisms/ApiKeyPrompt', () => ({
  ApiKeyPrompt: () => <div>api key prompt</div>,
}));

vi.mock('../components/ExtractedContent', () => ({
  default: () => <div data-testid="extracted" />,
}));

import SimpleOCR from './SimpleOCR';
import { useOcrStore } from '../store/useOcrStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { ExtractedContent } from '../lib/gemini/types';

const selectFile = (file: File) => {
  (window as unknown as { __nextFile: File }).__nextFile = file;
  fireEvent.click(screen.getByTestId('select-file'));
};

describe('SimpleOCR heading and file identity', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      apiKey: 'test-key',
      model: 'gemini-3-flash-preview',
      thinkingConfig: { level: 'HIGH', includeThoughts: false },
      handwritingMode: false,
      theme: 'light',
    });

    useOcrStore.setState({
      extractedContent: null,
      isProcessing: false,
      fileName: '',
      progress: 0,
      error: null,
      isCopied: false,
      abortController: null,
      activeRunId: null,
    });

    // Keep processFile from doing real work.
    useOcrStore.setState({ processFile: vi.fn().mockResolvedValue(undefined) });
  });

  it('shows "Ready to Extract" when a file is selected but not yet processed (audit U-04)', () => {
    render(<SimpleOCR />);
    selectFile(new File(['x'], 'doc.png', { type: 'image/png' }));

    expect(screen.getByRole('heading', { name: /Ready to Extract/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Scanning/i })).not.toBeInTheDocument();
  });

  it('shows "Scanning..." only while processing (audit U-04)', () => {
    render(<SimpleOCR />);
    selectFile(new File(['x'], 'doc.png', { type: 'image/png' }));

    act(() => {
      useOcrStore.setState({ isProcessing: true });
    });
    expect(screen.getByRole('heading', { name: /Scanning/i })).toBeInTheDocument();
  });

  it('shows "Extraction Complete" once the selected file is processed (audit U-04)', () => {
    const content: ExtractedContent = { title: 'ok', sections: [] };
    render(<SimpleOCR />);
    const file = new File(['x'], 'doc.png', { type: 'image/png' });
    selectFile(file);

    // Simulate the store completing for the selected file.
    act(() => {
      useOcrStore.setState({
        extractedContent: content,
        fileName: 'doc.png',
        isProcessing: false,
      });
    });

    expect(screen.getByRole('heading', { name: /Extraction Complete/i })).toBeInTheDocument();
  });

  it('does not treat a different file with identical name/size/lastModified as already processed (audit U-02)', () => {
    const content: ExtractedContent = { title: 'ok', sections: [] };

    // Two distinct File instances sharing all identity attributes.
    const fileA = new File(['x'], 'same.png', { type: 'image/png', lastModified: 1000 });
    const fileB = new File(['x'], 'same.png', { type: 'image/png', lastModified: 1000 });
    Object.defineProperty(fileA, 'size', { value: 42 });
    Object.defineProperty(fileB, 'size', { value: 42 });

    render(<SimpleOCR />);

    selectFile(fileA);
    act(() => {
      useOcrStore.setState({ extractedContent: content, fileName: 'same.png', isProcessing: false });
    });
    expect(screen.getByRole('heading', { name: /Extraction Complete/i })).toBeInTheDocument();

    // Go back to the empty state (this also resets the store), then select the
    // second, distinct file. With the WeakMap-based identity (audit U-02), fileB
    // is tracked as a separate file from fileA even though they share
    // name/size/lastModified, so the heading reflects an unprocessed file.
    fireEvent.click(screen.getByLabelText('Remove file and go back'));
    selectFile(fileB);
    expect(screen.getByRole('heading', { name: /Ready to Extract/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Extraction Complete/i })).not.toBeInTheDocument();
  });
});
