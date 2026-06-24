import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useStoreCleanup } from './useStoreCleanup';

describe('useStoreCleanup', () => {
  it('calls each cleanup function on unmount', () => {
    const cancel = vi.fn();
    const reset = vi.fn();

    const Probe = () => {
      useStoreCleanup({ cancel, reset }, 'TestStore');
      return null;
    };

    const { unmount } = render(<Probe />);
    expect(cancel).not.toHaveBeenCalled();

    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('fires the latest function identity, not the mount-time snapshot (audit U-01)', () => {
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();

    const Probe = ({ cancel }: { cancel: () => void }) => {
      // Inline object whose function reference changes across renders.
      useStoreCleanup({ cancel }, 'TestStore');
      return null;
    };

    const { rerender, unmount } = render(<Probe cancel={firstCancel} />);
    // The store rebinds its action: a new function identity arrives before unmount.
    rerender(<Probe cancel={secondCancel} />);

    unmount();

    // The stale closure bug would have called firstCancel; the ref fix calls the latest.
    expect(firstCancel).not.toHaveBeenCalled();
    expect(secondCancel).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a cleanup function itself throws', () => {
    const boom = vi.fn(() => {
      throw new Error('cleanup failed');
    });
    const ok = vi.fn();

    const Probe = () => {
      useStoreCleanup({ boom, ok });
      return null;
    };

    const { unmount } = render(<Probe />);
    expect(() => unmount()).not.toThrow();
    expect(boom).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
