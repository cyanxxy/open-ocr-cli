import type { KeyboardEvent } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Save,
  Key,
  Moon,
  Sun,
  Zap,
  Check,
  Beaker,
  AlertCircle,
  Wifi,
  ShieldX,
  Database,
  ExternalLink,
  Sparkles,
  Monitor
} from 'lucide-react';
import type { ThemeMode, ModelType, ThinkingConfig } from '../../store/useSettingsStore';
import type { TestResult } from '../../utils/testGemini';
import { testGemini } from '../../utils/testGemini';
import { cn } from '../../design/theme';

const ERROR_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  auth: ShieldX,
  quota: Database,
  network: Wifi,
};

function ErrorIcon({ errorType }: { errorType?: string }) {
  const Icon = ERROR_ICONS[errorType || ''] || AlertCircle;
  return <Icon className="w-3 h-3" />;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (apiKey: string, theme: ThemeMode, model: ModelType, thinkingConfig: ThinkingConfig) => void | Promise<void>;
  initialApiKey: string;
  initialTheme: ThemeMode;
  initialModel: ModelType;
  initialThinkingConfig: ThinkingConfig;
}

export function SettingsModal({
  isOpen,
  onClose,
  onSave,
  initialApiKey,
  initialTheme,
  initialModel,
  initialThinkingConfig
}: SettingsModalProps) {
  const [tempApiKey, setTempApiKey] = useState(initialApiKey);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialTheme);
  const [model, setModel] = useState<ModelType>(initialModel);
  const [thinkingConfig, setThinkingConfig] = useState<ThinkingConfig>(initialThinkingConfig);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const backdropMouseDownRef = useRef(false);

  // Sync local state only when modal transitions from closed to open
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setTempApiKey(initialApiKey);
      setThemeMode(initialTheme);
      setModel(initialModel);
      setThinkingConfig(initialThinkingConfig);
      setTestResult(null);
    }
    wasOpen.current = isOpen;
  }, [isOpen, initialApiKey, initialTheme, initialModel, initialThinkingConfig]);

  useEffect(() => {
    if (isOpen) {
      // Own the full focus lifecycle: remember what was focused before opening,
      // move focus into the modal, and restore it on close/unmount so callers
      // don't need to reach back in via a hardcoded element id.
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      const timer = setTimeout(() => apiKeyInputRef.current?.focus(), 50);
      document.body.style.overflow = 'hidden';
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = '';
        previouslyFocusedRef.current?.focus?.();
      };
    }
    document.body.style.overflow = '';
  }, [isOpen]);

  useEffect(() => {
    if (model === 'gemini-3.1-pro-preview' && thinkingConfig.level === 'MINIMAL') {
      setThinkingConfig((prev) => ({ ...prev, level: 'HIGH' }));
    }
  }, [model, thinkingConfig.level]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }, [onClose]);

  const handleSave = useCallback(
    () => onSave(tempApiKey, themeMode, model, thinkingConfig),
    [onSave, tempApiKey, themeMode, model, thinkingConfig]
  );

  const handleTestApiKey = useCallback(async () => {
    if (!tempApiKey.trim()) {
      setTestResult({ success: false, model, responseTime: 0, error: 'Enter an API key first', errorType: 'auth' });
      return;
    }
    setIsTestingApi(true);
    setTestResult(null);
    try {
      const result = await testGemini(tempApiKey, model);
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, model, responseTime: 0, error: error instanceof Error ? error.message : 'Unknown error', errorType: 'unknown' });
    } finally {
      setIsTestingApi(false);
    }
  }, [tempApiKey, model]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop — close only when both the press and release happen on the
          backdrop itself, so a text drag that ends here doesn't discard edits. */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onMouseDown={(e) => { backdropMouseDownRef.current = e.target === e.currentTarget; }}
        onClick={(e) => {
          if (backdropMouseDownRef.current && e.target === e.currentTarget) {
            onClose();
          }
          backdropMouseDownRef.current = false;
        }}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={cn(
          "relative w-full max-w-sm overflow-hidden flex flex-col",
          "max-h-[calc(100vh-6rem)] sm:max-h-[80vh]",
          "mx-4 sm:mx-6",
          "bg-white dark:bg-stone-950 amoled:bg-black",
          "rounded-3xl shadow-xl ring-1 ring-black/5 dark:ring-white/10"
        )}
        style={{
          animation: 'scaleIn 0.2s ease-out forwards',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <h2
            id="settings-title"
            className="text-lg font-semibold text-stone-900 dark:text-stone-100 tracking-tight"
          >
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-1 pb-4 space-y-5">

          {/* Theme */}
          <section>
            <label className="text-[11px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 block px-1">Theme</label>
            <div className="flex p-1 bg-stone-100/80 dark:bg-stone-900/80 rounded-2xl ring-1 ring-inset ring-stone-200/50 dark:ring-white/5">
              {([
                { value: 'light' as ThemeMode, label: 'Light', icon: Sun },
                { value: 'dark' as ThemeMode, label: 'Dark', icon: Moon },
                { value: 'amoled' as ThemeMode, label: 'AMOLED', icon: Monitor },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setThemeMode(value)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all duration-200",
                    themeMode === value
                      ? "bg-white dark:bg-stone-800 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                      : "hover:bg-stone-200/50 dark:hover:bg-stone-800/50 text-stone-500 dark:text-stone-400"
                  )}
                >
                  <Icon className={cn("w-4 h-4", themeMode === value ? "text-stone-900 dark:text-stone-100" : "opacity-70")} />
                  <span className={cn("text-xs font-medium", themeMode === value ? "text-stone-900 dark:text-stone-100" : "opacity-70")}>{label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Model */}
          <section>
            <label className="text-[11px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 block px-1">Model</label>
            <div className="flex flex-col p-1.5 bg-stone-100/80 dark:bg-stone-900/80 rounded-2xl ring-1 ring-inset ring-stone-200/50 dark:ring-white/5 gap-1">
              {([
                { value: 'gemini-3.5-flash' as ModelType, label: 'Gemini 3.5 Flash', badge: 'New', icon: Zap },
                { value: 'gemini-3-flash-preview' as ModelType, label: 'Gemini 3 Flash', badge: 'Fast', icon: Zap },
                { value: 'gemini-3.1-pro-preview' as ModelType, label: 'Gemini 3.1 Pro', badge: 'Best', icon: Sparkles },
              ]).map(({ value, label, badge, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setModel(value)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left duration-200",
                    model === value
                      ? "bg-white dark:bg-stone-800 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                      : "hover:bg-stone-200/50 dark:hover:bg-stone-800/50"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    model === value ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-200 dark:bg-stone-800"
                  )}>
                    <Icon className={cn("w-4 h-4", model === value ? "text-white dark:text-stone-900" : "text-stone-500 dark:text-stone-400")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-medium", model === value ? "text-stone-900 dark:text-stone-100" : "text-stone-600 dark:text-stone-400")}>{label}</span>
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium",
                        model === value
                          ? "bg-stone-100 dark:bg-stone-900 text-stone-600 dark:text-stone-300"
                          : "bg-stone-200 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
                      )}>{badge}</span>
                    </div>
                  </div>
                  <div className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center transition-colors",
                    model === value ? "bg-[#E34234]" : "bg-stone-200 dark:bg-stone-800"
                  )}>
                    {model === value && <Check className="w-3 h-3 text-white" />}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* API Key */}
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <label className="text-[11px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider block">API Key</label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-[#E34234] hover:text-[#C9352A] transition-colors"
              >
                Get Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="space-y-2 p-1.5 bg-stone-100/80 dark:bg-stone-900/80 rounded-2xl ring-1 ring-inset ring-stone-200/50 dark:ring-white/5">
              <div className="relative">
                <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input
                  ref={apiKeyInputRef}
                  type="password"
                  value={tempApiKey}
                  onChange={e => setTempApiKey(e.target.value)}
                  placeholder="Enter your Gemini API key"
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white dark:bg-stone-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#E34234]/20 focus:border-[#E34234]/30 border border-stone-200 dark:border-stone-700 transition-all shadow-sm"
                />
              </div>
              <button
                onClick={handleTestApiKey}
                disabled={isTestingApi || !tempApiKey}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white dark:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 disabled:opacity-50 transition-colors border border-stone-200 dark:border-stone-700 shadow-sm"
              >
                {isTestingApi ? (
                  <><div className="w-4 h-4 border-2 border-stone-400 border-t-transparent rounded-full animate-spin" /> Testing...</>
                ) : (
                  <><Beaker className="w-4 h-4" /> Test Connection</>
                )}
              </button>
              {testResult && (
                <div className={cn(
                  "p-3 rounded-xl flex items-center gap-2 text-xs border backdrop-blur-sm",
                  testResult.success
                    ? "bg-emerald-50/80 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800"
                    : "bg-red-50/80 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800"
                )}>
                  {testResult.success ? <Check className="w-4 h-4" /> : <ErrorIcon errorType={testResult.errorType} />}
                  <span className="font-medium">{testResult.success ? 'Connected' : 'Failed'}</span>
                  <span className="opacity-75">— {testResult.error || `${testResult.responseTime}ms`}</span>
                </div>
              )}
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">Stored locally in this browser.</p>
                <p className="mt-1 opacity-90">
                  Use this only on a trusted/private device. For production deployments, route Gemini requests through a server instead of shipping a long-lived API key to browsers.
                </p>
              </div>
            </div>
          </section>

          {/* Reasoning Level */}
          <section>
            <label className="text-[11px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 block px-1">Reasoning</label>
            <div className={cn("grid p-1 bg-stone-100/80 dark:bg-stone-900/80 rounded-2xl ring-1 ring-inset ring-stone-200/50 dark:ring-white/5", (model === 'gemini-3-flash-preview' || model === 'gemini-3.5-flash') ? "grid-cols-4" : "grid-cols-3")}>
              {[
                ...((model === 'gemini-3-flash-preview' || model === 'gemini-3.5-flash') ? [{ value: 'MINIMAL' as const, label: 'Min', emoji: '🌱' }] : []),
                { value: 'LOW' as const, label: 'Low', emoji: '⚡' },
                { value: 'MEDIUM' as const, label: 'Med', emoji: '⚖️' },
                { value: 'HIGH' as const, label: 'High', emoji: '🧠' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setThinkingConfig({ ...thinkingConfig, level: opt.value })}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all duration-200",
                    thinkingConfig.level === opt.value
                      ? "bg-white dark:bg-stone-800 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                      : "hover:bg-stone-200/50 dark:hover:bg-stone-800/50"
                  )}
                >
                  <span className={cn(
                    "text-lg transition-transform duration-200",
                    thinkingConfig.level === opt.value ? "scale-110" : "grayscale opacity-50"
                  )}>{opt.emoji}</span>
                  <span className={cn(
                    "text-xs font-medium transition-colors",
                    thinkingConfig.level === opt.value ? "text-stone-900 dark:text-stone-100" : "text-stone-500 dark:text-stone-400"
                  )}>{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold text-white bg-[#E34234] hover:bg-[#C9352A] shadow-lg shadow-[#E34234]/20 hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-4 focus:ring-[#E34234]/20"
          >
            <Save className="w-4 h-4" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
