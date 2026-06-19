import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { LayoutProvider } from './components/layout/Layout';
import { ApiKeyBanner } from './components/ApiKeyBanner';
import { SettingsModal } from './components/modals/SettingsModal';
import { useSettingsStore } from './store/useSettingsStore';
import { LoadingIndicator } from './components/LoadingIndicator';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy load page components
const SimpleOCR = lazy(() => import('./pages/SimpleOCR').then(module => ({ default: module.default })));
const TemplatesOCR = lazy(() => import('./pages/TemplatesOCR').then(module => ({ default: module.default })));
const WebOCR = lazy(() => import('./pages/WebOCR').then(module => ({ default: module.default })));
const AdvancedOCR = lazy(() => import('./pages/AdvancedOCR').then(module => ({ default: module.default })));
const AgenticOCR = lazy(() => import('./pages/AgenticOCR').then(module => ({ default: module.default })));

function App() {
  const { apiKey, hasHydrated, setApiKey, theme, setTheme, model, setModel, thinkingConfig, updateThinkingConfig } = useSettingsStore(
    useShallow((state) => ({
      apiKey: state.apiKey,
      hasHydrated: state.hasHydrated,
      setApiKey: state.setApiKey,
      theme: state.theme,
      setTheme: state.setTheme,
      model: state.model,
      setModel: state.setModel,
      thinkingConfig: state.thinkingConfig,
      updateThinkingConfig: state.updateThinkingConfig,
    }))
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isApiBannerDismissed, setIsApiBannerDismissed] = useState(false);
  const previousApiKeyRef = useRef(apiKey);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const previouslyHadApiKey = Boolean(previousApiKeyRef.current);
    const hasApiKey = Boolean(apiKey);

    if (previouslyHadApiKey && !hasApiKey) {
      setIsApiBannerDismissed(false);
    }

    previousApiKeyRef.current = apiKey;
  }, [apiKey, hasHydrated]);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    // SettingsModal restores focus to the trigger on close.
    setIsSettingsOpen(false);
  }, []);

  const handleSaveSettings = useCallback(async (newApiKey: string, newTheme: typeof theme, newModel: typeof model, newThinkingConfig: typeof thinkingConfig) => {
    await setApiKey(newApiKey);
    setTheme(newTheme);
    setModel(newModel);
    updateThinkingConfig(newThinkingConfig);
    setIsSettingsOpen(false);
  }, [setApiKey, setTheme, setModel, updateThinkingConfig]);

  const handleCloseBanner = useCallback(() => {
    setIsApiBannerDismissed(true);
  }, []);

  const showBanner = hasHydrated && !apiKey && !isApiBannerDismissed;

  if (!hasHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <LoadingIndicator size="lg" text="Loading settings..." />
      </div>
    );
  }

  return (
    <>
      {/* API Key Banner (showBanner already requires !apiKey) */}
      {showBanner && (
        <ApiKeyBanner
          onOpenSettings={handleOpenSettings}
          onClose={handleCloseBanner}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        initialApiKey={apiKey}
        initialTheme={theme}
        initialModel={model}
        initialThinkingConfig={thinkingConfig}
      />

      <ErrorBoundary>
        <LayoutProvider
          theme={theme}
          apiKey={apiKey}
          onOpenSettings={handleOpenSettings}
        >
          <Suspense fallback={<div className="p-8 flex justify-center"><LoadingIndicator size="lg" text="Loading page..." /></div>}>
            <Routes>
              <Route path="/" element={<SimpleOCR />} />
              <Route path="/templates" element={<TemplatesOCR />} />
              <Route path="/web" element={<WebOCR />} />
              <Route path="/advanced" element={<AdvancedOCR />} />
              <Route path="/agentic" element={<AgenticOCR />} />
            </Routes>
          </Suspense>
        </LayoutProvider>
      </ErrorBoundary>
    </>
  );
}

export default App;
