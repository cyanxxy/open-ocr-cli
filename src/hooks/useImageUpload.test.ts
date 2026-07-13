import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../lib/fileUtils', () => ({
  readFileAsDataUrl: vi.fn(),
  validateFileForProcessing: vi.fn(),
}));

import * as fileUtils from '../lib/fileUtils';
import { useImageUpload } from './useImageUpload';

const mockReadFileAsDataUrl = vi.mocked(fileUtils.readFileAsDataUrl);
const mockValidateFile = vi.mocked(fileUtils.validateFileForProcessing);

const makeFile = (name: string): File => new File(['x'], name, { type: 'image/png' });

describe('useImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateFile.mockResolvedValue({ valid: true });
  });

  it('keeps the latest file when an earlier slow read resolves last (audit B-08)', async () => {
    const fileA = makeFile('a.png');
    const fileB = makeFile('b.png');

    let resolveA!: (v: string) => void;
    mockReadFileAsDataUrl.mockImplementation((file: File) => {
      if (file.name === 'a.png') {
        return new Promise<string>((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve('data:image/png;base64,B');
    });

    const { result } = renderHook(() => useImageUpload());

    // Start processing A (slow), then B (fast) before A resolves.
    let pA: Promise<void>;
    act(() => {
      pA = result.current.handleDrop([fileA]);
    });
    await waitFor(() => {
      expect(mockReadFileAsDataUrl).toHaveBeenCalledWith(fileA);
    });

    let pB: Promise<void>;
    act(() => {
      pB = result.current.handleDrop([fileB]);
    });

    await act(async () => {
      await pB;
    });

    // B should be the committed state.
    await waitFor(() => {
      expect(result.current.file?.name).toBe('b.png');
      expect(result.current.imageData).toBe('data:image/png;base64,B');
    });

    // Now resolve the stale A read — it must NOT overwrite B.
    await act(async () => {
      resolveA('data:image/png;base64,A');
      await pA;
    });

    expect(result.current.file?.name).toBe('b.png');
    expect(result.current.imageData).toBe('data:image/png;base64,B');
  });

  it('drops a stale read after reset (audit B-08)', async () => {
    const fileA = makeFile('a.png');
    let resolveA!: (v: string) => void;
    mockReadFileAsDataUrl.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveA = resolve;
        })
    );

    const { result } = renderHook(() => useImageUpload());

    let pA: Promise<void>;
    act(() => {
      pA = result.current.handleDrop([fileA]);
    });

    await waitFor(() => {
      expect(mockReadFileAsDataUrl).toHaveBeenCalledWith(fileA);
    });

    // Reset invalidates the in-flight read.
    act(() => {
      result.current.reset();
    });

    await act(async () => {
      resolveA('data:image/png;base64,A');
      await pA;
    });

    expect(result.current.file).toBeNull();
    expect(result.current.imageData).toBe('');
    expect(result.current.isLoading).toBe(false);
  });

  it('invokes onSuccess for the committed file', async () => {
    const onSuccess = vi.fn();
    mockReadFileAsDataUrl.mockResolvedValue('data:image/png;base64,X');

    const { result } = renderHook(() => useImageUpload({ onSuccess }));

    await act(async () => {
      await result.current.handleDrop([makeFile('x.png')]);
    });

    expect(onSuccess).toHaveBeenCalledWith('data:image/png;base64,X', expect.any(File));
  });

  it('surfaces validation errors via onError', async () => {
    const onError = vi.fn();
    mockValidateFile.mockResolvedValue({ valid: false, error: 'File "x.png" is empty.' });

    const { result } = renderHook(() => useImageUpload({ onError }));

    await act(async () => {
      await result.current.handleDrop([makeFile('x.png')]);
    });

    expect(onError).toHaveBeenCalledWith('File "x.png" is empty.');
    expect(result.current.error).toContain('empty');
  });
});
