import { FileListItem } from '../molecules/FileListItem';
import type { ExtractedContent } from '../../lib/gemini/types';

interface TrackedFile {
  id: string;
  file: File;
}

/** Outcome of processing a single bulk file (audit H-09). */
type ProcessedResultStatus = 'success' | 'failed' | 'cancelled' | 'partial';

interface ProcessedResult {
  fileId: string;
  fileName: string;
  content: ExtractedContent;
  status: ProcessedResultStatus;
  error?: string;
}

interface BulkFileListProps {
  files: TrackedFile[];
  expandedFiles: { [key: string]: boolean };
  processedResults: ProcessedResult[];
  isProcessing?: boolean;
  onRemoveFile: (fileId: string) => void;
  onToggleExpand: (fileId: string) => void;
}

export function BulkFileList({
  files,
  expandedFiles,
  processedResults,
  isProcessing,
  onRemoveFile,
  onToggleExpand
}: BulkFileListProps) {
  // Look up the result (if any) for a file so failed/cancelled items render
  // distinctly from successful ones rather than all showing a green check
  // (audit H-09).
  const resultForFile = (fileId: string): ProcessedResult | undefined => {
    return processedResults.find(result => result.fileId === fileId);
  };

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-stone-300 dark:scrollbar-thumb-stone-600 amoled:scrollbar-thumb-stone-700 scrollbar-track-transparent">
      {files.map((trackedFile) => {
        const result = resultForFile(trackedFile.id);
        const isSuccess = result?.status === 'success';
        // Only a genuine success counts as "processed" (green check + expandable).
        const isProcessed = isSuccess;
        // Surface a distinct status for failed/cancelled outcomes.
        const statusText =
          result && !isSuccess
            ? result.status === 'cancelled'
              ? 'Cancelled'
              : 'Failed'
            : undefined;

        return (
          <FileListItem
            key={trackedFile.id}
            file={trackedFile.file}
            isProcessed={isProcessed}
            isProcessing={isProcessing}
            isExpanded={expandedFiles[trackedFile.id]}
            statusText={statusText}
            onRemoveFile={() => onRemoveFile(trackedFile.id)}
            onToggleExpand={() => onToggleExpand(trackedFile.id)}
          />
        );
      })}
    </div>
  );
}
