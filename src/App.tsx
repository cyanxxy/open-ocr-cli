import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Link, Routes, Route, useLocation } from 'react-router';
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

const APP_NAME = 'Gemini OCR';

// Per-route document titles (audit X-07). Unlisted paths fall back to the 404 title.
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Simple OCR',
  '/templates': 'Templates OCR',
  '/web': 'Web OCR',
  '/advanced': 'Bulk OCR',
  '/agentic': 'Agentic OCR',
};

/** Keep the document title in sync with the active route (audit X-07). */
function usePageTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const pageName = ROUTE_TITLES[pathname] ?? 'Page Not Found';
    document.title = `${pageName} | ${APP_NAME}`;
  }, [pathname]);
}

/** Catch-all fallback for unknown routes (audit U-12). */
function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <p className="text-5xl font-bold text-stone-300 dark:text-stone-700">404</p>
      <h1 className="mt-4 text-xl font-semibold text-stone-900 dark:text-stone-100">
        Page not found
      </h1>
      <p className="mt-2 max-w-sm text-sm text-stone-500 dark:text-stone-400">
        The page you are looking for does not exist or has moved.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#E34234] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#C9352A]"
      >
        Go to Simple OCR
      </Link>
    </div>
  );
}

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

  usePageTitle();

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
    // Apply the synchronous preferences first so a key-persist failure (audit H-12)
    // doesn't also discard the user's theme/model/thinking changes.
    setTheme(newTheme);
    setModel(newModel);
    updateThinkingConfig(newThinkingConfig);
    // Awaited last: if it throws, the modal stays open and surfaces the error
    // (audit U-09) rather than closing as if the save fully succeeded.
    await setApiKey(newApiKey);
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
      {/* The API-key shell (banner + settings modal) renders outside the page
          ErrorBoundary, so it gets its own boundary — a render error here must
          not take down the whole app with a blank screen (audit U-10). */}
      <ErrorBoundary>
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
      </ErrorBoundary>

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
              {/* Catch-all 404 so unknown paths render a clear message instead of
                  a blank content area (audit U-12). */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </LayoutProvider>
      </ErrorBoundary>
    </>
  );
}

export default App;
