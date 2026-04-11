import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockAgentState: {
  status: 'idle' | 'initializing' | 'processing' | 'completed' | 'stopped' | 'error';
  currentStep: string;
  currentIteration: number;
  extractedFields: Record<string, never>;
  logs: never[];
  progress: number;
  error: string;
  isProcessing: boolean;
  config: {
    maxIterations: number;
    confidenceThreshold: number;
  };
  startAgent: ReturnType<typeof vi.fn>;
  stopAgent: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  updateConfig: ReturnType<typeof vi.fn>;
} = {
  status: 'initializing',
  currentStep: 'Initializing agent...',
  currentIteration: 0,
  extractedFields: {},
  logs: [],
  progress: 12,
  error: '',
  isProcessing: true,
  config: {
    maxIterations: 5,
    confidenceThreshold: 0.8,
  },
  startAgent: vi.fn(),
  stopAgent: vi.fn(),
  reset: vi.fn(),
  updateConfig: vi.fn(),
};

vi.mock('../store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: { apiKey: string }) => unknown) => selector({ apiKey: 'test-key' }),
}));

vi.mock('../store/useAgenticOcrStore', () => ({
  useAgenticOcrStore: (selector: (state: typeof mockAgentState) => unknown) => selector(mockAgentState),
}));

vi.mock('../hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    file: new File(['fixture'], 'invoice.pdf', { type: 'application/pdf' }),
    imageData: 'data:application/pdf;base64,ZmFrZQ==',
    error: null,
    handleDrop: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    isCopied: false,
    copyToClipboard: vi.fn(),
  }),
}));

vi.mock('../hooks/useStoreCleanup', () => ({
  useStoreCleanup: vi.fn(),
}));

vi.mock('../components/ExtractedContent', () => ({
  default: () => <div>Extracted Content</div>,
}));

import AgenticOCR from './AgenticOCR';

describe('AgenticOCR', () => {
  it('shows explicit initializing labels and does not mark the file as processed mid-run', () => {
    mockAgentState.status = 'initializing';
    mockAgentState.currentStep = 'Initializing agent...';
    mockAgentState.progress = 12;
    mockAgentState.error = '';
    mockAgentState.isProcessing = true;

    render(<AgenticOCR />);

    expect(screen.getAllByText('Initializing')).toHaveLength(2);
    expect(screen.getByText('Initializing Agent')).toBeInTheDocument();
    expect(screen.getByText('Initializing agent...')).toBeInTheDocument();
    expect(screen.queryByText('Processed')).not.toBeInTheDocument();
  });

  it('shows explicit error labels for failed runs', () => {
    mockAgentState.status = 'error';
    mockAgentState.currentStep = 'Processing failed';
    mockAgentState.progress = 100;
    mockAgentState.error = 'Failed to parse invoice';
    mockAgentState.isProcessing = false;

    render(<AgenticOCR />);

    expect(screen.getAllByText('Error')).toHaveLength(2);
    expect(screen.getByText('Processing Error')).toBeInTheDocument();
    expect(screen.getByText('Failed to parse invoice')).toBeInTheDocument();
  });
});
