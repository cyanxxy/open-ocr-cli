import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { encryptData, decryptData } from '../lib/crypto';
import { logger } from '../lib/logger';
import { clearGeminiClientCache } from '../lib/gemini/client';
import type { GeminiModel, ThinkingConfig, ThinkingLevel } from '../lib/gemini/types';
import { createSelectors } from './createSelectors';
import { STORAGE_KEYS } from '../constants';

/**
 * Error thrown by {@link SettingsState.setApiKey} when the key was accepted in
 * memory for the current session but could NOT be persisted to localStorage
 * (e.g. encryption failed or storage is full/blocked). Callers can catch this
 * to warn the user that the key will be lost on refresh (audit H-12).
 */
export class ApiKeyPersistError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiKeyPersistError';
  }
}

// Re-export shared Gemini config types for convenience
export type { GeminiModel, ThinkingConfig, ThinkingLevel };

/**
 * Defines the available Gemini preview model types that the user can select.
 */
export type ModelType = GeminiModel;

/**
 * Defines the available theme modes for the application.
 */
export type ThemeMode = 'light' | 'dark' | 'amoled';

const VALID_MODELS: ModelType[] = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];
const VALID_THEMES: ThemeMode[] = ['light', 'dark', 'amoled'];
const VALID_LEVELS: ThinkingLevel[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

/** Day-to-day default: medium matches Gemini 3.5 Flash API default and balances OCR quality vs cost. */
const DEFAULT_THINKING_CONFIG: ThinkingConfig = {
  level: 'MEDIUM',
  includeThoughts: false,
};

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.remove('light', 'dark', 'amoled');
  if (theme === 'amoled') {
    // AMOLED needs both: 'dark' for base dark styles, 'amoled' for deeper black overrides
    document.documentElement.classList.add('dark', 'amoled');
  } else {
    document.documentElement.classList.add(theme);
  }
}

function migratePersistedModel(raw: string | undefined): ModelType {
  if (raw === 'gemini-3-pro-preview') {
    return 'gemini-3.1-pro-preview';
  }

  if (raw && VALID_MODELS.includes(raw as ModelType)) {
    return raw as ModelType;
  }

  return 'gemini-3.5-flash';
}

function migrateThinkingLevel(raw: string | undefined): ThinkingLevel {
  if (!raw) return 'HIGH';

  const upper = raw.toUpperCase() as ThinkingLevel;
  if (VALID_LEVELS.includes(upper)) {
    return upper;
  }

  return 'HIGH';
}

function clampThinkingLevel(model: ModelType, level: ThinkingLevel): ThinkingLevel {
  const isFlashFamily = model === 'gemini-3-flash-preview'
    || model === 'gemini-3.5-flash'
    || model === 'gemini-3.1-flash-lite';
  const allowed = isFlashFamily
    ? (['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] as const)
    : (['LOW', 'MEDIUM', 'HIGH'] as const);
  // Model-aware fallbacks match API defaults.
  const fallback: ThinkingLevel = model === 'gemini-3.1-flash-lite'
    ? 'MINIMAL'
    : model === 'gemini-3.5-flash'
      ? 'MEDIUM'
      : 'HIGH';

  return (allowed as readonly string[]).includes(level) ? level : fallback;
}

function validateRehydratedState(state: SettingsState): Partial<SettingsState> {
  const patch: Partial<SettingsState> = {};

  const migratedModel = migratePersistedModel(state.model);
  if (migratedModel !== state.model) {
    patch.model = migratedModel;
  }

  if (!VALID_THEMES.includes(state.theme)) {
    patch.theme = 'light';
  }

  if (typeof state.handwritingMode !== 'boolean') {
    patch.handwritingMode = false;
  }

  if (typeof state.hasSeenOnboarding !== 'boolean') {
    patch.hasSeenOnboarding = false;
  }

  if (!state.thinkingConfig || typeof state.thinkingConfig !== 'object') {
    patch.thinkingConfig = DEFAULT_THINKING_CONFIG;
    return patch;
  }

  const migratedLevel = migrateThinkingLevel(state.thinkingConfig.level);
  const includeThoughts = typeof state.thinkingConfig.includeThoughts === 'boolean'
    ? state.thinkingConfig.includeThoughts
    : false;
  const normalizedThinkingConfig = {
    level: clampThinkingLevel(migratedModel, migratedLevel),
    includeThoughts,
  };

  if (
    normalizedThinkingConfig.level !== state.thinkingConfig.level
    || normalizedThinkingConfig.includeThoughts !== state.thinkingConfig.includeThoughts
  ) {
    patch.thinkingConfig = normalizedThinkingConfig;
  }

  return patch;
}

function readPersistedSettingsSnapshot(): Partial<SettingsState> | null {
  try {
    const raw = localStorage.getItem('gemini-settings');
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { state?: Partial<SettingsState> };
    if (parsed && parsed.state && typeof parsed.state === 'object') {
      return parsed.state;
    }
  } catch (error) {
    logger.error('Failed to read persisted settings snapshot:', error);
  }

  return null;
}

function queueSettingsPatch(partial: Partial<SettingsState>) {
  queueMicrotask(() => {
    useSettingsStoreBase.setState(partial);
  });
}

/**
 * Defines the state and actions for managing application settings.
 * This includes user preferences like API key, AI model, theme,
 * and interaction states like onboarding completion.
 */
interface SettingsState {
  /**
   * The user's Google Generative AI API key.
   * This is stored encrypted in localStorage by the `setApiKey` action
   * and decrypted on rehydration.
   */
  apiKey: string;
  /** The selected {@link ModelType} for AI operations. */
  model: ModelType;
  /** A boolean indicating whether handwriting-specific OCR enhancements are enabled. */
  handwritingMode: boolean;
  /** The currently active {@link ThemeMode} for the application. */
  theme: ThemeMode;
  /** Whether the user has seen the onboarding flow. */
  hasSeenOnboarding: boolean;
  /** Thinking mode configuration for Gemini preview models */
  thinkingConfig: ThinkingConfig;
  /** Whether Zustand has finished rehydrating persisted state */
  hasHydrated: boolean;

  setApiKey: (key: string) => Promise<void>;
  setModel: (model: ModelType) => void;
  setHandwritingMode: (enabled: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setHasSeenOnboarding: (seen: boolean) => void;
  updateThinkingConfig: (config: Partial<ThinkingConfig>) => void;
}

const useSettingsStoreBase = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      model: 'gemini-3.5-flash',
      handwritingMode: false,
      theme: 'light',
      hasSeenOnboarding: false,
      thinkingConfig: DEFAULT_THINKING_CONFIG,
      hasHydrated: false,

      setApiKey: async (key: string) => {
        const trimmedKey = key.trim();
        let persistError: unknown = null;
        try {
          if (!trimmedKey) {
            localStorage.removeItem(STORAGE_KEYS.API_KEY);
          } else {
            const obfuscatedKey = await encryptData(trimmedKey);
            localStorage.setItem(STORAGE_KEYS.API_KEY, obfuscatedKey);
          }
        } catch (error) {
          // Keep the key usable for this session, but remember the failure so we
          // can surface it to the caller instead of silently resolving (audit H-12).
          persistError = error;
          logger.error('Failed to obfuscate API key for browser-local storage:', error);
        }
        // The key changed (set or cleared): drop any cached GoogleGenAI client so
        // a rotated/removed credential is never served from a stale client.
        clearGeminiClientCache();
        set({ apiKey: trimmedKey });

        if (persistError) {
          throw new ApiKeyPersistError(
            'Your API key is active for this session but could not be saved. It will be lost when you refresh or close the tab.',
            { cause: persistError },
          );
        }
      },

      setModel: (model) => {
        const rawModel = model as string;
        if (rawModel !== 'gemini-3-pro-preview' && !VALID_MODELS.includes(rawModel as ModelType)) {
          return;
        }

        const normalizedModel = migratePersistedModel(rawModel);
        set((state) => ({
          model: normalizedModel,
          thinkingConfig: {
            ...state.thinkingConfig,
            level: clampThinkingLevel(normalizedModel, state.thinkingConfig.level),
          },
        }));
      },

      setHandwritingMode: (enabled) => set({ handwritingMode: enabled }),

      setTheme: (theme) => {
        if (!VALID_THEMES.includes(theme)) return;
        applyTheme(theme);
        set({ theme });
      },

      setHasSeenOnboarding: (seen) => set({ hasSeenOnboarding: seen }),

      updateThinkingConfig: (config) => set((state) => {
        const level = clampThinkingLevel(
          state.model,
          migrateThinkingLevel(config.level ?? state.thinkingConfig.level),
        );

        return {
          thinkingConfig: {
            ...state.thinkingConfig,
            ...config,
            level,
          },
        };
      }),
    }),
    {
      name: 'gemini-settings',
      partialize: (state) => ({
        model: state.model,
        handwritingMode: state.handwritingMode,
        theme: state.theme,
        hasSeenOnboarding: state.hasSeenOnboarding,
        thinkingConfig: state.thinkingConfig,
      }),
      onRehydrateStorage: () => {
        return async (state, error) => {
          if (error) {
            logger.error('Failed to rehydrate settings:', error);
            queueSettingsPatch({ hasHydrated: true });
            return;
          }

          if (!state) {
            queueSettingsPatch({ hasHydrated: true });
            return;
          }

          try {
            const persistedSnapshot = readPersistedSettingsSnapshot();
            const validationTarget = {
              ...state,
              ...persistedSnapshot,
            } as SettingsState;
            const patch = validateRehydratedState(validationTarget);
            const theme = patch.theme ?? validationTarget.theme;
            applyTheme(theme);

            // Decrypt the API key inside its own try/catch so a transient/corrupt
            // ciphertext only blanks the key — it must NOT wipe the already-validated
            // model/theme/onboarding/thinkingConfig preferences (audit H-13).
            try {
              const obfuscatedKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
              if (obfuscatedKey) {
                const restoredKey = await decryptData(obfuscatedKey);
                if (restoredKey && typeof restoredKey === 'string') {
                  patch.apiKey = restoredKey;
                }
              }
            } catch (keyError) {
              logger.error('Failed to restore API key during rehydration; other settings preserved:', keyError);
              patch.apiKey = '';
            }

            queueSettingsPatch({
              ...patch,
              hasHydrated: true,
            });
          } catch (rehydrationError) {
            // Only reached for a catastrophic failure (e.g. validation/applyTheme
            // threw), not for a decrypt failure — that is handled above.
            logger.error('Failed to validate settings during rehydration:', rehydrationError);
            applyTheme('light');
            queueSettingsPatch({
              apiKey: '',
              model: 'gemini-3.5-flash',
              handwritingMode: false,
              theme: 'light',
              hasSeenOnboarding: false,
              thinkingConfig: DEFAULT_THINKING_CONFIG,
              hasHydrated: true,
            });
          }
        };
      },
    },
  ),
);

if (useSettingsStoreBase.persist.hasHydrated()) {
  useSettingsStoreBase.setState({ hasHydrated: true });
}

export const useSettingsStore = createSelectors(useSettingsStoreBase);
