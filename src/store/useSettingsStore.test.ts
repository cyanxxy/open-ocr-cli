import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore, ApiKeyPersistError } from './useSettingsStore';
import { encryptData, decryptData } from '../lib/crypto';
import { clearGeminiClientCache } from '../lib/gemini/client';

vi.mock('../lib/crypto', () => ({
  encryptData: vi.fn(async (key: string) => `encrypted_${key}`),
  decryptData: vi.fn(async (encrypted: string) =>
    encrypted.replace('encrypted_', '')
  ),
}));

vi.mock('../lib/gemini/client', () => ({
  clearGeminiClientCache: vi.fn(),
}));

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      apiKey: '',
      handwritingMode: false,
      model: 'gemini-3-flash-preview',
      theme: 'light',
      thinkingConfig: {
        level: 'HIGH',
        includeThoughts: false,
      },
    });

    vi.clearAllMocks();
    mockLocalStorage.clear();
  });

  it('initializes with default values', () => {
    const state = useSettingsStore.getState();
    expect(state.apiKey).toBe('');
    expect(state.handwritingMode).toBe(false);
    expect(state.model).toBe('gemini-3-flash-preview');
    expect(state.theme).toBe('light');
  });

  describe('setApiKey', () => {
    it('trims, encrypts, and stores the API key', async () => {
      await useSettingsStore.getState().setApiKey('  test-api-key-123  ');

      const state = useSettingsStore.getState();
      expect(state.apiKey).toBe('test-api-key-123');
      expect(encryptData).toHaveBeenCalledWith('test-api-key-123');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'gemini-api-key',
        'encrypted_test-api-key-123'
      );
    });
  });

  describe('setModel', () => {
    it('accepts valid model values', () => {
      useSettingsStore.getState().setModel('gemini-3.1-pro-preview');
      expect(useSettingsStore.getState().model).toBe('gemini-3.1-pro-preview');
    });

    it('clamps unsupported thinking levels when switching models', () => {
      useSettingsStore.setState({
        model: 'gemini-3-flash-preview',
        thinkingConfig: {
          level: 'MINIMAL',
          includeThoughts: true,
        },
      });

      useSettingsStore.getState().setModel('gemini-3.1-pro-preview');

      expect(useSettingsStore.getState().model).toBe('gemini-3.1-pro-preview');
      expect(useSettingsStore.getState().thinkingConfig).toEqual({
        level: 'HIGH',
        includeThoughts: true,
      });
    });

    it('ignores invalid model values', () => {
      const current = useSettingsStore.getState().model;
      // @ts-expect-error - testing invalid input
      useSettingsStore.getState().setModel('invalid-model');
      expect(useSettingsStore.getState().model).toBe(current);
    });
  });

  describe('setTheme', () => {
    it('applies a valid theme to the document', () => {
      useSettingsStore.getState().setTheme('dark');
      expect(useSettingsStore.getState().theme).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('ignores invalid themes', () => {
      const current = useSettingsStore.getState().theme;
      // @ts-expect-error - testing invalid input
      useSettingsStore.getState().setTheme('invalid');
      expect(useSettingsStore.getState().theme).toBe(current);
    });
  });

  describe('rehydration', () => {
    it('decrypts stored API key on rehydrate', async () => {
      const persistedState = {
        state: {
          model: 'gemini-3-flash-preview',
          handwritingMode: false,
          theme: 'light',
          thinkingConfig: {
            level: 'HIGH',
            includeThoughts: false,
          },
        },
        version: 0,
      };

      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'gemini-settings') return JSON.stringify(persistedState);
        if (key === 'gemini-api-key') return 'encrypted_stored-key';
        return null;
      });

      const storeWithPersist = useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      };

      await storeWithPersist.persist.rehydrate();

      expect(decryptData).toHaveBeenCalledWith('encrypted_stored-key');
      expect(useSettingsStore.getState().apiKey).toBe('stored-key');
    });

    it('keeps the persisted DOM theme when only the key decrypt fails (audit H-13)', async () => {
      // Baseline: the persist middleware has already restored the dark theme.
      useSettingsStore.setState({ theme: 'dark' });

      const persistedState = {
        state: {
          model: 'gemini-3-flash-preview',
          handwritingMode: false,
          theme: 'dark',
          thinkingConfig: {
            level: 'HIGH',
            includeThoughts: false,
          },
        },
        version: 0,
      };

      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'gemini-settings') return JSON.stringify(persistedState);
        if (key === 'gemini-api-key') return 'encrypted_broken-key';
        return null;
      });
      vi.mocked(decryptData).mockRejectedValueOnce(new Error('Decrypt failed'));

      const storeWithPersist = useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      };

      await storeWithPersist.persist.rehydrate();

      // A decrypt failure now only blanks the key — the dark theme the user chose
      // is applied to the DOM and kept in state, not reset to light.
      expect(useSettingsStore.getState().theme).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });
  });

  describe('setHandwritingMode', () => {
    it('toggles handwriting mode', () => {
      expect(useSettingsStore.getState().handwritingMode).toBe(false);

      useSettingsStore.getState().setHandwritingMode(true);
      expect(useSettingsStore.getState().handwritingMode).toBe(true);

      useSettingsStore.getState().setHandwritingMode(false);
      expect(useSettingsStore.getState().handwritingMode).toBe(false);
    });
  });

  describe('updateThinkingConfig', () => {
    it('updates thinking config', () => {
      useSettingsStore.getState().updateThinkingConfig({
        level: 'MEDIUM',
        includeThoughts: true,
      });

      const state = useSettingsStore.getState();
      expect(state.thinkingConfig.level).toBe('MEDIUM');
      expect(state.thinkingConfig.includeThoughts).toBe(true);
    });

    it('updates partial thinking config', () => {
      useSettingsStore.getState().updateThinkingConfig({ level: 'LOW' });

      const state = useSettingsStore.getState();
      expect(state.thinkingConfig.level).toBe('LOW');
      expect(state.thinkingConfig.includeThoughts).toBe(false);
    });
  });

  describe('setTheme additional cases', () => {
    it('applies amoled theme', () => {
      useSettingsStore.getState().setTheme('amoled');
      expect(useSettingsStore.getState().theme).toBe('amoled');
      expect(document.documentElement.classList.contains('amoled')).toBe(true);
    });

    it('removes previous theme classes', () => {
      useSettingsStore.getState().setTheme('dark');
      useSettingsStore.getState().setTheme('light');

      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('setApiKey error handling', () => {
    it('surfaces a persist failure but keeps the key for the session (audit H-12)', async () => {
      vi.mocked(encryptData).mockRejectedValueOnce(new Error('Encryption failed'));

      // The save no longer silently resolves on a storage failure — it throws so
      // the UI can warn that the key will be lost on refresh.
      await expect(
        useSettingsStore.getState().setApiKey('test-key')
      ).rejects.toBeInstanceOf(ApiKeyPersistError);

      // The key is still usable for the current session.
      expect(useSettingsStore.getState().apiKey).toBe('test-key');
    });

    it('clears the cached Gemini client when the key changes (audit H-14/H-12)', async () => {
      await useSettingsStore.getState().setApiKey('rotated-key');
      expect(clearGeminiClientCache).toHaveBeenCalled();
    });

    it('clears the cached Gemini client when the key is removed', async () => {
      await useSettingsStore.getState().setApiKey('');
      expect(clearGeminiClientCache).toHaveBeenCalled();
      expect(useSettingsStore.getState().apiKey).toBe('');
    });
  });

  describe('rehydration resilience (audit H-13)', () => {
    it('preserves model/theme/onboarding when the stored key fails to decrypt', async () => {
      // Simulate the post-persist-merge baseline (these legitimate preferences
      // were already restored by the persist middleware before onRehydrateStorage runs).
      useSettingsStore.setState({
        model: 'gemini-3.1-pro-preview',
        theme: 'dark',
        hasSeenOnboarding: true,
      });

      const persistedState = {
        state: {
          model: 'gemini-3.1-pro-preview',
          handwritingMode: false,
          theme: 'dark',
          hasSeenOnboarding: true,
          thinkingConfig: {
            level: 'HIGH',
            includeThoughts: false,
          },
        },
        version: 0,
      };

      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'gemini-settings') return JSON.stringify(persistedState);
        if (key === 'gemini-api-key') return 'encrypted_broken-key';
        return null;
      });
      // Only the decrypt step fails — non-key preferences must survive (audit H-13).
      vi.mocked(decryptData).mockRejectedValueOnce(new Error('Decrypt failed'));

      const storeWithPersist = useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      };

      await storeWithPersist.persist.rehydrate();

      const state = useSettingsStore.getState();
      // The bad key is blanked, but the validated preferences are NOT wiped to defaults.
      expect(state.apiKey).toBe('');
      expect(state.model).toBe('gemini-3.1-pro-preview');
      expect(state.theme).toBe('dark');
      expect(state.hasSeenOnboarding).toBe(true);
    });
  });
});
