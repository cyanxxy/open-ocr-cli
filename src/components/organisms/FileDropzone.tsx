import type { FC } from 'react';
import { useCallback, useMemo } from 'react';
import type { DropzoneOptions } from 'react-dropzone';
import { useDropzone } from 'react-dropzone';
import type { LucideIcon } from 'lucide-react';
import { UploadCloud, Image as ImageIcon, FileStack, Sparkles, AlertCircle, Layers } from 'lucide-react';
import { cn } from '../../design/theme';
import { FILE_CONSTRAINTS } from '../../constants';

// --- Constants ---

const DEFAULT_ACCEPT: Record<string, string[]> = FILE_CONSTRAINTS.ACCEPTED_MIME_TYPES;

const DEFAULT_MAX_SIZE = FILE_CONSTRAINTS.MAX_SIZE;

// --- Style Configuration ---

interface VariantStyle {
  container: string;
  active: string;
  idle: string;
  iconWrapper?: string;
  iconSize: string;
  textSize?: string;
  subTextSize?: string;
}

const VARIANT_STYLES: Record<VariantType, VariantStyle> = {
  minimal: {
    container: 'p-3 sm:p-4 rounded-xl',
    active: 'border-stone-500 bg-stone-50 dark:bg-stone-800/20',
    idle: 'border-stone-300 dark:border-stone-700 bg-transparent hover:bg-stone-50 dark:hover:bg-stone-800',
    iconSize: 'w-4 h-4 sm:w-5 sm:h-5'
  },
  compact: {
    container: 'p-4 sm:p-6 rounded-2xl',
    active: 'border-stone-500 bg-stone-50 dark:bg-stone-800/20',
    idle: 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 hover:border-stone-400 dark:hover:border-stone-600 hover:bg-white dark:hover:bg-stone-800',
    iconWrapper: 'w-10 h-10 sm:w-12 sm:h-12 mb-3 sm:mb-4',
    iconSize: 'w-5 h-5 sm:w-6 sm:h-6',
    textSize: 'text-sm sm:text-base',
    subTextSize: 'text-xs'
  },
  default: {
    container: 'py-10 px-5 sm:py-14 sm:px-8 md:py-16 md:px-10 rounded-2xl sm:rounded-3xl',
    active: 'border-stone-400 dark:border-stone-500 scale-[1.01] shadow-2xl shadow-stone-300/50 dark:shadow-stone-900/80',
    idle: 'border-stone-300/60 dark:border-stone-700/60 hover:border-stone-400 dark:hover:border-stone-600 shadow-lg sm:shadow-xl shadow-stone-200/40 dark:shadow-stone-900/60 hover:shadow-2xl',
    iconWrapper: 'w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 mb-5 sm:mb-6 md:mb-8',
    iconSize: 'w-6 h-6 sm:w-7 sm:h-7 md:w-9 md:h-9',
    textSize: 'text-xl sm:text-2xl md:text-3xl',
    subTextSize: 'text-sm sm:text-base'
  },
  bulk: {
    container: 'p-6 sm:p-8 md:p-10 rounded-2xl sm:rounded-3xl',
    active: 'border-stone-500 bg-stone-50 dark:bg-stone-800/20 scale-[1.01]',
    idle: 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 hover:border-stone-400 dark:hover:border-stone-600 hover:bg-white dark:hover:bg-stone-800',
    iconWrapper: 'w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 mb-4 sm:mb-5 md:mb-6',
    iconSize: 'w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8',
    textSize: 'text-lg sm:text-xl',
    subTextSize: 'text-xs sm:text-sm'
  }
};

// Paper texture SVG for editorial dropzone
const PAPER_TEXTURE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`;

// --- Types ---

type VariantType = 'default' | 'compact' | 'minimal' | 'bulk';
type ColorType = 'stone' | 'purple' | 'vermillion';

export interface FileDropzoneProps {
  /** Callback function when a file is selected */
  onFileSelect?: (file: File) => void;
  /** Callback function when multiple files are selected (for bulk mode) */
  onFilesSelect?: (files: File[]) => void;
  /** Accepted file types */
  accept?: Record<string, string[]>;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Whether the dropzone is disabled */
  disabled?: boolean;
  /** Custom message to display */
  message?: string;
  /** Whether to show file type hints */
  showFileTypes?: boolean;
  /** Optional CSS class */
  className?: string;
  /** Dropzone variant */
  variant?: VariantType;
  /** Error message to display */
  error?: string | null;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(0))} ${sizes[i]}`;
};

const acceptsFileType = (accept: Record<string, string[]>, type: 'image' | 'pdf'): boolean => {
  return Object.keys(accept).some(k => k.includes(type));
};

const ErrorMessage: FC<{ message: string }> = ({ message }) => (
  <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
    <span className="text-sm font-medium text-red-700 dark:text-red-300">
      {message}
    </span>
  </div>
);

const FileTypeBadge: FC<{ icon: LucideIcon; label: string; color: Extract<ColorType, 'stone' | 'purple'> }> = ({
  icon: Icon,
  label,
  color
}) => {
  const colorClass = color === 'stone' ? 'text-stone-600 dark:text-stone-400' : 'text-purple-500';

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs font-medium text-stone-600 dark:text-stone-300">
      <Icon className={cn('w-3.5 h-3.5', colorClass)} />
      <span>{label}</span>
    </div>
  );
};

const FeatureBadge: FC<{ icon: LucideIcon; label: string; color: Extract<ColorType, 'stone' | 'vermillion'> }> = ({
  icon: Icon,
  label,
  color
}) => {
  const colorStyles = color === 'stone'
    ? 'bg-stone-100 dark:bg-stone-800/50 text-stone-700 dark:text-stone-300'
    : 'bg-[#E34234]/10 dark:bg-[#E34234]/20 text-[#E34234] dark:text-[#E34234]';

  return (
    <div className={cn('mt-8 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold', colorStyles)}>
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
};

// --- Main Component ---

/**
 * FileDropzone component - Drag and drop area for file uploads
 * Fully type-safe with theme integration and variant support
 */
export const FileDropzone: FC<FileDropzoneProps> = ({
  onFileSelect,
  onFilesSelect,
  accept = DEFAULT_ACCEPT,
  maxSize = DEFAULT_MAX_SIZE,
  disabled = false,
  message,
  showFileTypes = true,
  className,
  variant = 'default',
  error
}) => {
  const isBulkMode = variant === 'bulk' || !!onFilesSelect;

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    if (isBulkMode && onFilesSelect) {
      onFilesSelect(acceptedFiles);
    } else if (onFileSelect) {
      onFileSelect(acceptedFiles[0]);
    }
  }, [onFileSelect, onFilesSelect, isBulkMode]);

  const dropzoneOptions: DropzoneOptions = {
    onDrop,
    accept,
    maxFiles: isBulkMode ? undefined : 1,
    maxSize,
    disabled,
    multiple: isBulkMode
  };

  const { getRootProps, getInputProps, isDragActive, isDragReject, fileRejections } = useDropzone(dropzoneOptions);

  // Get style configuration for current variant
  const styles = VARIANT_STYLES[variant];
  const isError = isDragReject || !!error || fileRejections.length > 0;

  // Memoize container classes based on state
  const containerClasses = useMemo(() => {
    return cn(
      'relative overflow-hidden cursor-pointer transition-all duration-200 ease-in-out motion-reduce:transition-none',
      'border-2 border-dashed',
      styles.container,
      disabled && 'opacity-50 cursor-not-allowed',
      !disabled && (
        isDragActive && !isDragReject
          ? styles.active
          : isError
          ? 'border-red-500 bg-red-50 dark:bg-red-900/10'
          : styles.idle
      ),
      (variant === 'bulk' || variant === 'default') && 'group',
      // Focus visible ring for keyboard accessibility
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50 focus-visible:ring-offset-2'
    );
  }, [styles, disabled, isDragActive, isDragReject, isError, variant]);

  // Memoize error message calculation - show all rejections
  const errorMessage = useMemo(() => {
    if (error) return error;
    if (fileRejections.length === 0) return null;

    // Collect unique error messages from all rejections
    const errorMessages = new Set<string>();
    fileRejections.forEach(({ file, errors }) => {
      errors.forEach((err) => {
        if (err.code === 'file-too-large') {
          errorMessages.add(`${file.name}: File size must be less than ${formatFileSize(maxSize)}`);
        } else if (err.code === 'file-invalid-type') {
          errorMessages.add(`${file.name}: File type not supported`);
        } else {
          errorMessages.add(`${file.name}: ${err.message || 'File rejected'}`);
        }
      });
    });

    // Return first 3 errors to avoid overwhelming the user
    const errorArray = Array.from(errorMessages).slice(0, 3);
    if (fileRejections.length > 3) {
      errorArray.push(`...and ${fileRejections.length - 3} more`);
    }
    return errorArray.join('. ');
  }, [error, fileRejections, maxSize]);

  // Render minimal variant
  if (variant === 'minimal') {
    return (
      <div className={className}>
        <div {...getRootProps()} className={containerClasses}>
          <input {...getInputProps()} />
          <div className="flex items-center gap-3 justify-center">
            <UploadCloud className={cn(styles.iconSize, 'text-stone-500 dark:text-stone-400')} />
            <span className="text-sm font-medium text-stone-600 dark:text-stone-300">
              {isDragActive ? 'Drop file here' : message || 'Click or drop file'}
            </span>
          </div>
        </div>
        {errorMessage && <ErrorMessage message={errorMessage} />}
      </div>
    );
  }

  // Render standard variants (compact, default, bulk)
  const iconWrapperClasses = cn(
    styles.iconWrapper,
    'rounded-2xl flex items-center justify-center transition-all duration-500 shadow-lg',
    'bg-stone-900 text-white shadow-stone-900/20 dark:bg-stone-100 dark:text-stone-900 dark:shadow-none',
    isDragActive ? 'scale-110 rotate-3' : 'group-hover:scale-110'
  );

  // Check if this is an editorial dropzone (has specific class)
  const isEditorial = className?.includes('editorial-dropzone');

  return (
    <div className={cn(className, isEditorial && 'editorial-dropzone')}>
      <div {...getRootProps()} className={cn(
        containerClasses,
        isEditorial && 'bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 dark:from-stone-900 dark:via-stone-800 dark:to-stone-900'
      )}>
        <input {...getInputProps()} />

        {/* Paper Texture Overlay for Editorial variant */}
        {isEditorial && (
          <div
            className="absolute inset-0 rounded-3xl pointer-events-none"
            style={{
              backgroundImage: PAPER_TEXTURE,
              backgroundBlendMode: 'soft-light',
              opacity: 0.4
            }}
          />
        )}

        {/* Corner Decorations for Editorial variant */}
        {isEditorial && (
          <>
            <div className="absolute top-3 left-3 sm:top-6 sm:left-6 w-5 h-5 sm:w-8 sm:h-8 border-l-2 border-t-2 border-stone-300 dark:border-stone-700 rounded-tl-lg pointer-events-none" />
            <div className="absolute top-3 right-3 sm:top-6 sm:right-6 w-5 h-5 sm:w-8 sm:h-8 border-r-2 border-t-2 border-stone-300 dark:border-stone-700 rounded-tr-lg pointer-events-none" />
            <div className="absolute bottom-3 left-3 sm:bottom-6 sm:left-6 w-5 h-5 sm:w-8 sm:h-8 border-l-2 border-b-2 border-stone-300 dark:border-stone-700 rounded-bl-lg pointer-events-none" />
            <div className="absolute bottom-3 right-3 sm:bottom-6 sm:right-6 w-5 h-5 sm:w-8 sm:h-8 border-r-2 border-b-2 border-stone-300 dark:border-stone-700 rounded-br-lg pointer-events-none" />
          </>
        )}

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Icon */}
          <div className={iconWrapperClasses}>
            <UploadCloud className={cn(
              styles.iconSize,
              'transition-transform duration-500',
              isDragActive && '-translate-y-1'
            )} strokeWidth={1.5} />
          </div>

          {/* Main Text */}
          <h3
            className={cn(
              styles.textSize,
              'font-medium mb-3 text-stone-800 dark:text-stone-200'
            )}
            style={isEditorial ? { fontFamily: "'Playfair Display', Georgia, serif" } : undefined}
          >
            {isDragActive && !isDragReject
              ? (isBulkMode ? 'Drop your files here' : 'Release to Upload')
              : isDragReject
              ? 'File type not supported'
              : message || (isBulkMode ? 'Upload Multiple Documents' : 'Upload your file')}
          </h3>

          {/* Sub Text */}
          <p
            className={cn(styles.subTextSize, 'text-stone-500 dark:text-stone-400 max-w-xs mx-auto mb-4 sm:mb-6 md:mb-8')}
            style={isEditorial ? { fontFamily: "'Source Sans 3', sans-serif" } : undefined}
          >
            {isDragActive ? 'Release to upload' : 'or click anywhere to browse files'}
          </p>

          {/* File Type Badges - Enhanced for editorial */}
          {showFileTypes && !isDragReject && (
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {isEditorial ? (
                // Editorial file type pills
                ['PNG', 'JPG', 'WEBP', 'PDF'].map((type) => (
                  <span
                    key={type}
                    className="px-2.5 py-1 sm:px-4 sm:py-1.5 text-[10px] sm:text-xs font-medium tracking-wide rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-700"
                    style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                  >
                    {type}
                  </span>
                ))
              ) : (
                // Standard file type badges
                <>
                  {acceptsFileType(accept, 'image') && (
                    <FileTypeBadge icon={ImageIcon} label="Images" color="stone" />
                  )}
                  {acceptsFileType(accept, 'pdf') && (
                    <FileTypeBadge icon={FileStack} label="PDFs" color="purple" />
                  )}
                </>
              )}
            </div>
          )}

          {/* Feature Badges */}
          {variant === 'default' && !isDragActive && !isEditorial && (
            <FeatureBadge icon={Sparkles} label="AI-Powered Processing" color="stone" />
          )}

          {variant === 'bulk' && !isDragActive && (
            <div className="mt-6">
              <FeatureBadge icon={Layers} label="Batch Processing Supported" color="stone" />
            </div>
          )}
        </div>
      </div>

      {errorMessage && <ErrorMessage message={errorMessage} />}
    </div>
  );
};

export default FileDropzone;