import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Maximize2,
  Minimize2,
  Check,
  Copy,
  X,
  Loader2,
  Sparkles,
  FileText,
} from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { Card } from './molecules/Card';
import { logger } from '../lib/logger';
import { cn } from '../design/theme';
import { formatTablesInContent } from '../utils/tableFormatter';
import { UI_TIMING } from '../constants';

// --- Constants ---

const PROGRESS_MIN_WIDTH = 5;
const COPY_FEEDBACK_DURATION = UI_TIMING.COPY_NOTIFICATION_DURATION;

/**
 * Configurable thresholds for bounding box heuristics.
 * These values represent normalized coordinates (0-1 range):
 * - titleHeightThreshold: Minimum height ratio for title detection (2% of page)
 * - headingHeightThreshold: Minimum height ratio for heading detection (1.8% of page)
 * - topPositionThreshold: Maximum Y position for top-of-page elements (15% from top)
 */
interface BoundingBoxConfig {
  titleHeightThreshold: number;
  headingHeightThreshold: number;
  topPositionThreshold: number;
}

const DEFAULT_BBOX_CONFIG: BoundingBoxConfig = {
  titleHeightThreshold: 0.02,
  headingHeightThreshold: 0.018,
  topPositionThreshold: 0.15,
};

// --- Types ---

interface ExtractedContentTypeSection {
  heading?: string;
  content: string[] | string;
}

/**
 * Extended type that matches both the component's expected format
 * and the Gemini API's ExtractedContent format
 */
interface ExtractedContentType {
  title?: string;
  sections: ExtractedContentTypeSection[];
  // Additional fields from Gemini API ExtractedContent
  content?: string;
  headings?: string[];
  tables?: Array<{
    headers: string[];
    rows: string[][];
    content: string;
  }>;
  code?: string[];
  lists?: Array<{
    type: 'ordered' | 'unordered';
    items: string[];
  }>;
  markdown?: string;
}

type RawContent = ExtractedContentType | string | null;

interface NormalizedSection {
  id: string;
  heading?: string;
  markdown: string;
}

interface NormalizedData {
  title: string;
  plainText: string;
  sections: NormalizedSection[];
  isEmpty: boolean;
}

interface ParsedBoundingBox {
  headings: string[];
  lines: string[];
}

// --- Helpers ---

const clampProgress = (value: number): number =>
  Math.min(100, Math.max(0, value));

const normalizeMarkdownSpacing = (markdown: string): string => {
  const lines = markdown.split('\n');
  const normalized: string[] = [];
  let inCodeFence = false;
  let codeFenceMarker: string | null = null;
  let blankStreak = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const fenceMatch = trimmedLine.match(/^(```|~~~)/);

    if (fenceMatch) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = fenceMatch[1];
      } else if (codeFenceMarker && trimmedLine.startsWith(codeFenceMarker)) {
        inCodeFence = false;
        codeFenceMarker = null;
      }
      blankStreak = 0;
      normalized.push(line);
      continue;
    }

    if (inCodeFence) {
      normalized.push(line);
      continue;
    }

    if (trimmedLine === '') {
      blankStreak += 1;
      if (blankStreak <= 2) {
        normalized.push('');
      }
      continue;
    }

    blankStreak = 0;
    normalized.push(line);
  }

  return normalized.join('\n');
};

const hasText = (value?: string | null): boolean =>
  !!value && /\S/.test(value);

/**
 * Generates a stable ID for a section based on its content
 */
const generateSectionId = (index: number, heading?: string): string => {
  const headingSlug = heading
    ? heading.slice(0, 20).replace(/[^a-z0-9]/gi, '-').toLowerCase()
    : 'untitled';
  return `section-${index}-${headingSlug}`;
};

/**
 * Robust JSON parsing for Bounding Box data with validation
 */
function parseBoundingBoxJson(
  content: string,
  config: BoundingBoxConfig = DEFAULT_BBOX_CONFIG,
): ParsedBoundingBox | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('[')) return null;

  try {
    const data = JSON.parse(trimmed) as Array<{ box?: number[]; text?: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;

    const headings: string[] = [];
    const lines: string[] = [];

    for (const item of data) {
      if (!item?.box || !Array.isArray(item.box) || item.box.length < 4) continue;
      if (typeof item.text !== 'string') continue;

      const [, y, , h] = item.box;

      // Validate coordinates are in expected range
      if (y < 0 || y > 1 || h < 0 || h > 1) {
        logger.warn('Bounding box coordinates outside expected range [0, 1]');
        continue;
      }

      const text = item.text.trim();
      if (!text) continue;

      // Heuristics for headings based on height/position
      if (y < config.topPositionThreshold && h > config.titleHeightThreshold) {
        headings.push(`# ${text}`);
      } else if (h > config.headingHeightThreshold) {
        headings.push(`## ${text}`);
      } else {
        lines.push(text);
      }
    }

    if (!headings.length && !lines.length) return null;

    return { headings, lines };
  } catch (error) {
    logger.debug(
      'Content is not bounding box JSON, treating as plain text',
      error,
    );
    return null;
  }
}

/**
 * Normalizes structured object content into sections
 * Handles both the component's expected format and Gemini API's ExtractedContent format
 */
function normalizeStructuredContent(
  structured: ExtractedContentType,
): Omit<NormalizedData, 'isEmpty'> {
  const mainTitle = structured.title || 'Extracted Text';
  let fullPlainText = '';
  const normalizedSections: NormalizedSection[] = [];

  // Process sections array (main content structure)
  if (structured.sections && structured.sections.length > 0) {
    structured.sections.forEach((section, idx) => {
      const rawSectionLines = Array.isArray(section.content)
        ? section.content
        : typeof section.content === 'string'
          ? section.content.split('\n')
          : [];
      const rawSectionText = rawSectionLines.join('\n');

      try {
        const formattedLines = formatTablesInContent(rawSectionLines);
        const markdown = normalizeMarkdownSpacing(formattedLines.join('\n'));

        fullPlainText +=
          (section.heading ? `${section.heading}\n` : '') + rawSectionText + '\n\n';

        normalizedSections.push({
          id: generateSectionId(idx, section.heading),
          heading: section.heading,
          markdown,
        });
      } catch (error) {
        logger.error('Failed to format section content:', error);
        normalizedSections.push({
          id: generateSectionId(idx, section.heading),
          heading: section.heading,
          markdown: rawSectionText,
        });
      }
    });
  }

  // If we have markdown field from Gemini, prefer it for display
  if (structured.markdown && !normalizedSections.length) {
    fullPlainText = structured.content || structured.markdown;
    normalizedSections.push({
      id: 'main-markdown',
      markdown: structured.markdown,
    });
  }

  // Handle additional Gemini fields if no sections were created yet
  if (normalizedSections.length === 0) {
    // Build content from available Gemini fields
    const contentParts: string[] = [];

    // Add headings
    if (structured.headings?.length) {
      contentParts.push(structured.headings.map(h => `## ${h}`).join('\n\n'));
    }

    // Add main content
    if (structured.content) {
      contentParts.push(structured.content);
      fullPlainText += structured.content + '\n\n';
    }

    // Add tables
    if (structured.tables?.length) {
      structured.tables.forEach(table => {
        contentParts.push(table.content);
        fullPlainText += table.content + '\n\n';
      });
    }

    // Add code blocks
    if (structured.code?.length) {
      structured.code.forEach(codeBlock => {
        contentParts.push('```\n' + codeBlock + '\n```');
        fullPlainText += codeBlock + '\n\n';
      });
    }

    // Add lists
    if (structured.lists?.length) {
      structured.lists.forEach(list => {
        const listContent = list.items.map((item, i) =>
          list.type === 'ordered' ? `${i + 1}. ${item}` : `- ${item}`
        ).join('\n');
        contentParts.push(listContent);
        fullPlainText += listContent + '\n\n';
      });
    }

    if (contentParts.length > 0) {
      normalizedSections.push({
        id: 'main-content',
        markdown: normalizeMarkdownSpacing(contentParts.join('\n\n')),
      });
    }
  }

  return {
    title: mainTitle,
    plainText: fullPlainText.trim(),
    sections: normalizedSections,
  };
}

/**
 * Normalizes bounding box JSON content
 */
function normalizeBoundingBoxContent(
  boxData: ParsedBoundingBox,
): Omit<NormalizedData, 'isEmpty'> {
  try {
    const formattedBody = formatTablesInContent(boxData.lines);
    const markdown = normalizeMarkdownSpacing(
      [...boxData.headings, '', ...formattedBody].join('\n'),
    );

    return {
      title: 'Extracted Text',
      plainText: boxData.lines.join('\n'),
      sections: [{ id: 'main', markdown }],
    };
  } catch (error) {
    logger.error('Failed to format bounding box content:', error);
    return {
      title: 'Extracted Text',
      plainText: boxData.lines.join('\n'),
      sections: [{ id: 'main', markdown: boxData.lines.join('\n') }],
    };
  }
}

/**
 * Normalizes plain string content
 */
function normalizeStringContent(
  rawContent: string,
): Omit<NormalizedData, 'isEmpty'> {
  try {
    const lines = rawContent.split('\n');
    const formattedLines = formatTablesInContent(lines);
    const markdown = normalizeMarkdownSpacing(formattedLines.join('\n'));

    return {
      title: 'Extracted Text',
      plainText: rawContent,
      sections: [{ id: 'main', markdown }],
    };
  } catch (error) {
    logger.error('Failed to format string content:', error);
    return {
      title: 'Extracted Text',
      plainText: rawContent,
      sections: [{ id: 'main', markdown: rawContent }],
    };
  }
}

/**
 * Centralized processing function to normalize all input types into a single structure.
 * This runs inside useMemo to prevent expensive re-calculations on render.
 */
function normalizeContent(rawContent: RawContent, textContent?: string): NormalizedData {
  try {
    let result: Omit<NormalizedData, 'isEmpty'>;

    // 1. Handle Structured Object
    if (rawContent && typeof rawContent === 'object' && 'sections' in rawContent) {
      result = normalizeStructuredContent(rawContent);
    }
    // 2. Handle String (JSON or Raw Text)
    else if (typeof rawContent === 'string') {
      const boxData = parseBoundingBoxJson(rawContent);
      result = boxData
        ? normalizeBoundingBoxContent(boxData)
        : normalizeStringContent(rawContent);
    }
    // 3. Fallback: textContent prop
    else if (hasText(textContent)) {
      result = normalizeStringContent(textContent ?? '');
    }
    // 4. Empty state
    else {
      return {
        title: 'Extracted Text',
        plainText: '',
        sections: [],
        isEmpty: true,
      };
    }

    const trimmedPlainText = result.plainText.trim();

    return {
      ...result,
      plainText: trimmedPlainText,
      isEmpty: !trimmedPlainText && result.sections.length === 0,
    };
  } catch (error) {
    logger.error('Failed to normalize content:', error);
    return {
      title: 'Error',
      plainText: '',
      sections: [],
      isEmpty: true,
    };
  }
}

// --- UI Subcomponents ---

const LoadingState = ({
  progress,
  onCancel,
}: {
  progress: number;
  onCancel?: () => void;
}) => {
  const clampedProgress = clampProgress(progress);
  const visualWidth = Math.max(clampedProgress, PROGRESS_MIN_WIDTH);

  return (
    <Card className="backdrop-blur-sm border-stone-200 dark:border-stone-700/30">
      <div className="py-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-900 shadow-lg shadow-stone-900/25 ring-4 ring-stone-100 dark:bg-stone-100 dark:ring-stone-800/20">
            <div className="relative">
              <Loader2 className="h-6 w-6 animate-spin text-white dark:text-stone-900" />
              <Sparkles className="absolute -top-1 -right-1 h-3 w-3 animate-pulse text-white/60 dark:text-stone-900/60" />
            </div>
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-stone-900 dark:text-white">
              Processing
            </h3>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Extracting intelligence...
            </p>
          </div>
        </div>

        <div className="mx-auto mb-8 max-w-sm">
          <div className="mb-2 flex justify-between text-xs font-medium text-stone-500">
            <span id="progress-label">Progress</span>
            <span aria-hidden="true">{Math.round(clampedProgress)}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(clampedProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-labelledby="progress-label"
            aria-live="polite"
            className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-700"
          >
            <div
              className="relative h-full overflow-hidden rounded-full bg-stone-900 dark:bg-stone-100 transition-all duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${visualWidth}%` }}
            >
              <div className="absolute inset-0 animate-pulse motion-reduce:animate-none bg-white/20" />
            </div>
          </div>
          <span className="sr-only">{Math.round(clampedProgress)} percent complete</span>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-[#E34234] shadow-sm transition-all duration-200 motion-reduce:transition-none hover:border-[#E34234]/30 hover:bg-red-50 dark:border-stone-700 dark:bg-stone-800 dark:text-[#E34234] dark:hover:bg-red-900/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E34234]/50 focus-visible:ring-offset-2"
            aria-label="Cancel processing"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>
    </Card>
  );
};

const ErrorState = ({ error }: { error: string }) => (
  <Card
    role="alert"
    aria-live="assertive"
    className="bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30"
  >
    <div className="flex items-start gap-4">
      <div className="shrink-0 rounded-lg bg-red-100 p-2 dark:bg-red-900/30">
        <X className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden="true" />
      </div>
      <div>
        <h3 className="mb-1 text-base font-semibold text-red-900 dark:text-red-200">
          Extraction Failed
        </h3>
        <p className="text-sm leading-relaxed text-red-700 dark:text-red-300">
          {error}
        </p>
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          Please try again or check your file format.
        </p>
      </div>
    </div>
  </Card>
);

const EmptyState = () => (
  <Card className="border-dashed bg-stone-50/50 dark:bg-stone-800/50">
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-700">
        <FileText className="h-6 w-6 text-stone-400" />
      </div>
      <p className="font-medium text-stone-500 dark:text-stone-400">
        No content extracted.
      </p>
    </div>
  </Card>
);

// --- Main Component ---

export interface ExtractedContentProps {
  content?: RawContent;
  textContent?: string;
  isProcessing?: boolean;
  error?: string | null;
  isCopied?: boolean;
  onCopyToClipboard?: (textToCopy: string) => Promise<void>;
  progress?: number;
  onCancel?: () => void;
}

const ExtractedContent = ({
  content: rawContent,
  textContent,
  isProcessing,
  error,
  isCopied,
  onCopyToClipboard,
  progress = 0,
  onCancel,
}: ExtractedContentProps) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [internalIsCopied, setInternalIsCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const backdropMouseDownRef = useRef(false);

  // Normalize data only when inputs change
  const data = useMemo(
    () => normalizeContent(rawContent ?? null, textContent),
    [rawContent, textContent],
  );

  const handleClose = useCallback(() => {
    setIsMaximized(false);
  }, []);

  // Handle Escape key to close maximized view
  useEffect(() => {
    if (!isMaximized) return;

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isMaximized, handleClose]);

  // Handle Body Scroll Lock
  useEffect(() => {
    if (!isMaximized) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow || 'unset';
    };
  }, [isMaximized]);

  // Focus handling for maximized modal
  useEffect(() => {
    if (isMaximized) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isMaximized]);

  // Cleanup copy feedback timer
  useEffect(() => {
    if (!internalIsCopied) return;
    const timer = setTimeout(() => setInternalIsCopied(false), COPY_FEEDBACK_DURATION);
    return () => clearTimeout(timer);
  }, [internalIsCopied]);

  const handleCopy = useCallback(async () => {
    if (!hasText(data.plainText)) return;

    if (onCopyToClipboard) {
      await onCopyToClipboard(data.plainText);
      return;
    }

    try {
      await navigator.clipboard.writeText(data.plainText);
      setInternalIsCopied(true);
    } catch (error) {
      logger.error('Failed to copy:', error);
    }
  }, [data.plainText, onCopyToClipboard]);

  const handleBackdropMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    backdropMouseDownRef.current = e.target === e.currentTarget;
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (backdropMouseDownRef.current && e.target === e.currentTarget) {
      handleClose();
    }
    backdropMouseDownRef.current = false;
  }, [handleClose]);

  const actualIsCopied = isCopied ?? internalIsCopied;

  if (isProcessing) {
    return <LoadingState progress={progress} onCancel={onCancel} />;
  }

  if (error) {
    return <ErrorState error={error} />;
  }

  if (data.isEmpty) {
    return <EmptyState />;
  }

  return (
    <>
      {/* Backdrop for maximized view */}
      {isMaximized && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
          onMouseDown={handleBackdropMouseDown}
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}

      <Card
        ref={modalRef}
        tabIndex={-1}
        role={isMaximized ? 'dialog' : undefined}
        aria-modal={isMaximized ? 'true' : undefined}
        aria-labelledby="extracted-content-title"
        noPadding
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
        className={cn(
          'relative flex flex-col bg-white transition-all duration-300 ease-in-out dark:bg-stone-900',
          isMaximized
            ? 'fixed inset-2 sm:inset-4 z-50 mx-auto max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] max-w-5xl overflow-hidden shadow-2xl ring-1 ring-white/10 border-stone-500/30 md:inset-6 lg:inset-10'
            : 'w-full max-h-[70vh]',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 sm:gap-4 border-b border-stone-100 bg-white p-3 sm:p-4 md:p-6 dark:border-stone-800 dark:bg-stone-900">
          <div className="min-w-0 flex-1">
            <h3
              id="extracted-content-title"
              className="truncate text-lg font-bold text-stone-900 dark:text-white sm:text-xl"
            >
              {data.title}
            </h3>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {data.sections.length} section
              {data.sections.length !== 1 ? 's' : ''} extracted
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!hasText(data.plainText)}
              className={cn(
                'flex items-center gap-2 rounded-lg p-2 text-sm font-medium transition-all duration-200',
                !hasText(data.plainText) && 'cursor-not-allowed opacity-60',
                actualIsCopied
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-stone-50 text-stone-700 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700',
              )}
              aria-label={
                actualIsCopied
                  ? 'Content copied to clipboard'
                  : 'Copy content to clipboard'
              }
            >
              {actualIsCopied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {actualIsCopied ? 'Copied' : 'Copy'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              aria-label={
                isMaximized ? 'Minimize content view' : 'Maximize content view'
              }
            >
              {isMaximized ? (
                <Minimize2 className="h-5 w-5" />
              ) : (
                <Maximize2 className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div
          className={cn(
            'flex-1 min-h-0 space-y-6 overflow-y-auto p-4 sm:p-6',
            isMaximized && 'bg-stone-50/50 dark:bg-black/20',
          )}
        >
          {data.sections.map((section) => (
            <div
              key={section.id}
              className={cn(
                'group',
                data.sections.length > 1 &&
                  'rounded-xl border border-stone-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5 dark:border-stone-800 dark:bg-stone-800/50',
              )}
            >
              {section.heading && (
                <h4 className="mb-4 flex items-center gap-2 border-b border-stone-100 pb-2 text-base font-semibold text-stone-900 dark:border-stone-800 dark:text-white sm:text-lg">
                  <span className="h-5 w-1.5 rounded-full" style={{ backgroundColor: '#E34234' }} />
                  {section.heading}
                </h4>
              )}

              <MarkdownRenderer content={section.markdown} className="break-words" />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
};

export default ExtractedContent;
