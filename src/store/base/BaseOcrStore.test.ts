import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import {
  createBaseOcrSlice,
  BaseOcrStore,
  initialBaseState,
  createAbortController,
  handleOcrError,
  formatContentForClipboard,
} from './BaseOcrStore';

// Create a test store using the base slice
const createTestStore = () =>
  create<BaseOcrStore>((set, get) => ({
    ...createBaseOcrSlice(set, get),
  }));

describe('BaseOcrStore', () => {
  let useStore: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    useStore = createTestStore();

    // Reset clipboard mock
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
  });

  describe('initialBaseState', () => {
    it('should have correct initial values', () => {
      expect(initialBaseState).toEqual({
        isProcessing: false,
        error: null,
        isCopied: false,
        copyTimeoutId: null,
        abortController: null,
        activeRunId: null,
      });
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      useStore.getState().setError('Test error');

      expect(useStore.getState().error).toBe('Test error');
      expect(useStore.getState().isProcessing).toBe(false);
    });

    it('should clear error when null is passed', () => {
      useStore.setState({ error: 'Previous error', isProcessing: true });

      useStore.getState().setError(null);

      expect(useStore.getState().error).toBeNull();
      expect(useStore.getState().isProcessing).toBe(false);
    });
  });

  describe('copyToClipboard', () => {
    it('should copy content to clipboard', async () => {
      await useStore.getState().copyToClipboard('Test content');

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test content');
      expect(useStore.getState().isCopied).toBe(true);
    });

    it('should not copy empty content', async () => {
      await useStore.getState().copyToClipboard('');

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(useStore.getState().isCopied).toBe(false);
    });

    it('should reset isCopied after timeout', async () => {
      vi.useFakeTimers();

      await useStore.getState().copyToClipboard('Test content');

      expect(useStore.getState().isCopied).toBe(true);

      vi.advanceTimersByTime(2000);

      expect(useStore.getState().isCopied).toBe(false);

      vi.useRealTimers();
    });

    it('should clear previous timeout when copying again', async () => {
      vi.useFakeTimers();

      await useStore.getState().copyToClipboard('First');
      await useStore.getState().copyToClipboard('Second');

      // Advance less than 2s - should still be copied
      vi.advanceTimersByTime(1000);
      expect(useStore.getState().isCopied).toBe(true);

      // Advance another 1.5s (total 2.5s from second copy)
      vi.advanceTimersByTime(1500);
      expect(useStore.getState().isCopied).toBe(false);

      vi.useRealTimers();
    });

    it('should handle clipboard errors', async () => {
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Clipboard error')
      );

      await useStore.getState().copyToClipboard('Test content');

      expect(useStore.getState().isCopied).toBe(false);
      expect(useStore.getState().error).toContain('Failed to copy');
    });
  });

  describe('resetBase', () => {
    it('should reset state to initial values', () => {
      useStore.setState({
        isProcessing: true,
        error: 'Some error',
        isCopied: true,
        copyTimeoutId: setTimeout(() => {}, 1000),
        abortController: new AbortController(),
      });

      useStore.getState().resetBase();

      const state = useStore.getState();
      expect(state.isProcessing).toBe(false);
      expect(state.error).toBeNull();
      expect(state.isCopied).toBe(false);
      expect(state.copyTimeoutId).toBeNull();
      expect(state.abortController).toBeNull();
    });

    it('should clear active timeout', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const timeoutId = setTimeout(() => {}, 1000);
      useStore.setState({ copyTimeoutId: timeoutId });

      useStore.getState().resetBase();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
    });

    it('should abort active controller', () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');
      useStore.setState({ abortController: controller });

      useStore.getState().resetBase();

      expect(abortSpy).toHaveBeenCalled();
    });
  });
});

describe('createAbortController', () => {
  it('should return a new AbortController', () => {
    const controller = createAbortController();

    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
  });
});

describe('handleOcrError', () => {
  it('should extract message from Error object', () => {
    const error = new Error('Test error message');
    const result = handleOcrError(error, 'Context');

    expect(result).toBe('Test error message');
  });

  it('should use string error directly', () => {
    const result = handleOcrError('String error', 'Context');

    expect(result).toBe('String error');
  });

  it('should return default message for unknown error types', () => {
    const result = handleOcrError({ unknown: 'type' }, 'Context');

    expect(result).toBe('An unexpected error occurred');
  });

  it('should return default message for null', () => {
    const result = handleOcrError(null, 'Context');

    expect(result).toBe('An unexpected error occurred');
  });

  it('should return default message for undefined', () => {
    const result = handleOcrError(undefined, 'Context');

    expect(result).toBe('An unexpected error occurred');
  });
});

describe('formatContentForClipboard', () => {
  it('should format sections with titles', () => {
    const sections = [
      { title: 'Title 1', content: 'Content 1' },
      { title: 'Title 2', content: 'Content 2' },
    ];

    const result = formatContentForClipboard(sections);

    expect(result).toBe('Title 1:\nContent 1\n\nTitle 2:\nContent 2');
  });

  it('should format sections without titles', () => {
    const sections = [{ content: 'Content 1' }, { content: 'Content 2' }];

    const result = formatContentForClipboard(sections);

    expect(result).toBe('Content 1\n\nContent 2');
  });

  it('should filter out empty content', () => {
    const sections = [
      { title: 'Title 1', content: 'Content 1' },
      { title: 'Title 2', content: '' },
      { title: 'Title 3', content: 'Content 3' },
    ];

    const result = formatContentForClipboard(sections);

    expect(result).toBe('Title 1:\nContent 1\n\nTitle 3:\nContent 3');
  });

  it('should return empty string for empty sections', () => {
    const result = formatContentForClipboard([]);

    expect(result).toBe('');
  });

  it('should handle mixed sections with and without titles', () => {
    const sections = [
      { title: 'With Title', content: 'Content A' },
      { content: 'Content B' },
    ];

    const result = formatContentForClipboard(sections);

    expect(result).toBe('With Title:\nContent A\n\nContent B');
  });
});
