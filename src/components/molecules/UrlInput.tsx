import type React from 'react';
import { useCallback, useId, useMemo } from 'react';
import { Link, X, Plus, Globe, AlertCircle } from 'lucide-react';
import { Button } from '../atoms/Button';
import { cn } from '../../design/theme';
import { parseSupportedHttpUrl } from '../../lib/urlValidation';

interface UrlInputProps {
  urls: string[];
  onUrlsChange: (urls: string[]) => void;
  maxUrls?: number;
  disabled?: boolean;
}

interface UrlItemProps {
  url: string;
  index: number;
  onUpdate: (index: number, url: string) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

const UrlItem: React.FC<UrlItemProps> = ({ url, index, onUpdate, onRemove, disabled }) => {
  const inputId = useId();
  const errorId = useId();

  // Derive the validation error from the current `url` prop instead of holding it
  // in local state. With a list keyed by index, local state would otherwise stay
  // attached to the slot (not the value) and strand a stale error on the wrong
  // row after a middle-row removal.
  const error = useMemo(() => {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      if (!parseSupportedHttpUrl(url)) return 'URL must start with http:// or https://';
      if (!urlObj.hostname) return 'Invalid URL format';
      return '';
    } catch {
      return 'Invalid URL format';
    }
  }, [url]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(index, e.target.value);
  };

  return (
    <div className="space-y-2">
      {/* Visually hidden label for accessibility */}
      <label htmlFor={inputId} className="sr-only">
        URL {index + 1}
      </label>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Link className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-stone-400 dark:text-stone-500" aria-hidden="true" />
          </div>
          <input
            id={inputId}
            type="url"
            value={url}
            onChange={handleChange}
            disabled={disabled}
            placeholder="https://example.com/doc.pdf"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? 'true' : undefined}
            className={cn(
              'w-full pl-8 sm:pl-10 pr-2 sm:pr-3 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base',
              'bg-white dark:bg-stone-800 amoled:bg-stone-900',
              'border transition-colors',
              error
                ? 'border-red-400 dark:border-red-600 focus-visible:ring-red-500'
                : 'border-stone-300 dark:border-stone-600 amoled:border-stone-800 focus-visible:ring-stone-500',
              'focus:outline-none focus-visible:ring-2',
              'text-stone-900 dark:text-stone-100 amoled:text-stone-200',
              'placeholder-stone-400 dark:placeholder-stone-500',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
        </div>
        <Button
          onClick={() => onRemove(index)}
          disabled={disabled}
          variant="ghost"
          size="sm"
          className="p-2 shrink-0"
          aria-label={`Remove URL ${index + 1}`}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <div
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400"
        >
          <AlertCircle className="w-3 h-3" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export const UrlInput: React.FC<UrlInputProps> = ({
  urls,
  onUrlsChange,
  maxUrls = 20,
  disabled = false
}) => {
  const handleAddUrl = useCallback(() => {
    if (urls.length < maxUrls) {
      onUrlsChange([...urls, '']);
    }
  }, [urls, maxUrls, onUrlsChange]);
  
  const handleUpdateUrl = useCallback((index: number, url: string) => {
    const newUrls = [...urls];
    newUrls[index] = url;
    onUrlsChange(newUrls);
  }, [urls, onUrlsChange]);
  
  const handleRemoveUrl = useCallback((index: number) => {
    const newUrls = urls.filter((_, i) => i !== index);
    onUrlsChange(newUrls.length === 0 ? [''] : newUrls);
  }, [urls, onUrlsChange]);
  
  const canAddMore = urls.length < maxUrls;
  
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <Globe className="w-4 h-4 sm:w-5 sm:h-5 text-stone-600 dark:text-stone-400 shrink-0" />
          <h3 className="text-xs sm:text-sm font-medium text-stone-700 dark:text-stone-300 truncate">
            URLs ({urls.length}/{maxUrls})
          </h3>
        </div>
        {canAddMore && (
          <Button
            onClick={handleAddUrl}
            disabled={disabled}
            variant="ghost"
            size="sm"
            leftIcon={Plus}
            className="shrink-0 text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">Add URL</span>
            <span className="sm:hidden">Add</span>
          </Button>
        )}
      </div>

      <div className="space-y-2 sm:space-y-3">
        {urls.map((url, index) => (
          <UrlItem
            key={index}
            url={url}
            index={index}
            onUpdate={handleUpdateUrl}
            onRemove={handleRemoveUrl}
            disabled={disabled}
          />
        ))}
      </div>

      {urls.length >= maxUrls && (
        <div className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Maximum of {maxUrls} URLs reached
        </div>
      )}

      <div className="text-[10px] sm:text-xs text-stone-500 dark:text-stone-400">
        <p className="mb-1">Supported: Web pages, Images, PDFs</p>
      </div>
    </div>
  );
};