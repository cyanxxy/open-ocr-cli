import type React from 'react';
import { useCallback, useState } from 'react';
import { Loader, ChevronDown, Cpu, Sliders, FileUp, Sparkles, X, RotateCcw, Square, Newspaper, ScrollText } from 'lucide-react';

import { useSettingsStore } from '../store/useSettingsStore';
import { useAgenticOcrStore } from '../store/useAgenticOcrStore';
import { logger } from '../lib/logger';
import { Alert } from '../components/molecules/Alert';
import { FileListItem } from '../components/molecules/FileListItem';
import { FileDropzone } from '../components/organisms/FileDropzone';
import { ApiKeyPrompt } from '../components/organisms/ApiKeyPrompt';
import ExtractedContent from '../components/ExtractedContent';
import { cn, editorial } from '../design/theme';
import { FILE_CONSTRAINTS } from '../constants';

import { useImageUpload } from '../hooks/useImageUpload';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { useAgenticOcrResults } from '../hooks/useAgenticOcrResults';
import { useStoreCleanup } from '../hooks/useStoreCleanup';

const PaperTexture = () => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.015] dark:opacity-[0.03] pointer-events-none" aria-hidden="true">
    <filter id="paper-noise-agent">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#paper-noise-agent)" />
  </svg>
);

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

/**
 * Agent configuration component - Editorial styled
 */
const AgentConfig: React.FC<{
  config: { maxIterations: number; confidenceThreshold: number };
  onChange: (updates: Partial<{ maxIterations: number; confidenceThreshold: number }>) => void;
}> = ({ config, onChange }) => (
  <div className="space-y-6">
    <div>
      <label
        htmlFor="max-iterations-slider"
        className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-3"
        style={{ fontFamily: editorial.fonts.body }}
      >
        Max Iterations:{' '}
        <span style={{ color: '#E34234' }} className="font-semibold">{config.maxIterations}</span>
      </label>
      <input
        id="max-iterations-slider"
        type="range"
        min="1"
        max="10"
        value={config.maxIterations}
        onChange={(e) => onChange({ maxIterations: Number(e.target.value) })}
        aria-valuemin={1}
        aria-valuemax={10}
        aria-valuenow={config.maxIterations}
        aria-valuetext={`${config.maxIterations} iterations`}
        className="w-full h-2 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer accent-stone-900 dark:accent-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50 focus-visible:ring-offset-2"
      />
      <div
        className="flex justify-between text-xs text-stone-500 dark:text-stone-400 mt-2 font-medium"
        style={{ fontFamily: editorial.fonts.body }}
        aria-hidden="true"
      >
        <span>1</span>
        <span>10</span>
      </div>
    </div>

    <div>
      <label
        htmlFor="confidence-slider"
        className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-3"
        style={{ fontFamily: editorial.fonts.body }}
      >
        Confidence Threshold:{' '}
        <span style={{ color: '#E34234' }} className="font-semibold">{config.confidenceThreshold.toFixed(1)}</span>
      </label>
      <input
        id="confidence-slider"
        type="range"
        min="0.5"
        max="1"
        step="0.1"
        value={config.confidenceThreshold}
        onChange={(e) => onChange({ confidenceThreshold: Number(e.target.value) })}
        aria-valuemin={0.5}
        aria-valuemax={1}
        aria-valuenow={config.confidenceThreshold}
        aria-valuetext={`${(config.confidenceThreshold * 100).toFixed(0)}% confidence`}
        className="w-full h-2 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer accent-stone-900 dark:accent-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50 focus-visible:ring-offset-2"
      />
      <div
        className="flex justify-between text-xs text-stone-500 dark:text-stone-400 mt-2 font-medium"
        style={{ fontFamily: editorial.fonts.body }}
        aria-hidden="true"
      >
        <span>0.5</span>
        <span>1.0</span>
      </div>
    </div>

    <div
      className="p-4 rounded-xl bg-stone-50 dark:bg-stone-800/50 amoled:bg-stone-900/50 border border-stone-200 dark:border-stone-700 text-xs text-stone-600 dark:text-stone-400 space-y-2"
      style={{ fontFamily: editorial.fonts.body }}
    >
      <p className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#E34234' }} aria-hidden="true" />
        <strong>Max Iterations:</strong> Attempts to improve results
      </p>
      <p className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#E34234' }} aria-hidden="true" />
        <strong>Confidence Threshold:</strong> Target accuracy level
      </p>
    </div>
  </div>
);

/**
 * Main AgenticOCR component - Editorial "Digital Correspondent" theme
 */
export default function AgenticOCR() {
  // Use selectors to prevent unnecessary re-renders
  const apiKey = useSettingsStore(state => state.apiKey);

  const status = useAgenticOcrStore(state => state.status);
  const currentStep = useAgenticOcrStore(state => state.currentStep);
  const currentIteration = useAgenticOcrStore(state => state.currentIteration);
  const extractedFields = useAgenticOcrStore(state => state.extractedFields);
  const logs = useAgenticOcrStore(state => state.logs);
  const progress = useAgenticOcrStore(state => state.progress);
  const agentError = useAgenticOcrStore(state => state.error);
  const isProcessing = useAgenticOcrStore(state => state.isProcessing);
  const config = useAgenticOcrStore(state => state.config);
  const startAgent = useAgenticOcrStore(state => state.startAgent);
  const stopAgent = useAgenticOcrStore(state => state.stopAgent);
  const resetAgent = useAgenticOcrStore(state => state.reset);
  const updateConfig = useAgenticOcrStore(state => state.updateConfig);

  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const [showAgentConfig, setShowAgentConfig] = useState(false);

  const {
    file: selectedFile,
    imageData,
    error: uploadError,
    handleDrop,
    reset: resetImageUpload
  } = useImageUpload();

  const { formattedContent, textContent, hasResults } = useAgenticOcrResults({
    extractedFields,
    currentIteration,
    progress,
    status
  });

  useStoreCleanup({
    stopAgent,
    resetAgent
  }, 'AgenticOcrStore');

  const isFileProcessed = status === 'completed' || (status === 'stopped' && hasResults);
  const canStartAgent = !!(apiKey && selectedFile && imageData && !isProcessing);
  const isActivelyRunning = status === 'initializing' || status === 'processing';
  const statusDisplay = {
    idle: { badge: 'AI Agent', title: 'Ready' },
    initializing: { badge: 'Initializing', title: 'Initializing Agent' },
    processing: { badge: 'Processing', title: 'Correspondent Working...' },
    completed: { badge: 'Completed', title: 'Dispatch Complete' },
    stopped: { badge: 'Stopped', title: 'Processing Halted' },
    error: { badge: 'Error', title: 'Processing Error' },
  } as const;
  const fileStatusText = {
    idle: 'Pending',
    initializing: 'Initializing',
    processing: 'Processing',
    completed: 'Processed',
    stopped: hasResults ? 'Stopped with results' : 'Stopped',
    error: 'Error',
  }[status];

  const toggleAgentConfig = useCallback(() => {
    setShowAgentConfig(prev => !prev);
  }, []);

  const handleStartAgent = useCallback(async () => {
    if (!canStartAgent || !selectedFile || !imageData) {
      return;
    }

    try {
      await startAgent(selectedFile, imageData, {
        maxIterations: config.maxIterations,
        confidenceThreshold: config.confidenceThreshold,
      });
    } catch (error) {
      logger.error('Failed to start agent:', error);
    }
  }, [canStartAgent, selectedFile, imageData, startAgent, config]);

  const handleStopAgent = useCallback(() => {
    stopAgent();
  }, [stopAgent]);

  const handleResetOrRemove = useCallback(() => {
    resetImageUpload();
    resetAgent();
  }, [resetImageUpload, resetAgent]);

  const handleConfigChange = useCallback((updates: Partial<typeof config>) => {
    updateConfig(updates);
  }, [updateConfig]);

  // If no API key, show prompt
  if (!apiKey) {
    return (
      <div className={cn(
        'min-h-[calc(100vh-theme(spacing.16))]',
        editorial.bg.paper,
        'amoled:bg-black'
      )}>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
          <ApiKeyPrompt variant="default" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'min-h-[calc(100vh-theme(spacing.16))]',
      editorial.bg.paper,
      'amoled:bg-black'
    )}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Editorial Header */}
        <header className="text-center mb-8 sm:mb-12">
          {/* Status badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-stone-100 dark:bg-stone-800/50 amoled:bg-stone-900/50 border border-stone-200/50 dark:border-stone-700/50 mb-6">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                isActivelyRunning ? "animate-pulse" : ""
              )}
              style={{ backgroundColor: '#E34234' }}
              aria-hidden="true"
            />
            <span
              className="text-xs font-medium tracking-widest uppercase text-stone-600 dark:text-stone-400"
              style={{ fontFamily: editorial.fonts.body }}
            >
              {statusDisplay[status].badge}
            </span>
          </div>

          {/* Main title */}
          <h1
            className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-stone-900 dark:text-stone-100 mb-4 tracking-tight"
            style={{ fontFamily: editorial.fonts.heading }}
          >
            Agentic <em className="font-normal">OCR</em>
          </h1>

          {/* Subtitle */}
          <p
            className="text-base sm:text-lg text-stone-500 dark:text-stone-400 max-w-xl mx-auto"
            style={{ fontFamily: editorial.fonts.body }}
          >
            Autonomous AI analyzes and extracts document data iteratively
          </p>
        </header>

        {/* Main Card */}
        <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50">
          <PaperTexture />
          <CornerDecoration position="top-left" />
          <CornerDecoration position="top-right" />
          <CornerDecoration position="bottom-left" />
          <CornerDecoration position="bottom-right" />

          <div className="relative p-6 sm:p-8 space-y-8">

            {/* File upload section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-1 h-6 rounded-full"
                    style={{ backgroundColor: '#E34234' }}
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-2">
                    <FileUp className="w-4 h-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                    <h2
                      className="text-lg font-semibold text-stone-900 dark:text-stone-100"
                      style={{ fontFamily: editorial.fonts.heading }}
                    >
                      Upload Document
                    </h2>
                  </div>
                </div>
                {selectedFile && (
                  <button
                    onClick={handleResetOrRemove}
                    className={cn(
                      "text-sm font-medium flex items-center gap-1",
                      "text-stone-500 hover:text-red-500",
                      "transition-colors duration-200"
                    )}
                    style={{ fontFamily: editorial.fonts.body }}
                  >
                    <X className="w-4 h-4" /> Remove
                  </button>
                )}
              </div>

              {!selectedFile ? (
                <FileDropzone
                  onFileSelect={(file) => handleDrop([file])}
                  accept={FILE_CONSTRAINTS.ACCEPTED_MIME_TYPES}
                  maxSize={FILE_CONSTRAINTS.MAX_SIZE}
                  error={uploadError}
                />
              ) : (
                <div className="animate-scale-in">
                  <FileListItem
                    file={selectedFile}
                    isProcessed={isFileProcessed}
                    isProcessing={isActivelyRunning}
                    statusText={fileStatusText}
                    onRemoveFile={handleResetOrRemove}
                  />
                </div>
              )}
            </section>

            {/* Agent configuration toggle */}
            <section className="rounded-xl border border-stone-200 dark:border-stone-700 amoled:border-stone-800 overflow-hidden">
              <button
                type="button"
                onClick={toggleAgentConfig}
                aria-expanded={showAgentConfig}
                aria-controls="agent-config-panel"
                className={cn(
                  "w-full flex items-center justify-between px-5 py-4",
                  "bg-stone-50/50 dark:bg-stone-800/30 amoled:bg-stone-900/30",
                  "hover:bg-stone-100 dark:hover:bg-stone-800/50",
                  "transition-colors duration-200",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50 focus-visible:ring-inset"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-stone-100 dark:bg-stone-700 flex items-center justify-center">
                    <Sliders className="w-4 h-4 text-stone-600 dark:text-stone-300" aria-hidden="true" />
                  </div>
                  <div className="text-left">
                    <span
                      className="block text-sm font-semibold text-stone-900 dark:text-stone-100"
                      style={{ fontFamily: editorial.fonts.heading }}
                    >
                      Editorial Guidelines
                    </span>
                    <span
                      className="block text-xs text-stone-500 dark:text-stone-400"
                      style={{ fontFamily: editorial.fonts.body }}
                    >
                      Adjust agent behavior and precision
                    </span>
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-stone-400 transition-transform duration-300",
                    showAgentConfig ? 'rotate-180' : ''
                  )}
                  aria-hidden="true"
                />
              </button>

              {showAgentConfig && (
                <div
                  id="agent-config-panel"
                  className="p-5 bg-white dark:bg-stone-900/50 amoled:bg-stone-950/50 border-t border-stone-200 dark:border-stone-700 animate-slide-up motion-reduce:animate-none"
                >
                  <AgentConfig
                    config={config}
                    onChange={handleConfigChange}
                  />
                </div>
              )}
            </section>

            {/* Agent control buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              {!isProcessing ? (
                <button
                  onClick={handleStartAgent}
                  disabled={!canStartAgent}
                  className={cn(
                    "flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium",
                    "transition-all duration-200",
                    "focus:outline-none focus:ring-4 focus:ring-stone-500/20",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    canStartAgent
                      ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-white shadow-lg shadow-stone-900/10 dark:shadow-stone-900/30 hover:-translate-y-0.5"
                      : "bg-stone-200 dark:bg-stone-700 text-stone-500"
                  )}
                  style={{ fontFamily: editorial.fonts.body }}
                >
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  Start Processing
                </button>
              ) : (
                <button
                  onClick={handleStopAgent}
                  className={cn(
                    "flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium",
                    "transition-all duration-200",
                    "focus:outline-none focus:ring-4 focus:ring-red-500/20",
                    "bg-[#E34234] hover:bg-[#C9352A] text-white shadow-lg shadow-[#E34234]/20"
                  )}
                  style={{ fontFamily: editorial.fonts.body }}
                >
                  <Square className="w-4 h-4" aria-hidden="true" />
                  Stop Agent
                </button>
              )}

              {(selectedFile || hasResults) && !isProcessing && (
                <button
                  onClick={handleResetOrRemove}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium",
                    "bg-stone-100 dark:bg-stone-800 amoled:bg-stone-900",
                    "text-stone-600 dark:text-stone-400",
                    "hover:bg-stone-200 dark:hover:bg-stone-700",
                    "border border-stone-200 dark:border-stone-700",
                    "transition-all duration-200",
                    "focus:outline-none focus:ring-2 focus:ring-stone-500/20"
                  )}
                  style={{ fontFamily: editorial.fonts.body }}
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  Reset
                </button>
              )}
            </div>

            {/* Agent status display */}
            {status !== 'idle' && (
              <section className="space-y-4 animate-fade-in">
                <div className="p-5 rounded-xl bg-stone-50 dark:bg-stone-800/30 amoled:bg-stone-900/30 border border-stone-200 dark:border-stone-700">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="relative">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center shadow-lg"
                        style={{ backgroundColor: isActivelyRunning ? '#E34234' : '#1C1917' }}
                      >
                        {isActivelyRunning ? (
                          <Loader className="w-5 h-5 text-white animate-spin" aria-hidden="true" />
                        ) : (
                          <Cpu className="w-5 h-5 text-white" aria-hidden="true" />
                        )}
                      </div>
                      {isActivelyRunning && (
                        <span
                          className="absolute -top-1 -right-1 w-3 h-3 border-2 border-white dark:border-stone-900 rounded-full animate-pulse"
                          style={{ backgroundColor: '#22C55E' }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p
                          className="text-sm font-semibold text-stone-900 dark:text-stone-100"
                          style={{ fontFamily: editorial.fonts.heading }}
                        >
                          {statusDisplay[status].title}
                        </p>
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{
                            backgroundColor: 'rgba(227, 66, 52, 0.1)',
                            color: '#E34234',
                            fontFamily: editorial.fonts.body
                          }}
                        >
                          {Math.round(progress)}%
                        </span>
                      </div>
                      <p
                        className="text-xs text-stone-600 dark:text-stone-400"
                        style={{ fontFamily: editorial.fonts.body }}
                      >
                        {currentStep}
                        {currentIteration > 0 && ` • Iteration ${currentIteration}/${config.maxIterations}`}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-stone-200 dark:bg-stone-700 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out relative"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: '#E34234',
                        boxShadow: '0 0 8px rgba(227, 66, 52, 0.4)'
                      }}
                    >
                      <div className="absolute inset-0 bg-white/30 animate-[shimmer_2s_infinite]" />
                    </div>
                  </div>

                  {/* Error display */}
                  {agentError && (
                    <Alert variant="error" className="mt-4">
                      {agentError}
                    </Alert>
                  )}
                </div>

                {/* Agent logs - "Dispatch Feed" */}
                {logs.length > 0 && (
                  <div className="rounded-xl border border-stone-200 dark:border-stone-700 overflow-hidden">
                    <div className="px-4 py-3 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ScrollText className="w-4 h-4 text-stone-500" aria-hidden="true" />
                        <h4
                          className="text-xs font-semibold text-stone-700 dark:text-stone-300 uppercase tracking-wider"
                          style={{ fontFamily: editorial.fonts.body }}
                        >
                          Dispatch Feed
                        </h4>
                      </div>
                      <span
                        className="text-[10px] text-stone-500 bg-stone-200 dark:bg-stone-700 px-2 py-0.5 rounded-full"
                        style={{ fontFamily: editorial.fonts.body }}
                      >
                        {logs.length} events
                      </span>
                    </div>
                    <div className="p-3 space-y-2 max-h-40 overflow-y-auto bg-white dark:bg-stone-900/50">
                      {logs.slice().reverse().slice(0, 10).map((log) => (
                        <div key={log.id} className="flex gap-2 text-xs animate-fade-in">
                          <span
                            className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor:
                                log.type === 'error' ? '#EF4444' :
                                log.type === 'warning' ? '#F59E0B' :
                                '#E34234'
                            }}
                            aria-hidden="true"
                          />
                          <span
                            className="text-stone-600 dark:text-stone-400 font-mono leading-relaxed"
                            style={{ fontFamily: "'ui-monospace', 'SFMono-Regular', 'Menlo', monospace" }}
                          >
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* Results Section */}
        {(hasResults || status === 'initializing' || status === 'processing' || status === 'completed' || status === 'stopped' || status === 'error') && (
          <section className="mt-8 sm:mt-10">
            {/* Section header */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-1 h-6 rounded-full"
                style={{ backgroundColor: '#E34234' }}
                aria-hidden="true"
              />
              <div className="flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                <h2
                  className="text-xl font-semibold text-stone-900 dark:text-stone-100"
                  style={{ fontFamily: editorial.fonts.heading }}
                >
                  Filed <em className="font-normal">Report</em>
                </h2>
              </div>
            </div>

            {/* Results card */}
            <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50">
              <PaperTexture />
              <CornerDecoration position="top-left" />
              <CornerDecoration position="top-right" />
              <CornerDecoration position="bottom-left" />
              <CornerDecoration position="bottom-right" />

              <div className="relative">
                <ExtractedContent
                  content={formattedContent}
                  textContent={textContent}
                  isProcessing={isProcessing}
                  error={agentError}
                  isCopied={isCopied}
                  onCopyToClipboard={async (text: string) => { await copyToClipboard(text); }}
                  progress={progress}
                  onCancel={stopAgent}
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
