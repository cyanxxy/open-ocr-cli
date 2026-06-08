import { FileText, Copy, Check, ChevronDown, ChevronRight, FileOutput, AlertTriangle } from 'lucide-react';
import type { ExtractedContent } from '../lib/gemini/types';
import MarkdownRenderer from './MarkdownRenderer';
import { formatTablesInContent } from '../utils/tableFormatter';

interface TrackedFile {
  id: string;
  file: File;
}

interface ProcessedResult {
  fileId: string;
  fileName: string;
  content: ExtractedContent;
}

interface BulkExtractedContentProps {
  results: ProcessedResult[];
  files: TrackedFile[];
  expandedFiles: { [key: string]: boolean };
  copiedResults: { [key: string]: boolean };
  isCopied: boolean;
  onToggleExpand: (fileId: string) => void;
  onCopyAll: () => Promise<void>;
  onCopyResult: (fileId: string) => Promise<void>;
}

export function BulkExtractedContent({
  results,
  files,
  expandedFiles,
  copiedResults,
  isCopied,
  onToggleExpand,
  onCopyAll,
  onCopyResult
}: BulkExtractedContentProps) {
  // Count total sections across all results
  const totalSections = results.reduce((acc, result) => acc + result.content.sections.length, 0);

  return (
    <div className="rounded-xl bg-white dark:bg-stone-800 amoled:bg-black border border-stone-100 dark:border-stone-700 amoled:border-stone-800 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
      <div className="border-b border-stone-100 dark:border-stone-700 amoled:border-stone-800 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-stone-100 dark:bg-stone-800/50 amoled:bg-stone-800/30 flex items-center justify-center">
              <FileOutput className="w-5 h-5 text-stone-600 dark:text-stone-400 amoled:text-stone-500" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-stone-900 dark:text-white amoled:text-stone-200">
                Extracted Content
              </h2>
              <p className="text-sm text-stone-500 dark:text-stone-400 amoled:text-stone-500">
                {results.length} file{results.length !== 1 ? 's' : ''} • {totalSections} section{totalSections !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onCopyAll}
            className={`
              inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
              transition-all duration-300 shadow-sm hover:shadow w-full sm:w-auto
              ${isCopied
                ? 'bg-green-50 dark:bg-green-900/20 amoled:bg-green-900/10 text-green-600 dark:text-green-400 amoled:text-green-500 hover:bg-green-100 dark:hover:bg-green-900/30 amoled:hover:bg-green-900/20'
                : 'bg-stone-100 dark:bg-stone-700/50 amoled:bg-stone-800/50 text-stone-700 dark:text-stone-300 amoled:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 amoled:hover:bg-stone-800'
              }
            `}
          >
            {isCopied ? (
              <>
                <Check className="w-4 h-4" aria-hidden="true" />
                Copied All Content
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" aria-hidden="true" />
                Copy All Content
              </>
            )}
          </button>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-stone-900 dark:text-white amoled:text-stone-200 mb-2">
            No content extracted
          </h3>
          <p className="text-sm text-stone-500 dark:text-stone-400 amoled:text-stone-500">
            Process your files to see extracted content here
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stone-100 dark:divide-stone-700 amoled:divide-stone-800">
          {results.map((result, index) => {
            // Find the file that matches this result by ID
            const trackedFile = files.find(f => f.id === result.fileId);
            const fileName = trackedFile?.file.name || result.fileName;
            const fileId = result.fileId;

            return (
              <div
                key={fileId}
                className="group animate-fade-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div
                  className={`
                    px-3 sm:px-5 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3
                    ${expandedFiles[fileId] ? 'bg-stone-50/50 dark:bg-stone-800/30 amoled:bg-stone-900/50' : ''}
                    hover:bg-stone-50/80 dark:hover:bg-stone-700/50 amoled:hover:bg-stone-800/50 transition-colors
                  `}
                >
                  <button
                    onClick={() => onToggleExpand(fileId)}
                    className="flex items-center gap-3 flex-1 text-left"
                    aria-expanded={expandedFiles[fileId]}
                    aria-controls={`content-${fileId}`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-stone-100 dark:bg-stone-800/50 amoled:bg-stone-800/30 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-stone-600 dark:text-stone-400 amoled:text-stone-500" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-stone-900 dark:text-white amoled:text-stone-200 truncate">
                        {fileName}
                      </h3>
                      <p className="text-xs text-stone-500 dark:text-stone-400 amoled:text-stone-500">
                        {result.content.sections.length} section{result.content.sections.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="ml-auto sm:hidden">
                      {expandedFiles[fileId] ? (
                        <ChevronDown className="w-4 h-4 text-stone-400 dark:text-stone-500 amoled:text-stone-600" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-stone-400 dark:text-stone-500 amoled:text-stone-600" aria-hidden="true" />
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 pl-0 sm:pl-0">
                    <button
                      onClick={() => onCopyResult(fileId)}
                      className={`
                        inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                        transition-all duration-200 whitespace-nowrap
                        ${copiedResults[fileId]
                          ? 'bg-green-50 dark:bg-green-900/20 amoled:bg-green-900/10 text-green-600 dark:text-green-400 amoled:text-green-500 hover:bg-green-100 dark:hover:bg-green-900/30 amoled:hover:bg-green-900/20'
                          : 'bg-stone-50 dark:bg-stone-700 amoled:bg-stone-800 text-stone-600 dark:text-stone-300 amoled:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-600 amoled:hover:bg-stone-700'
                        }
                      `}
                      aria-label={copiedResults[fileId] ? "Content copied" : "Copy content"}
                    >
                      {copiedResults[fileId] ? (
                        <>
                          <Check className="w-4 h-4" aria-hidden="true" />
                          <span className="sr-only sm:not-sr-only">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" aria-hidden="true" />
                          <span className="sr-only sm:not-sr-only">Copy</span>
                        </>
                      )}
                    </button>
                    <div className="hidden sm:block">
                      {expandedFiles[fileId] ? (
                        <ChevronDown className="w-5 h-5 text-stone-400 dark:text-stone-500 amoled:text-stone-600" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-stone-400 dark:text-stone-500 amoled:text-stone-600" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                </div>

                {expandedFiles[fileId] && (
                  <div
                    id={`content-${fileId}`}
                    className="px-3 sm:px-5 pb-4 sm:pb-6 animate-slide-down"
                  >
                    <div className="pl-0 sm:pl-12 space-y-4 sm:space-y-6 mt-2">
                      {result.content.sections.map((section, sIndex) => {
                        // Prepare content for MarkdownRenderer, applying table formatting
                        let markdownInputForRenderer = '';
                        const rawSectionLines = Array.isArray(section.content)
                          ? section.content
                          : [];
                        const hasContent = rawSectionLines.some((line) => line.trim() !== '');

                        if (hasContent) {
                          const formattedLines = formatTablesInContent(rawSectionLines);
                          markdownInputForRenderer = formattedLines.join('\n');
                        }

                        return (
                          <div
                            key={sIndex}
                            className="space-y-3 p-4 bg-white dark:bg-stone-800/80 amoled:bg-black/80 rounded-lg border border-stone-100 dark:border-stone-700 amoled:border-stone-800 shadow-sm"
                          >
                            {section.heading && (
                              <h4 className="text-sm font-medium text-stone-900 dark:text-white amoled:text-stone-200 pb-2 border-b border-stone-100 dark:border-stone-700 amoled:border-stone-800">
                                {section.heading}
                              </h4>
                            )}
                            {markdownInputForRenderer.trim() !== '' ? (
                              <MarkdownRenderer content={markdownInputForRenderer} />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
