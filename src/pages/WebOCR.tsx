import type React from 'react';
import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Globe, Loader, Link, Copy, Sparkles, LayoutTemplate, Radio, FileText, Check } from 'lucide-react';

// State Management & Hooks
import { useWebOcrStore, type UrlResult } from '../store/useWebOcrStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { logger } from '../lib/logger';

// Components
import { Alert } from '../components/molecules/Alert';
import { UrlInput } from '../components/molecules/UrlInput';
import { ApiKeyPrompt } from '../components/organisms/ApiKeyPrompt';
import MarkdownRenderer from '../components/MarkdownRenderer';

// Theme
import { cn, editorial } from '../design/theme';
import { isSupportedHttpUrl } from '../lib/urlValidation';

// Paper texture SVG for background
const PaperTexture = () => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.015] dark:opacity-[0.03] pointer-events-none" aria-hidden="true">
    <filter id="paper-noise-web">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#paper-noise-web)" />
  </svg>
);

// Corner decoration component
const CornerDecoration = ({ position }: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) => {
  const positionClasses = {
    'top-left': 'top-3 left-3',
    'top-right': 'top-3 right-3 rotate-90',
    'bottom-left': 'bottom-3 left-3 -rotate-90',
    'bottom-right': 'bottom-3 right-3 rotate-180',
  };

  return (
    <div className={cn('absolute w-4 h-4 pointer-events-none', positionClasses[position])} aria-hidden="true">
      <div className="absolute top-0 left-0 w-full h-[1.5px] bg-stone-300 dark:bg-stone-600" />
      <div className="absolute top-0 left-0 h-full w-[1.5px] bg-stone-300 dark:bg-stone-600" />
    </div>
  );
};

interface AnalysisModeToggleProps {
  mode: 'individual' | 'combined' | 'comparison';
  onChange: (mode: 'individual' | 'combined' | 'comparison') => void;
  disabled?: boolean;
}

const AnalysisModeToggle: React.FC<AnalysisModeToggleProps> = ({ mode, onChange, disabled }) => {
  return (
    <div
      className="flex p-1 bg-stone-100 dark:bg-stone-800 amoled:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-700"
      role="tablist"
    >
      {(['individual', 'combined', 'comparison'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          disabled={disabled}
          role="tab"
          aria-selected={mode === m}
          className={cn(
            "flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-all duration-200 capitalize",
            mode === m
              ? "bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm"
              : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
          )}
          style={{ fontFamily: editorial.fonts.body }}
        >
          {m}
        </button>
      ))}
    </div>
  );
};

interface UrlResultCardProps {
  result: UrlResult;
  index: number;
}

const UrlResultCard: React.FC<UrlResultCardProps> = ({ result, index }) => {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSafeUrl = isSupportedHttpUrl(result.url);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getTypeIcon = () => {
    switch (result.type) {
      case 'webpage': return <Globe className="w-4 h-4" />;
      case 'image': return <FileText className="w-4 h-4" />;
      case 'pdf': return <FileText className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.content);
      setIsCopied(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setIsCopied(false);
        timeoutRef.current = null;
      }, 2000);
    } catch (error) {
      logger.error('Failed to copy:', error);
    }
  }, [result.content]);

  return (
    <div className="relative rounded-xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 shadow-sm hover:shadow-md transition-shadow duration-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-200/60 dark:border-stone-700/50 bg-stone-50/50 dark:bg-stone-800/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: 'rgba(227, 66, 52, 0.1)' }}
            >
              <span style={{ color: '#E34234' }}>{getTypeIcon()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <h4
                className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate"
                style={{ fontFamily: editorial.fonts.heading }}
              >
                {result.title || `Dispatch ${index + 1}`}
              </h4>
              {hasSafeUrl ? (
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 hover:underline transition-colors"
                  style={{ color: '#E34234', fontFamily: editorial.fonts.body }}
                >
                  <Link className="w-3 h-3" />
                  <span className="truncate">{result.url}</span>
                </a>
              ) : (
                <span
                  className="text-xs flex items-center gap-1 text-stone-500 dark:text-stone-400"
                  style={{ fontFamily: editorial.fonts.body }}
                >
                  <Link className="w-3 h-3" />
                  <span className="truncate">{result.url}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!result.error && (
              <button
                onClick={handleCopy}
                className={cn(
                  "p-1.5 rounded-lg transition-all duration-200",
                  "hover:bg-stone-100 dark:hover:bg-stone-800",
                  "focus:outline-none focus:ring-2 focus:ring-stone-500/20"
                )}
                aria-label="Copy content"
              >
                {isCopied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300" />
                )}
              </button>
            )}
            <span
              className="text-xs px-2 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 capitalize"
              style={{ fontFamily: editorial.fonts.body }}
            >
              {result.type}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {result.error ? (
          <Alert variant="error" className="text-sm">
            {result.error}
          </Alert>
        ) : (
          <div className="prose prose-sm prose-stone dark:prose-invert max-w-none max-h-80 overflow-y-auto pr-2">
            <MarkdownRenderer content={result.content} />
          </div>
        )}
      </div>
    </div>
  );
};

export default function WebOCR() {
  // Store hooks
  const apiKey = useSettingsStore(state => state.apiKey);

  const urls = useWebOcrStore(state => state.urls);
  const results = useWebOcrStore(state => state.results);
  const combinedContent = useWebOcrStore(state => state.combinedContent);
  const isProcessing = useWebOcrStore(state => state.isProcessing);
  const analysisMode = useWebOcrStore(state => state.analysisMode);
  const error = useWebOcrStore(state => state.error);
  const isCopied = useWebOcrStore(state => state.isCopied);
  const setUrls = useWebOcrStore(state => state.setUrls);
  const setAnalysisMode = useWebOcrStore(state => state.setAnalysisMode);
  const processUrls = useWebOcrStore(state => state.processUrls);
  const cancelProcessing = useWebOcrStore(state => state.cancelProcessing);
  const copyUrlResults = useWebOcrStore(state => state.copyUrlResults);
  const clearResults = useWebOcrStore(state => state.clearResults);

  // Memoized values
  const hasResults = useMemo(() =>
    results.length > 0 || Boolean(combinedContent),
    [results, combinedContent]
  );

  const validUrlCount = useMemo(() =>
    urls.filter(url => url.trim()).length,
    [urls]
  );

  // Handlers
  const handleProcess = useCallback(async () => {
    if (!apiKey) return;
    await processUrls(apiKey);
  }, [apiKey, processUrls]);

  const handleClear = useCallback(() => {
    clearResults();
  }, [clearResults]);

  // audit W-07: allow the user to abort an in-flight extraction.
  const handleCancel = useCallback(() => {
    cancelProcessing();
  }, [cancelProcessing]);

  return (
    <div className={cn(
      'min-h-[calc(100vh-theme(spacing.16))]',
      editorial.bg.paper,
      'amoled:bg-black'
    )}>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Editorial Header */}
        <header className="text-center mb-8 sm:mb-12">
          {/* Status badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-stone-100 dark:bg-stone-800/50 amoled:bg-stone-900/50 border border-stone-200/50 dark:border-stone-700/50 mb-6">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                isProcessing ? "animate-pulse" : ""
              )}
              style={{ backgroundColor: '#E34234' }}
              aria-hidden="true"
            />
            <span
              className="text-xs font-medium tracking-widest uppercase text-stone-600 dark:text-stone-400"
              style={{ fontFamily: editorial.fonts.body }}
            >
              {isProcessing ? 'Transmitting' : 'Web Extraction'}
            </span>
          </div>

          {/* Main title */}
          <h1
            className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-stone-900 dark:text-stone-100 mb-4 tracking-tight"
            style={{ fontFamily: editorial.fonts.heading }}
          >
            Web <em className="font-normal">OCR</em>
          </h1>

          {/* Subtitle */}
          <p
            className="text-base sm:text-lg text-stone-500 dark:text-stone-400 max-w-xl mx-auto"
            style={{ fontFamily: editorial.fonts.body }}
          >
            Extract and analyze content from websites, images, and documents via URL
          </p>
        </header>

        {/* Main Workspace */}
        {!hasResults && validUrlCount === 0 ? (
          // Empty State
          <div className="max-w-2xl mx-auto">
            <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50">
              <PaperTexture />
              <CornerDecoration position="top-left" />
              <CornerDecoration position="top-right" />
              <CornerDecoration position="bottom-left" />
              <CornerDecoration position="bottom-right" />

              <div className="relative p-5 sm:p-8 md:p-12">
                {apiKey ? (
                  <div className="space-y-8">
                    <div className="text-center space-y-3">
                      <div
                        className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-6 shadow-lg"
                        style={{ backgroundColor: '#1C1917' }}
                      >
                        <Globe className="w-8 h-8 text-white" aria-hidden="true" />
                      </div>
                      <h2
                        className="text-xl font-semibold text-stone-900 dark:text-stone-100"
                        style={{ fontFamily: editorial.fonts.heading }}
                      >
                        Enter URLs to <em className="font-normal">analyze</em>
                      </h2>
                      <p
                        className="text-stone-500 dark:text-stone-400 max-w-sm mx-auto"
                        style={{ fontFamily: editorial.fonts.body }}
                      >
                        Paste one or more URLs to extract content. Supports web pages, images, and PDFs.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <UrlInput
                        urls={urls}
                        onUrlsChange={setUrls}
                        disabled={isProcessing}
                      />
                      <div className="flex justify-center">
                        <button
                          onClick={handleProcess}
                          disabled={isProcessing || validUrlCount === 0}
                          className={cn(
                            "inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl text-sm font-medium",
                            "transition-all duration-200",
                            "focus:outline-none focus:ring-4 focus:ring-stone-500/20",
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                            isProcessing
                              ? "bg-stone-200 dark:bg-stone-700 text-stone-500 cursor-wait"
                              : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-white shadow-lg shadow-stone-900/10 dark:shadow-stone-900/30 hover:-translate-y-0.5"
                          )}
                          style={{ fontFamily: editorial.fonts.body }}
                        >
                          {isProcessing ? (
                            <>
                              <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Globe className="w-4 h-4" aria-hidden="true" />
                              Analyze URLs
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ApiKeyPrompt variant="default" />
                )}
              </div>
            </div>
          </div>
        ) : (
          // Active Workspace - Split Pane
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr] gap-4 sm:gap-6 lg:gap-8 items-start">

            {/* Left Panel: Source URLs */}
            <div className="space-y-4 sm:space-y-6 lg:sticky lg:top-6">
              {/* Section header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-1 h-6 rounded-full"
                    style={{ backgroundColor: '#E34234' }}
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                    <h2
                      className="text-lg font-semibold text-stone-900 dark:text-stone-100"
                      style={{ fontFamily: editorial.fonts.heading }}
                    >
                      Source <em className="font-normal">URLs</em>
                    </h2>
                  </div>
                </div>
                {hasResults && (
                  <button
                    onClick={handleClear}
                    className={cn(
                      "text-sm font-medium",
                      "text-stone-500 hover:text-red-500",
                      "transition-colors duration-200"
                    )}
                    style={{ fontFamily: editorial.fonts.body }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* URL Input Card */}
              <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg">
                <PaperTexture />

                <div className="relative p-5 space-y-5">
                  <UrlInput
                    urls={urls}
                    onUrlsChange={setUrls}
                    disabled={isProcessing}
                  />

                  <div>
                    <label
                      className="text-xs font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400 mb-2 block"
                      style={{ fontFamily: editorial.fonts.body }}
                    >
                      Analysis Mode
                    </label>
                    <AnalysisModeToggle
                      mode={analysisMode}
                      onChange={setAnalysisMode}
                      disabled={isProcessing}
                    />
                  </div>

                  <button
                    onClick={handleProcess}
                    disabled={isProcessing || validUrlCount === 0}
                    className={cn(
                      "w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium",
                      "transition-all duration-200",
                      "focus:outline-none focus:ring-4 focus:ring-stone-500/20",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                      isProcessing
                        ? "bg-stone-200 dark:bg-stone-700 text-stone-500 cursor-wait"
                        : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-white shadow-lg shadow-stone-900/10 dark:shadow-stone-900/30 hover:-translate-y-0.5"
                    )}
                    style={{ fontFamily: editorial.fonts.body }}
                  >
                    {isProcessing ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Globe className="w-4 h-4" aria-hidden="true" />
                        Update Analysis
                      </>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <Alert variant="error" className="animate-fade-in">
                  {error}
                </Alert>
              )}

              {/* Pro tip */}
              <div className="relative rounded-xl overflow-hidden bg-stone-50 dark:bg-stone-800/30 amoled:bg-stone-900/30 border border-stone-200 dark:border-stone-700 p-4">
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'rgba(227, 66, 52, 0.1)' }}
                  >
                    <Sparkles className="w-4 h-4" style={{ color: '#E34234' }} aria-hidden="true" />
                  </div>
                  <div>
                    <p
                      className="font-semibold text-sm text-stone-900 dark:text-stone-100 mb-1"
                      style={{ fontFamily: editorial.fonts.heading }}
                    >
                      Editorial Tip
                    </p>
                    <p
                      className="text-xs text-stone-600 dark:text-stone-400"
                      style={{ fontFamily: editorial.fonts.body }}
                    >
                      Use "Combined" mode to merge content from multiple pages into a single summary, or "Comparison" to analyze differences.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel: Results */}
            <div className="space-y-4 sm:space-y-6">
              {/* Section header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-1 h-6 rounded-full"
                    style={{ backgroundColor: '#E34234' }}
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                    <h2
                      className="text-lg font-semibold text-stone-900 dark:text-stone-100"
                      style={{ fontFamily: editorial.fonts.heading }}
                    >
                      Wire <em className="font-normal">Feed</em>
                    </h2>
                  </div>
                </div>
                {hasResults && (
                  <button
                    onClick={copyUrlResults}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                      "bg-stone-100 dark:bg-stone-800 amoled:bg-stone-900",
                      "text-stone-600 dark:text-stone-400",
                      "hover:bg-stone-200 dark:hover:bg-stone-700",
                      "border border-stone-200 dark:border-stone-700",
                      "transition-all duration-200"
                    )}
                    style={{ fontFamily: editorial.fonts.body }}
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-4 h-4 text-green-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy All
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Results container */}
              <div className={cn(
                "relative min-h-[600px] rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg flex flex-col",
                !hasResults && "items-center justify-center text-center"
              )}>
                <PaperTexture />
                <CornerDecoration position="top-left" />
                <CornerDecoration position="top-right" />
                <CornerDecoration position="bottom-left" />
                <CornerDecoration position="bottom-right" />

                {isProcessing ? (
                  <div className="flex-1 flex items-center justify-center p-12 relative">
                    <div className="flex flex-col items-center gap-4">
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
                        style={{ backgroundColor: '#E34234' }}
                      >
                        <Loader className="w-7 h-7 text-white animate-spin" aria-hidden="true" />
                      </div>
                      <div className="text-center">
                        <p
                          className="font-semibold text-stone-900 dark:text-stone-100"
                          style={{ fontFamily: editorial.fonts.heading }}
                        >
                          Fetching {validUrlCount} source{validUrlCount !== 1 ? 's' : ''}...
                        </p>
                        <p
                          className="text-sm text-stone-500 dark:text-stone-400 mt-1"
                          style={{ fontFamily: editorial.fonts.body }}
                        >
                          Analyzing and extracting content
                        </p>
                      </div>
                      {/* audit W-07: visible cancel control while processing */}
                      <button
                        type="button"
                        onClick={handleCancel}
                        className={cn(
                          "inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium",
                          "bg-stone-100 dark:bg-stone-800 amoled:bg-stone-900",
                          "text-stone-600 dark:text-stone-300",
                          "border border-stone-200 dark:border-stone-700",
                          "hover:bg-stone-200 dark:hover:bg-stone-700",
                          "focus:outline-none focus:ring-4 focus:ring-stone-500/20",
                          "transition-all duration-200"
                        )}
                        style={{ fontFamily: editorial.fonts.body }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : hasResults ? (
                  <div className="flex-1 overflow-y-auto p-4 sm:p-6 relative">
                    {analysisMode === 'individual' && results.length > 0 ? (
                      <div className="space-y-4">
                        {results.map((result, index) => (
                          <UrlResultCard key={result.url} result={result} index={index} />
                        ))}
                      </div>
                    ) : combinedContent ? (
                      <div className="prose prose-sm prose-stone dark:prose-invert max-w-none">
                        <MarkdownRenderer content={combinedContent} />
                      </div>
                    ) : (
                      <div className="text-center text-stone-500 dark:text-stone-400 mt-20">
                        No content extracted
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 max-w-xs mx-auto p-8 relative">
                    <div
                      className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(28, 25, 23, 0.05)' }}
                    >
                      <LayoutTemplate className="w-6 h-6 text-stone-400" aria-hidden="true" />
                    </div>
                    <p
                      className="text-stone-500"
                      style={{ fontFamily: editorial.fonts.body }}
                    >
                      Dispatches will appear here after analysis
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
