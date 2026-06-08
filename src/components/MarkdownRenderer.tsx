import type { FC, ComponentProps } from 'react';
import { memo } from 'react';
import { Streamdown, type ControlsConfig } from 'streamdown';
import { FileX2 } from 'lucide-react';
import { cn } from '../design/theme';
import 'katex/dist/katex.min.css';

// --- Constants ---

const SHIKI_THEME: NonNullable<ComponentProps<typeof Streamdown>['shikiTheme']> = ['github-light', 'github-dark'];

const STREAMDOWN_CONTROLS: ControlsConfig = {
  code: true,
  table: true,
  mermaid: {
    download: true,
    copy: true,
    fullscreen: true,
    panZoom: true,
  },
};

const BASE_PROSE_STYLES = cn(
  // Base Layout
  'prose prose-sm md:prose-base dark:prose-invert max-w-none w-full',

  // Headings
  'prose-headings:font-semibold prose-headings:text-stone-900 dark:prose-headings:text-stone-100',
  'prose-h1:text-xl md:prose-h1:text-2xl',
  'prose-h2:text-lg md:prose-h2:text-xl',
  'prose-h3:text-base md:prose-h3:text-lg',

  // Paragraphs & Text
  'prose-p:text-stone-700 dark:prose-p:text-stone-300',
  'prose-p:leading-relaxed',
  'prose-strong:text-stone-900 dark:prose-strong:text-stone-100 prose-strong:font-semibold',

  // Links
  'prose-a:text-[#E34234] dark:prose-a:text-[#E34234] prose-a:break-words prose-a:no-underline hover:prose-a:underline',

  // Inline code & code blocks
  'prose-code:text-xs md:prose-code:text-sm prose-code:font-mono prose-code:px-1 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:bg-stone-50 dark:prose-pre:bg-stone-900/50 prose-pre:border prose-pre:border-stone-200 dark:prose-pre:border-stone-800 prose-pre:rounded-xl prose-pre:overflow-x-auto prose-pre:whitespace-pre',

  // Lists
  'prose-ul:my-4 prose-ol:my-4',
  'prose-li:my-1 prose-li:text-stone-700 dark:prose-li:text-stone-300',

  // Tables
  'prose-table:text-xs md:prose-table:text-sm prose-table:my-6 prose-table:w-full prose-table:border-collapse',
  'prose-th:bg-stone-50 dark:prose-th:bg-stone-800/50 prose-th:p-3',
  'prose-td:p-3',

  // Images
  'prose-img:rounded-xl prose-img:shadow-sm prose-img:border prose-img:border-stone-200 dark:prose-img:border-stone-800'
);

const getProseClassName = (className?: string) => cn(BASE_PROSE_STYLES, className);

// --- Types ---

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Whether content is actively streaming (enables streaming optimizations) */
  isStreaming?: boolean;
}

// --- Helpers ---

const isEmptyContent = (value?: string) => !value || !/\S/.test(value);

// --- Components ---

const EmptyContent: FC<{ className?: string }> = ({ className }) => (
  <div
    className={cn(
      'flex items-center gap-2 text-stone-400 dark:text-stone-500 italic text-sm py-2',
      className
    )}
    role="status"
    aria-label="No content available"
  >
    <FileX2 className="w-4 h-4" />
    <span>No content to display</span>
  </div>
);

const MarkdownRendererBase: FC<MarkdownRendererProps> = ({ content, className, isStreaming = false }) => {
  if (isEmptyContent(content)) {
    return <EmptyContent className={className} />;
  }

  return (
    <Streamdown
      className={getProseClassName(className)}
      shikiTheme={SHIKI_THEME}
      controls={STREAMDOWN_CONTROLS}
      mode={isStreaming ? 'streaming' : 'static'}
      isAnimating={isStreaming}
      parseIncompleteMarkdown={isStreaming}
      caret={isStreaming ? 'block' : undefined}
    >
      {content}
    </Streamdown>
  );
};

MarkdownRendererBase.displayName = 'MarkdownRenderer';

const areEqual = (prev: MarkdownRendererProps, next: MarkdownRendererProps) =>
  prev.content === next.content &&
  prev.className === next.className &&
  prev.isStreaming === next.isStreaming;

const MarkdownRenderer = memo(MarkdownRendererBase, areEqual);

export default MarkdownRenderer;
