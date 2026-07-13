import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  ArrowRight,
  X,
  FileText,
  Scan,
  Check,
  PenTool
} from 'lucide-react';

// --- State Management & Hooks ---
import { useOcrStore } from '../store/useOcrStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useStoreCleanup } from '../hooks/useStoreCleanup';

// --- Components ---
import { Toggle } from '../components/atoms/Toggle';
import { FileDropzone } from '../components/organisms/FileDropzone';
import { ApiKeyPrompt } from '../components/organisms/ApiKeyPrompt';
import ExtractedContent from '../components/ExtractedContent';

// --- Theme ---
import { cn } from '../design/theme';
import { isNonPreviewableImage, generateUuid } from '../lib/fileUtils';

/**
 * SimpleOCR - Editorial Scanner Design
 * A sophisticated, newspaper-inspired OCR interface with
 * dramatic typography and elegant interactions
 */
export default function SimpleOCR() {
  // Store hooks
  const apiKey = useSettingsStore(state => state.apiKey);
  const handwritingMode = useSettingsStore(state => state.handwritingMode);
  const setHandwritingMode = useSettingsStore(state => state.setHandwritingMode);

  const extractedContent = useOcrStore(state => state.extractedContent);
  const isProcessing = useOcrStore(state => state.isProcessing);
  const fileName = useOcrStore(state => state.fileName);
  const error = useOcrStore(state => state.error);
  const progress = useOcrStore(state => state.progress);
  const isCopied = useOcrStore(state => state.isCopied);
  const processFile = useOcrStore(state => state.processFile);
  const cancelExtraction = useOcrStore(state => state.cancelExtraction);
  const reset = useOcrStore(state => state.reset);
  const copyToClipboard = useOcrStore(state => state.copyToClipboard);

  // Local state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileIdRef = useRef<string>('');

  // Cleanup on unmount
  useStoreCleanup({ cancelExtraction, reset }, 'OcrStore');

  // Track latest previewUrl in a ref for cleanup without stale closures
  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;

  // Revoke blob URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  // Assign a collision-proof identity per File instance. name+size+lastModified
  // is not unique (two distinct files can share all three), so we attach a
  // crypto-random token to each File object via a WeakMap; re-deriving for the
  // SAME File instance returns the same id, while two distinct files always get
  // different ids (audit U-02).
  const fileIdMapRef = useRef<WeakMap<File, string>>(new WeakMap());
  const generateFileId = useCallback((file: File): string => {
    const existing = fileIdMapRef.current.get(file);
    if (existing) return existing;
    const id = `${file.name}-${file.size}-${file.lastModified}-${generateUuid()}`;
    fileIdMapRef.current.set(file, id);
    return id;
  }, []);

  const isFileProcessed = useMemo(() => {
    if (!selectedFile || !extractedContent || !fileName) return false;
    return fileName === selectedFile.name && fileIdRef.current === generateFileId(selectedFile);
  }, [selectedFile, extractedContent, fileName, generateFileId]);

  const handleFileSelection = useCallback((file: File) => {
    // Revoke previous preview URL to prevent blob URL memory leak
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    const newFileId = generateFileId(file);
    fileIdRef.current = newFileId;
    setSelectedFile(file);
    reset();

    // Create preview for images the browser can actually render. HEIC/HEIF
    // upload fine to the API but cannot be displayed via <img> on most
    // browsers, so we skip the preview to avoid a broken-image icon (audit B-09).
    if (file.type.startsWith('image/') && !isNonPreviewableImage(file)) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }, [generateFileId, reset]);

  const handleRemoveFile = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    fileIdRef.current = '';
    reset();
  }, [reset, previewUrl]);

  const handleProcessFile = useCallback(async () => {
    if (!selectedFile || !apiKey) return;
    try {
      await processFile(selectedFile, apiKey, handwritingMode);
    } catch {
      // Error handled by store
    }
  }, [selectedFile, apiKey, handwritingMode, processFile]);

  const handleCancel = useCallback(() => {
    cancelExtraction();
  }, [cancelExtraction]);

  const handleCopy = useCallback(async (textToCopy: string) => {
    await copyToClipboard(textToCopy);
  }, [copyToClipboard]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Empty State - No file selected
  if (!selectedFile) {
    return (
      <div className="min-h-[calc(100vh-12rem)] flex flex-col">
        {/* Editorial Header */}
        <header className="text-center pt-8 pb-12 px-4">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-stone-100 dark:bg-stone-800/50 border border-stone-200/60 dark:border-stone-700/50">
            <div className="w-2 h-2 rounded-full bg-vermillion animate-pulse" style={{ backgroundColor: '#E34234' }} />
            <span className="text-xs font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400" style={{ fontFamily: "'Source Sans 3', sans-serif" }}>
              Powered by Gemini 3
            </span>
          </div>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-stone-900 dark:text-stone-100 mb-4"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            Simple <em className="font-normal italic">OCR</em>
          </h1>

          <p
            className="text-lg sm:text-xl text-stone-500 dark:text-stone-400 max-w-2xl mx-auto leading-relaxed"
            style={{ fontFamily: "'Source Sans 3', sans-serif" }}
          >
            Transform images and documents into editable text with precision AI.
            Simply drop your file to begin.
          </p>
        </header>

        {/* Main Drop Area */}
        <div className="flex-1 flex items-center justify-center px-4 pb-12">
          <div className="w-full max-w-3xl">
            {apiKey ? (
              <FileDropzone
                onFileSelect={handleFileSelection}
                variant="default"
                showFileTypes={true}
                message="Drop Your Document"
                className="editorial-dropzone"
              />
            ) : (
              <ApiKeyPrompt variant="default" />
            )}

            {/* Handwriting Mode Toggle */}
            {apiKey && (
              <div className="mt-8 flex justify-center">
                <div
                  className="inline-flex items-center gap-4 px-6 py-3 rounded-full bg-stone-100/80 dark:bg-stone-800/50 border border-stone-200/60 dark:border-stone-700/50"
                >
                  <div className="flex items-center gap-2">
                    <PenTool className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                    <span
                      className="text-sm font-medium text-stone-600 dark:text-stone-400"
                      style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                    >
                      Handwriting Mode
                    </span>
                  </div>
                  <Toggle
                    checked={handwritingMode}
                    onChange={setHandwritingMode}
                    size="sm"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active State - File selected
  return (
    <div className="min-h-[calc(100vh-12rem)] py-6 px-4">
      {/* Compact Header */}
      <header className="max-w-7xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleRemoveFile}
              disabled={isProcessing}
              className={cn(
                "p-2.5 rounded-xl transition-all duration-200",
                "bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700",
                "text-stone-600 dark:text-stone-400",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              aria-label="Remove file and go back"
            >
              <ArrowRight className="w-5 h-5 rotate-180" />
            </button>
            <div>
              <h1
                className="text-2xl sm:text-3xl font-semibold text-stone-900 dark:text-stone-100"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                {/* Heading reflects the actual processing state instead of always
                    reading "Scanning..." (audit U-04). */}
                {isProcessing ? (
                  <>
                    Scanning<span className="text-stone-400">...</span>
                  </>
                ) : isFileProcessed ? (
                  'Extraction Complete'
                ) : (
                  'Ready to Extract'
                )}
              </h1>
            </div>
          </div>

          {/* Handwriting Toggle */}
          <div
            className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-full bg-stone-100/80 dark:bg-stone-800/50 border border-stone-200/60 dark:border-stone-700/50"
          >
            <PenTool className="w-4 h-4 text-stone-500 dark:text-stone-400" />
            <span
              className="text-sm text-stone-600 dark:text-stone-400"
              style={{ fontFamily: "'Source Sans 3', sans-serif" }}
            >
              Handwriting
            </span>
            <Toggle
              checked={handwritingMode}
              onChange={setHandwritingMode}
              size="sm"
            />
          </div>
        </div>
      </header>

      {/* Two Column Layout */}
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-[380px_1fr] xl:grid-cols-[420px_1fr] gap-6 lg:gap-8">

          {/* Left Column - Source Document */}
          <div className="lg:sticky lg:top-6 lg:self-start space-y-4">
            {/* Document Card */}
            <div
              className={cn(
                "relative overflow-hidden rounded-2xl",
                "bg-gradient-to-br from-stone-50 to-stone-100",
                "dark:from-stone-900 dark:to-stone-800",
                "border border-stone-200/60 dark:border-stone-700/50",
                "shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50"
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200/60 dark:border-stone-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-stone-200 dark:bg-stone-700 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-stone-600 dark:text-stone-400" />
                  </div>
                  <div className="min-w-0">
                    <p
                      className="font-medium text-stone-900 dark:text-stone-100 truncate max-w-[180px] sm:max-w-[220px]"
                      style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                    >
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleRemoveFile}
                  disabled={isProcessing}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    "hover:bg-red-50 dark:hover:bg-red-900/20",
                    "text-stone-400 hover:text-red-500 dark:hover:text-red-400",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  aria-label={`Remove ${selectedFile.name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Preview */}
              <div className="p-4">
                <div className="aspect-[4/3] rounded-xl overflow-hidden bg-stone-200/50 dark:bg-stone-800/50 flex items-center justify-center">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`Preview of ${selectedFile.name}`}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="text-center p-8">
                      <FileText className="w-16 h-16 text-stone-300 dark:text-stone-600 mx-auto mb-4" />
                      <p
                        className="text-sm text-stone-500 dark:text-stone-400"
                        style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                      >
                        {/* HEIC/HEIF cannot be previewed in-browser (audit B-09). */}
                        {selectedFile.type === 'application/pdf'
                          ? 'PDF Document'
                          : 'Preview unavailable'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div className="px-4 pb-4">
                {!isFileProcessed && !isProcessing && (
                  <button
                    onClick={handleProcessFile}
                    className={cn(
                      "w-full py-4 rounded-xl font-medium text-base",
                      "bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white",
                      "text-white dark:text-stone-900",
                      "shadow-lg shadow-stone-900/20 dark:shadow-stone-900/40",
                      "transition-all duration-200 hover:-translate-y-0.5",
                      "flex items-center justify-center gap-3"
                    )}
                    style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                  >
                    <Scan className="w-5 h-5" />
                    Extract Text
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                {isProcessing && (
                  <button
                    onClick={handleCancel}
                    className={cn(
                      "w-full py-4 rounded-xl font-medium text-base",
                      "bg-red-500 hover:bg-red-600",
                      "text-white",
                      "shadow-lg shadow-red-500/20",
                      "transition-all duration-200",
                      "flex items-center justify-center gap-3"
                    )}
                    style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                  >
                    <X className="w-5 h-5" />
                    Cancel Extraction
                  </button>
                )}

                {isFileProcessed && !isProcessing && (
                  <div
                    className={cn(
                      "w-full py-4 rounded-xl font-medium text-base",
                      "bg-emerald-50 dark:bg-emerald-900/20",
                      "text-emerald-700 dark:text-emerald-400",
                      "border border-emerald-200 dark:border-emerald-800",
                      "flex items-center justify-center gap-2"
                    )}
                    style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                  >
                    <Check className="w-5 h-5" />
                    Extraction Complete
                  </div>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && !isProcessing && (
              <div
                className={cn(
                  "p-4 rounded-xl",
                  "bg-red-50 dark:bg-red-900/20",
                  "border border-red-200 dark:border-red-800"
                )}
              >
                <p
                  className="text-sm text-red-700 dark:text-red-400"
                  style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                >
                  {error}
                </p>
              </div>
            )}
          </div>

          {/* Right Column - Results */}
          <div className="min-h-[600px]">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-1.5 h-8 rounded-full"
                  style={{ backgroundColor: '#E34234' }}
                />
                <h2
                  className="text-xl font-semibold text-stone-900 dark:text-stone-100"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                >
                  Extracted Content
                </h2>
              </div>

              {isFileProcessed && (
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                    style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                  >
                    Ready
                  </span>
                </div>
              )}
            </div>

            {/* Content Container */}
            <div
              className={cn(
                "rounded-2xl overflow-hidden",
                "bg-white dark:bg-stone-900",
                "border border-stone-200/60 dark:border-stone-700/50",
                "shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50",
                "min-h-[500px]"
              )}
            >
              <ExtractedContent
                content={extractedContent}
                isProcessing={isProcessing}
                error={error}
                progress={progress * 100}
                isCopied={isCopied}
                onCopyToClipboard={handleCopy}
                onCancel={handleCancel}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
