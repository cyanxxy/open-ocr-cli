import { Loader2, FileSearch } from 'lucide-react';

interface BulkProcessingControlsProps {
  filesCount: number;
  isProcessing: boolean;
  onProcess: () => void;
}

export function BulkProcessingControls({
  filesCount,
  isProcessing,
  onProcess
}: BulkProcessingControlsProps) {
  if (filesCount === 0) {
    return null;
  }

  return (
    <button
      onClick={onProcess}
      disabled={isProcessing || filesCount === 0}
      className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
        transition-all duration-300 shadow-sm hover:shadow-md
        ${isProcessing
          ? 'bg-stone-100 dark:bg-stone-800/50 amoled:bg-stone-800/30 text-stone-500 dark:text-stone-400 amoled:text-stone-500 cursor-not-allowed'
          : filesCount === 0
            ? 'bg-stone-100 dark:bg-stone-700 amoled:bg-stone-800 text-stone-400 dark:text-stone-500 amoled:text-stone-600 cursor-not-allowed'
            : 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200'
        }
      `}
      aria-busy={isProcessing}
    >
      {isProcessing ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Processing...</span>
        </>
      ) : (
        <>
          <FileSearch className="w-4 h-4" aria-hidden="true" />
          <span>Process {filesCount} File{filesCount !== 1 ? 's' : ''}</span>
        </>
      )}
    </button>
  );
}
