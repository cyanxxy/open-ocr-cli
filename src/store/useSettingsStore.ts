import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { encryptData, decryptData } from '../lib/crypto';
import { logger } from '../lib/logger';
import type { GeminiModel, ThinkingConfig, ThinkingLevel } from '../lib/gemini/types';
import { createSelectors } from './createSelectors';
import { STORAGE_KEYS } from '../constants';

// Re-export shared Gemini config types for convenience
export type { GeminiModel as ModelType, ThinkingConfig, ThinkingLevel };

/**
 * Defines the available Gemini preview model types that the user can select.
 */
export type ModelType = GeminiModel;

/**
 * Defines the available theme modes for the application.
 */
export type ThemeMode = 'light' | 'dark' | 'amoled';

const VALID_MODELS: ModelType[] = ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'];
const VALID_THEMES: ThemeMode[] = ['light', 'dark', 'amoled'];

const DEFAULT_THINKING_CONFIG: ThinkingConfig = {
  level: 'HIGH',
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

function normalizeThinkingConfigForModel(
  model: ModelType,
  thinkingConfig: ThinkingConfig,
): ThinkingConfig {
  const allowedLevels: ThinkingLevel[] = model === 'gemini-3-flash-preview'
    ? ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']
    : ['LOW', 'MEDIUM', 'HIGH'];
  const rawLevel = typeof thinkingConfig.level === 'string'
    ? thinkingConfig.level.toUpperCase()
    : thinkingConfig.level;

  return {
    ...thinkingConfig,
    level: allowedLevels.includes(rawLevel as ThinkingLevel)
      ? (rawLevel as ThinkingLevel)
      : 'HIGH',
    includeThoughts: Boolean(thinkingConfig.includeThoughts),
  };
}

function validateRehydratedState(state: SettingsState): Partial<SettingsState> {
  const patch: Partial<SettingsState> = {};

  // Validate model - migrate legacy Gemini 3 Pro to Gemini 3.1 Pro
  let migratedModel = state.model;
  if (migratedModel === ('gemini-3-pro-preview' as ModelType)) {
    migratedModel = 'gemini-3.1-pro-preview';
  }
  if (!VALID_MODELS.includes(migratedModel)) {
    migratedModel = 'gemini-3-flash-preview';
  }
  if (migratedModel !== state.model) {
    patch.model = migratedModel;
  }

  if (!VALID_THEMES.includes(state.theme)) {
    patch.theme = 'light';
  }

  if (typeof state.handwritingMode !== 'boolean') {
    patch.handwritingMode = false;
  }

  if (!state.thinkingConfig || typeof state.thinkingConfig !== 'object') {
    patch.thinkingConfig = DEFAULT_THINKING_CONFIG;
    return patch;
  }

  const normalizedThinkingConfig = normalizeThinkingConfigForModel(
    migratedModel,
    state.thinkingConfig,
  );

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
  /** Thinking mode configuration for Gemini preview models */
  thinkingConfig: ThinkingConfig;
  /** Whether Zustand has finished rehydrating persisted state */
  hasHydrated: boolean;

  /**
   * Sets the API key. The key is encrypted before being stored in localStorage
   * and also updated in the Zustand state.
   * @param key - The API key string to set.
   */
  setApiKey: (key: string) => void;
  /**
   * Sets the AI model to be used for OCR and other generative tasks.
   * @param model - The {@link ModelType} to set.
   */
  setModel: (model: ModelType) => void;
  /**
   * Enables or disables handwriting-specific OCR enhancements.
   * @param enabled - `true` to enable handwriting mode, `false` to disable.
   */
  setHandwritingMode: (enabled: boolean) => void;
  /**
   * Sets the application theme. It updates the class on the HTML document root
   * to apply theme styles and updates the state.
   * @param theme - The {@link ThemeMode} to apply.
   */
  setTheme: (theme: ThemeMode) => void;
  /**
   * Updates thinking mode configuration
   * @param config - Partial thinking configuration update
   */
  updateThinkingConfig: (config: Partial<ThinkingConfig>) => void;
}

/**
 * Zustand store for managing application settings.
 *
 * This store handles:
 * - User's API key (encrypted in localStorage).
 * - Selected AI model.
 * - Handwriting mode preference.
 * - Application theme.
 *
 * It uses `persist` middleware to save settings (excluding the raw API key, which is handled specially)
 * to local storage. The API key is encrypted via `encryptData` before saving to `localStorage`
 * (under the key 'gemini-api-key') and decrypted via `decryptData` during the `onRehydrateStorage`
 * process. The theme is also applied to the document element during rehydration and when set.
 */
const useSettingsStoreBase = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      model: 'gemini-3-flash-preview',
      handwritingMode: false,
      theme: 'light',
      thinkingConfig: DEFAULT_THINKING_CONFIG,
      hasHydrated: false,

      setApiKey: async (key: string) => {
        const trimmedKey = key.trim();
        try {
          if (!trimmedKey) {
            localStorage.removeItem(STORAGE_KEYS.API_KEY);
          } else {
            const encryptedKey = await encryptData(trimmedKey);
            localStorage.setItem(STORAGE_KEYS.API_KEY, encryptedKey);
          }
        } catch (error) {
          logger.error('Failed to encrypt API key:', error);
        }
        set({ apiKey: trimmedKey });
      },
      setModel: (model: ModelType) => {
        if (!VALID_MODELS.includes(model)) {
          return;
        }

        set((state) => ({
          model,
          thinkingConfig: normalizeThinkingConfigForModel(model, state.thinkingConfig),
        }));
      },
      setHandwritingMode: (enabled: boolean) => set({ handwritingMode: enabled }),
      setTheme: (theme: ThemeMode) => {
        if (!VALID_THEMES.includes(theme)) return;
        applyTheme(theme);
        set({ theme });
      },
      updateThinkingConfig: (config) => set((state) => {
        return {
          thinkingConfig: normalizeThinkingConfigForModel(state.model, {
            ...state.thinkingConfig,
            ...config,
          }),
        };
      }),
    }),
    {
      name: 'gemini-settings',
      partialize: (state) => ({
        model: state.model,
        handwritingMode: state.handwritingMode,
        theme: state.theme,
        thinkingConfig: state.thinkingConfig
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

            const encryptedKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
            if (encryptedKey) {
              const decryptedKey = await decryptData(encryptedKey);
              if (decryptedKey && typeof decryptedKey === 'string') {
                patch.apiKey = decryptedKey;
              }
            }

            queueSettingsPatch({
              ...patch,
              hasHydrated: true,
            });
          } catch (rehydrationError) {
            logger.error('Failed to validate settings during rehydration:', rehydrationError);
            applyTheme('light');
            queueSettingsPatch({
              apiKey: '',
              model: 'gemini-3-flash-preview',
              handwritingMode: false,
              theme: 'light',
              thinkingConfig: DEFAULT_THINKING_CONFIG,
              hasHydrated: true,
            });
          }
        };
      },
    }
  )
);

if (useSettingsStoreBase.persist.hasHydrated()) {
  useSettingsStoreBase.setState({ hasHydrated: true });
}

export const useSettingsStore = createSelectors(useSettingsStoreBase);
