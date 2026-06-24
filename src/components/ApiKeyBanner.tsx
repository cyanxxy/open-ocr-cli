import { Key, X } from 'lucide-react';

interface ApiKeyBannerProps {
  onOpenSettings: () => void;
  onClose: () => void;
}

export function ApiKeyBanner({ onOpenSettings, onClose }: ApiKeyBannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="text-white"
      style={{ backgroundColor: '#E34234' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Key className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium">API Key Required</p>
              <p className="text-sm text-white/80">Add your Gemini API key to start using the OCR tool</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-medium bg-white hover:bg-white/90 transition-colors"
              style={{ color: '#E34234' }}
            >
              Add API Key
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Dismiss banner"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}