import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// main.tsx executes its bootstrap on import, so each case mocks the mount point
// and the render dependencies, then imports the module fresh.
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));

vi.mock('./App.tsx', () => ({ default: () => null }));
vi.mock('./index.css', () => ({}));

describe('main bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws a clear error when #root is missing (audit U-14)', async () => {
    vi.spyOn(document, 'getElementById').mockReturnValue(null);

    await expect(import('./main.tsx')).rejects.toThrow(
      /Root element #root not found/i,
    );
  });

  it('mounts without throwing when #root exists', async () => {
    const root = document.createElement('div');
    vi.spyOn(document, 'getElementById').mockReturnValue(root);

    await expect(import('./main.tsx')).resolves.toBeDefined();
  });
});
