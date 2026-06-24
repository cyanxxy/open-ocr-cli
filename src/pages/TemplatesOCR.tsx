import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  Layers3,
  ScanSearch,
} from 'lucide-react';

import { Alert } from '../components/molecules/Alert';
import { FileListItem } from '../components/molecules/FileListItem';
import { LoadingIndicator } from '../components/LoadingIndicator';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { ApiKeyPrompt } from '../components/organisms/ApiKeyPrompt';
import { FileDropzone } from '../components/organisms/FileDropzone';
import { cn, editorial } from '../design/theme';
import { useStoreCleanup } from '../hooks/useStoreCleanup';
import { listExtractionPresets } from '../lib/templates';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTemplateOcrStore } from '../store/useTemplateOcrStore';

const PRESETS = listExtractionPresets();

function triggerArtifactDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // audit T-08: defer revoke so the browser can finish fetching the blob URL.
  // Some browsers (Firefox, older Chromium) fetch the download asynchronously,
  // so an immediate revoke can yield an empty/failed download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type ArtifactView = 'markdown' | 'json' | 'csv';

export default function TemplatesOCR() {
  const apiKey = useSettingsStore((state) => state.apiKey);

  const presetId = useTemplateOcrStore((state) => state.presetId);
  const setPresetId = useTemplateOcrStore((state) => state.setPresetId);
  const result = useTemplateOcrStore((state) => state.result);
  const fileName = useTemplateOcrStore((state) => state.fileName);
  const progress = useTemplateOcrStore((state) => state.progress);
  const isProcessing = useTemplateOcrStore((state) => state.isProcessing);
  const isCopied = useTemplateOcrStore((state) => state.isCopied);
  const error = useTemplateOcrStore((state) => state.error);
  const processFile = useTemplateOcrStore((state) => state.processFile);
  const cancelExtraction = useTemplateOcrStore((state) => state.cancelExtraction);
  const reset = useTemplateOcrStore((state) => state.reset);
  const copyArtifact = useTemplateOcrStore((state) => state.copyArtifact);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [artifactView, setArtifactView] = useState<ArtifactView>('markdown');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useStoreCleanup({ cancelExtraction, reset }, 'TemplateOcrStore');

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (artifactView === 'csv' && !result?.csv) {
      setArtifactView('markdown');
    }
  }, [artifactView, result]);

  useEffect(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      setPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(selectedFile);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  }, [selectedFile]);

  const selectedPreset = useMemo(
    () => PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0],
    [presetId],
  );

  const artifactContent = useMemo(() => {
    if (!result) {
      return '';
    }

    switch (artifactView) {
      case 'json':
        return JSON.stringify(result.json, null, 2);
      case 'csv':
        return result.csv ?? '';
      default:
        return result.markdown;
    }
  }, [artifactView, result]);

  const handleFileSelection = useCallback((file: File) => {
    setSelectedFile(file);
    setArtifactView('markdown');
    reset();
  }, [reset]);

  const handleRemoveFile = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setSelectedFile(null);
    setArtifactView('markdown');
    reset();
  }, [reset]);

  const handleProcess = useCallback(async () => {
    if (!selectedFile || !apiKey) {
      return;
    }
    await processFile(selectedFile, apiKey);
  }, [apiKey, processFile, selectedFile]);

  const handleCopyArtifact = useCallback(async () => {
    await copyArtifact(artifactView);
  }, [artifactView, copyArtifact]);

  const handleDownloadArtifact = useCallback(() => {
    if (!result || !selectedFile) {
      return;
    }

    const safePreset = selectedPreset.id.replace(/[^a-z0-9-]+/gi, '-');
    const safeBase = selectedFile.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();

    if (artifactView === 'markdown') {
      triggerArtifactDownload(`${safeBase}-${safePreset}.md`, result.markdown, 'text/markdown;charset=utf-8');
      return;
    }

    if (artifactView === 'json') {
      triggerArtifactDownload(
        `${safeBase}-${safePreset}.json`,
        JSON.stringify(result.json, null, 2),
        'application/json;charset=utf-8',
      );
      return;
    }

    if (result.csv) {
      triggerArtifactDownload(`${safeBase}-${safePreset}.csv`, result.csv, 'text/csv;charset=utf-8');
    }
  }, [artifactView, result, selectedFile, selectedPreset.id]);

  const artifactTabs = useMemo(() => {
    const baseTabs: Array<{ id: ArtifactView; label: string; icon: typeof FileJson }> = [
      { id: 'markdown', label: 'Markdown', icon: ScanSearch },
      { id: 'json', label: 'JSON', icon: FileJson },
    ];

    if (result?.csv) {
      baseTabs.push({ id: 'csv', label: 'CSV', icon: FileSpreadsheet });
    }

    return baseTabs;
  }, [result?.csv]);

  if (!selectedFile) {
    return (
      <div className={cn('min-h-[calc(100vh-12rem)]', editorial.bg.paper, 'rounded-[2rem] px-4 py-8 sm:px-6')}>
        <div className="max-w-6xl mx-auto">
          <header className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-stone-100 dark:bg-stone-800/50 border border-stone-200/60 dark:border-stone-700/50 mb-6">
              <Layers3 className="w-4 h-4 text-[#E34234]" />
              <span className="text-xs font-medium tracking-[0.18em] uppercase text-stone-500 dark:text-stone-400" style={{ fontFamily: editorial.fonts.body }}>
                Structured Templates
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-stone-900 dark:text-stone-100 mb-4" style={{ fontFamily: editorial.fonts.heading }}>
              OCR that ships <em className="font-normal italic">usable data</em>
            </h1>
            <p className="max-w-3xl mx-auto text-lg text-stone-500 dark:text-stone-400 leading-relaxed" style={{ fontFamily: editorial.fonts.body }}>
              Pick a preset, upload a document, and get markdown and JSON from every run, plus tabular CSV for table presets like invoice and receipt.
            </p>
          </header>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-8">
            {PRESETS.map((preset) => {
              const isActive = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPresetId(preset.id)}
                  className={cn(
                    'rounded-3xl p-5 text-left border transition-all duration-200',
                    isActive
                      ? 'bg-white dark:bg-stone-900 border-stone-900 dark:border-stone-100 shadow-lg shadow-stone-200/40 dark:shadow-stone-950/50'
                      : 'bg-white/70 dark:bg-stone-900/70 border-stone-200/70 dark:border-stone-700/60 hover:border-stone-400 dark:hover:border-stone-500',
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-stone-900 dark:text-stone-100" style={{ fontFamily: editorial.fonts.heading }}>
                      {preset.label}
                    </span>
                    <span className={cn(
                      'px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wide uppercase',
                      preset.outputShape === 'table'
                        ? 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
                        : 'bg-[#E34234]/10 text-[#E34234]',
                    )}>
                      {preset.outputShape}
                    </span>
                  </div>
                  <p className="text-sm text-stone-600 dark:text-stone-400 mb-4" style={{ fontFamily: editorial.fonts.body }}>
                    {preset.description}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-500" style={{ fontFamily: editorial.fonts.body }}>
                    {preset.rules.length} fields
                    {preset.tableColumns?.length ? ` + ${preset.tableColumns.length} table columns` : ''}
                  </p>
                </button>
              );
            })}
          </section>

          <div className="max-w-3xl mx-auto">
            {apiKey ? (
              <FileDropzone
                onFileSelect={handleFileSelection}
                variant="default"
                showFileTypes={true}
                message={`Drop a ${selectedPreset.label.toLowerCase()} document`}
              />
            ) : (
              <ApiKeyPrompt variant="default" />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-12rem)] py-6 px-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleRemoveFile}
              disabled={isProcessing}
              className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              aria-label="Remove file and go back"
            >
              <ArrowRight className="w-5 h-5 rotate-180" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500 dark:text-stone-500 mb-2" style={{ fontFamily: editorial.fonts.body }}>
                Template Run
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold text-stone-900 dark:text-stone-100" style={{ fontFamily: editorial.fonts.heading }}>
                {selectedPreset.label} extraction
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleCopyArtifact}
              disabled={!result}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Copy className="w-4 h-4" />
              {isCopied ? 'Copied' : `Copy ${artifactView.toUpperCase()}`}
            </button>
            <button
              type="button"
              onClick={handleDownloadArtifact}
              disabled={!result}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-5">
            <div className="rounded-3xl border border-stone-200/70 dark:border-stone-700/60 bg-white dark:bg-stone-900 p-5 shadow-lg shadow-stone-200/20 dark:shadow-stone-950/30">
              <div className="flex items-center gap-2 mb-4">
                <BadgeCheck className="w-4 h-4 text-[#E34234]" />
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100" style={{ fontFamily: editorial.fonts.heading }}>
                  Preset
                </h2>
              </div>
              <div className="space-y-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPresetId(preset.id)}
                    disabled={isProcessing}
                    className={cn(
                      'w-full rounded-2xl px-4 py-3 text-left border transition-all duration-200 disabled:opacity-70',
                      preset.id === presetId
                        ? 'border-stone-900 dark:border-stone-100 bg-stone-50 dark:bg-stone-800'
                        : 'border-stone-200 dark:border-stone-700 hover:border-stone-400 dark:hover:border-stone-500',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{preset.label}</span>
                      <span className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">{preset.outputShape}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-stone-200/70 dark:border-stone-700/60 bg-white dark:bg-stone-900 p-5 shadow-lg shadow-stone-200/20 dark:shadow-stone-950/30">
              <div className="flex items-center gap-2 mb-4">
                <ScanSearch className="w-4 h-4 text-[#E34234]" />
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100" style={{ fontFamily: editorial.fonts.heading }}>
                  Source
                </h2>
              </div>

              <FileListItem
                file={selectedFile}
                isProcessed={Boolean(result && fileName === selectedFile.name)}
                isProcessing={isProcessing}
                onRemoveFile={handleRemoveFile}
                statusText={isProcessing ? `${Math.round(progress * 100)}%` : undefined}
              />

              {previewUrl && (
                <div className="mt-4 rounded-2xl overflow-hidden border border-stone-200/70 dark:border-stone-700/60 bg-stone-50 dark:bg-stone-800/50">
                  <img src={previewUrl} alt={selectedFile.name} className="w-full h-auto object-cover" />
                </div>
              )}

              <button
                type="button"
                onClick={isProcessing ? cancelExtraction : handleProcess}
                className={cn(
                  'mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-medium transition-all duration-200',
                  isProcessing
                    ? 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200'
                    : 'bg-[#E34234] hover:bg-[#C9352A] text-white shadow-lg shadow-[#E34234]/20',
                )}
              >
                {isProcessing ? <LoadingIndicator size="sm" text="" /> : <BadgeCheck className="w-4 h-4" />}
                {isProcessing ? 'Cancel extraction' : `Run ${selectedPreset.label} preset`}
              </button>
            </div>

            {error && (
              <Alert variant="error">
                {error}
              </Alert>
            )}
          </aside>

          <section className="rounded-[2rem] border border-stone-200/70 dark:border-stone-700/60 bg-white dark:bg-stone-900 shadow-xl shadow-stone-200/20 dark:shadow-stone-950/30 overflow-hidden">
            <div className="border-b border-stone-200/70 dark:border-stone-700/60 px-5 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500 dark:text-stone-500 mb-2" style={{ fontFamily: editorial.fonts.body }}>
                  Output artifacts
                </p>
                <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100" style={{ fontFamily: editorial.fonts.heading }}>
                  Markdown and JSON from one run, plus CSV for table presets
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {artifactTabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setArtifactView(id)}
                    className={cn(
                      'inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-medium transition-all duration-200',
                      artifactView === id
                        ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                        : 'bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5 min-h-[480px]">
              {!result ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center mb-5">
                    <FileJson className="w-6 h-6 text-[#E34234]" />
                  </div>
                  <h3 className="text-xl font-semibold text-stone-900 dark:text-stone-100 mb-3" style={{ fontFamily: editorial.fonts.heading }}>
                    No preset run yet
                  </h3>
                  <p className="max-w-md text-stone-500 dark:text-stone-400" style={{ fontFamily: editorial.fonts.body }}>
                    Run the {selectedPreset.label.toLowerCase()} preset to generate structured artifacts you can copy, download, and evaluate.
                  </p>
                </div>
              ) : artifactView === 'markdown' ? (
                <MarkdownRenderer content={artifactContent} />
              ) : (
                <pre className="overflow-auto rounded-2xl bg-stone-950 text-stone-100 p-4 text-sm leading-6 whitespace-pre-wrap break-words">
                  {artifactContent}
                </pre>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
