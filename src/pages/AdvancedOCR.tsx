import { useState, useCallback } from 'react';
import { AlertCircle, Loader, Archive, Layers, Sparkles } from 'lucide-react';

import { useSettingsStore } from '../store/useSettingsStore';
import { useAdvancedOcrStore } from '../store/useAdvancedOcrStore';
import { useStoreCleanup } from '../hooks/useStoreCleanup';
import { Alert } from '../components/molecules/Alert';
import { ApiKeyPrompt } from '../components/organisms/ApiKeyPrompt';
import { FileDropzone } from '../components/organisms/FileDropzone';
import { BulkExtractedContent } from '../components/BulkExtractedContent';
import { BulkFileList } from '../components/organisms/BulkFileList';
import { cn, editorial } from '../design/theme';
import { FILE_CONSTRAINTS } from '../constants';

// Type for the component's local state - uses file ID as key for stable tracking
interface ExpandedState {
  [fileId: string]: boolean;
}

// Constants
const MAX_FILE_SIZE_BYTES = FILE_CONSTRAINTS.MAX_SIZE;
const ACCEPTED_FILE_TYPES = FILE_CONSTRAINTS.ACCEPTED_MIME_TYPES;

const PaperTexture = () => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.015] dark:opacity-[0.03] pointer-events-none" aria-hidden="true">
    <filter id="paper-noise-bulk">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#paper-noise-bulk)" />
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

export default function AdvancedOCR() {
  // --- Store Hooks ---
  const apiKey = useSettingsStore(state => state.apiKey);

  const files = useAdvancedOcrStore(s => s.files);
  const processedResults = useAdvancedOcrStore(s => s.processedResults);
  const isProcessing = useAdvancedOcrStore(s => s.isProcessing);
  const error = useAdvancedOcrStore(s => s.error);
  const progress = useAdvancedOcrStore(s => s.progress);
  const isCopied = useAdvancedOcrStore(s => s.isCopied);
  const copiedResults = useAdvancedOcrStore(s => s.copiedResults);
  const addFiles = useAdvancedOcrStore(s => s.addFiles);
  const removeFile = useAdvancedOcrStore(s => s.removeFile);
  const cancelProcessing = useAdvancedOcrStore(s => s.cancelProcessing);
  const processStoreFiles = useAdvancedOcrStore(s => s.processFiles);
  const copyAllToClipboardStore = useAdvancedOcrStore(s => s.copyToClipboard);
  const copySingleResultToClipboardStore = useAdvancedOcrStore(s => s.copyResultToClipboard);
  const resetAdvancedOcrStore = useAdvancedOcrStore(s => s.reset);

  // Store cleanup on unmount
  useStoreCleanup({ cancelProcessing, reset: resetAdvancedOcrStore }, 'AdvancedOcrStore');

  // --- Local State ---
  const [expandedFiles, setExpandedFiles] = useState<ExpandedState>({});

  // --- Derived State ---
  const hasApiKey = !!apiKey;
  const hasFiles = files.length > 0;
  const hasProcessedResults = processedResults.length > 0;

  // --- Event Handlers & Callbacks ---
  const toggleExpand = useCallback((fileId: string) => {
    setExpandedFiles(prev => ({
      ...prev,
      [fileId]: !prev[fileId],
    }));
  }, []);

  const handleFileSelect = useCallback(async (acceptedDropFiles: File[]) => {
    if (!hasApiKey || acceptedDropFiles.length === 0) return;
    await addFiles(acceptedDropFiles);
  }, [hasApiKey, addFiles]);

  const handleProcessFiles = useCallback(async () => {
    if (!hasFiles || isProcessing) return;
    await processStoreFiles();
  }, [hasFiles, isProcessing, processStoreFiles]);

  const handleClearAllFiles = useCallback(() => {
    resetAdvancedOcrStore();
    setExpandedFiles({});
  }, [resetAdvancedOcrStore]);

  // --- Render Logic ---
  return (
    <div className={cn(
      'min-h-[calc(100vh-theme(spacing.16))]',
      editorial.bg.paper,
      'amoled:bg-black'
    )}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Editorial Header */}
        <header className="text-center mb-8 sm:mb-12">
          {/* Status badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-stone-100 dark:bg-stone-800/50 amoled:bg-stone-900/50 border border-stone-200/50 dark:border-stone-700/50 mb-6">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: '#E34234' }}
              aria-hidden="true"
            />
            <span
              className="text-xs font-medium tracking-widest uppercase text-stone-600 dark:text-stone-400"
              style={{ fontFamily: editorial.fonts.body }}
            >
              Batch Processing
            </span>
          </div>

          {/* Main title */}
          <h1
            className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-stone-900 dark:text-stone-100 mb-4 tracking-tight"
            style={{ fontFamily: editorial.fonts.heading }}
          >
            Document <em className="font-normal">Archive</em>
          </h1>

          {/* Subtitle */}
          <p
            className="text-base sm:text-lg text-stone-500 dark:text-stone-400 max-w-xl mx-auto"
            style={{ fontFamily: editorial.fonts.body }}
          >
            Upload multiple documents for intelligent batch extraction
          </p>
        </header>

        {/* API Key Warning */}
        {!hasApiKey && (
          <div className="mb-8">
            <Alert variant="warning" icon={AlertCircle}>
              <div>
                <h3
                  className="text-sm font-semibold mb-1 text-stone-900 dark:text-stone-100"
                  style={{ fontFamily: editorial.fonts.body }}
                >
                  API Key Required
                </h3>
                <p
                  className="text-xs text-stone-600 dark:text-stone-400"
                  style={{ fontFamily: editorial.fonts.body }}
                >
                  Please add your Gemini API key in settings to start using the bulk OCR tool.
                </p>
              </div>
            </Alert>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">

          {/* Left Column - File Upload & List */}
          <div className="lg:col-span-2 space-y-6">

            {/* Upload Section */}
            <section className="relative">
              {/* Section header with vermillion accent */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-1 h-6 rounded-full"
                  style={{ backgroundColor: '#E34234' }}
                  aria-hidden="true"
                />
                <div className="flex items-center gap-2">
                  <Archive className="w-4 h-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                  <h2
                    className="text-lg font-semibold text-stone-900 dark:text-stone-100"
                    style={{ fontFamily: editorial.fonts.heading }}
                  >
                    Upload Documents
                  </h2>
                </div>
              </div>

              {/* Upload card with paper texture */}
              <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50">
                <PaperTexture />
                <CornerDecoration position="top-left" />
                <CornerDecoration position="top-right" />
                <CornerDecoration position="bottom-left" />
                <CornerDecoration position="bottom-right" />

                <div className="relative p-6">
                  {hasApiKey ? (
                    <FileDropzone
                      onFilesSelect={handleFileSelect}
                      variant="bulk"
                      accept={ACCEPTED_FILE_TYPES}
                      maxSize={MAX_FILE_SIZE_BYTES}
                      disabled={!hasApiKey}
                    />
                  ) : (
                    <ApiKeyPrompt variant="compact" />
                  )}
                </div>
              </div>
            </section>

            {/* File List Section */}
            {hasFiles && (
              <section className="relative">
                {/* Section header */}
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-1 h-6 rounded-full"
                    style={{ backgroundColor: '#E34234' }}
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                    <h2
                      className="text-lg font-semibold text-stone-900 dark:text-stone-100"
                      style={{ fontFamily: editorial.fonts.heading }}
                    >
                      Document Queue
                    </h2>
                    <span
                      className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400"
                      style={{ fontFamily: editorial.fonts.body }}
                    >
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                </div>

                {/* File list card */}
                <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50">
                  <PaperTexture />

                  <div className="relative p-4 sm:p-6">
                    <BulkFileList
                      files={files}
                      expandedFiles={expandedFiles}
                      processedResults={processedResults}
                      isProcessing={isProcessing}
                      onRemoveFile={removeFile}
                      onToggleExpand={toggleExpand}
                    />
                  </div>

                  {/* Footer with actions */}
                  <div className="relative border-t border-stone-200/60 dark:border-stone-700/50 bg-stone-50/50 dark:bg-stone-800/30 amoled:bg-stone-900/50 px-4 sm:px-6 py-4">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                      <button
                        onClick={handleClearAllFiles}
                        disabled={isProcessing}
                        className={cn(
                          "px-4 py-2.5 rounded-xl text-sm font-medium",
                          "bg-stone-100 dark:bg-stone-800 amoled:bg-stone-900",
                          "text-stone-600 dark:text-stone-400",
                          "hover:bg-stone-200 dark:hover:bg-stone-700 amoled:hover:bg-stone-800",
                          "border border-stone-200 dark:border-stone-700 amoled:border-stone-800",
                          "transition-all duration-200",
                          "focus:outline-none focus:ring-2 focus:ring-stone-500/20",
                          isProcessing && "opacity-50 cursor-not-allowed"
                        )}
                        style={{ fontFamily: editorial.fonts.body }}
                      >
                        Clear All
                      </button>

                      <button
                        onClick={handleProcessFiles}
                        disabled={isProcessing || !hasFiles}
                        className={cn(
                          "inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium",
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
                            <Sparkles className="w-4 h-4" aria-hidden="true" />
                            Process {files.length} {files.length === 1 ? 'Document' : 'Documents'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Right Column - Status & Info */}
          <div className="space-y-6">

            {/* Processing Status */}
            {isProcessing && (
              <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg">
                <PaperTexture />

                <div className="relative p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: '#E34234' }}
                    >
                      <Loader className="w-5 h-5 text-white animate-spin" aria-hidden="true" />
                    </div>
                    <div>
                      <h3
                        className="text-sm font-semibold text-stone-900 dark:text-stone-100"
                        style={{ fontFamily: editorial.fonts.heading }}
                      >
                        Processing Archive
                      </h3>
                      <p
                        className="text-xs text-stone-500 dark:text-stone-400"
                        style={{ fontFamily: editorial.fonts.body }}
                      >
                        Processing {processedResults.length} of {files.length} files
                      </p>
                    </div>
                  </div>

                  {/* Progress indicator */}
                  <div className="relative h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.max((progress || 0) * 100, 5)}%`,
                        backgroundColor: '#E34234',
                        boxShadow: '0 0 8px rgba(227, 66, 52, 0.4)'
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && !isProcessing && (
              <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-red-200/60 dark:border-red-700/30 shadow-lg">
                <div className="p-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-5 h-5 text-red-500" aria-hidden="true" />
                    </div>
                    <div>
                      <h3
                        className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-1"
                        style={{ fontFamily: editorial.fonts.heading }}
                      >
                        Processing Error
                      </h3>
                      <p
                        className="text-xs text-stone-600 dark:text-stone-400"
                        style={{ fontFamily: editorial.fonts.body }}
                      >
                        {error}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Info Panel - shown when idle and no files */}
            {!isProcessing && !hasFiles && hasApiKey && (
              <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg">
                <PaperTexture />
                <CornerDecoration position="top-left" />
                <CornerDecoration position="top-right" />

                <div className="relative p-6">
                  <h3
                    className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-3"
                    style={{ fontFamily: editorial.fonts.heading }}
                  >
                    How it <em className="font-normal">works</em>
                  </h3>

                  <ul
                    className="space-y-3 text-sm text-stone-600 dark:text-stone-400"
                    style={{ fontFamily: editorial.fonts.body }}
                  >
                    <li className="flex items-start gap-3">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 mt-0.5"
                        style={{ backgroundColor: '#E34234' }}
                      >
                        1
                      </span>
                      <span>Upload multiple images or PDFs at once</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 mt-0.5"
                        style={{ backgroundColor: '#E34234' }}
                      >
                        2
                      </span>
                      <span>AI processes each document automatically</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 mt-0.5"
                        style={{ backgroundColor: '#E34234' }}
                      >
                        3
                      </span>
                      <span>Review and copy extracted text individually or all at once</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Extracted Content Section */}
        {hasProcessedResults && (
          <section className="mt-8 sm:mt-12">
            {/* Section header */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-1 h-6 rounded-full"
                style={{ backgroundColor: '#E34234' }}
                aria-hidden="true"
              />
              <h2
                className="text-xl font-semibold text-stone-900 dark:text-stone-100"
                style={{ fontFamily: editorial.fonts.heading }}
              >
                Extracted <em className="font-normal">Content</em>
              </h2>
            </div>

            {/* Results card */}
            <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-900 amoled:bg-stone-950 border border-stone-200/60 dark:border-stone-700/50 amoled:border-stone-800 shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50">
              <PaperTexture />
              <CornerDecoration position="top-left" />
              <CornerDecoration position="top-right" />
              <CornerDecoration position="bottom-left" />
              <CornerDecoration position="bottom-right" />

              <div className="relative">
                <BulkExtractedContent
                  results={processedResults}
                  files={files}
                  expandedFiles={expandedFiles}
                  copiedResults={copiedResults}
                  isCopied={isCopied}
                  onToggleExpand={toggleExpand}
                  onCopyAll={copyAllToClipboardStore}
                  onCopyResult={copySingleResultToClipboardStore}
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
