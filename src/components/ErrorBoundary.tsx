import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { logger } from '../lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

/**
 * Error Boundary component for catching and handling React errors
 * Provides a user-friendly fallback UI when components crash
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to our logging service
    logger.error('React Error Boundary caught an error:', error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Update state with error details
    this.setState(prevState => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // In production, you might want to send this to an error reporting service
    if (import.meta.env.PROD) {
      // Example: sendToErrorReportingService(error, errorInfo);
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoHome = (): void => {
    // Respect the Vite base path (GitHub Pages / sub-path deploys) instead of a
    // hardcoded '/', which would break navigation under a non-root base (audit U-11).
    window.location.href = import.meta.env.BASE_URL || '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-stone-50 dark:bg-stone-900 amoled:bg-black">
          <div className="max-w-md w-full">
            <div className="bg-white dark:bg-stone-800 amoled:bg-black rounded-2xl shadow-xl p-8">
              {/* Error Icon */}
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-red-100 dark:bg-red-900/20 amoled:bg-red-900/10 rounded-full">
                  <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
                </div>
              </div>

              {/* Error Message */}
              <h1 className="text-2xl font-bold text-center text-stone-900 dark:text-white amoled:text-stone-200 mb-2">
                Oops! Something went wrong
              </h1>
              <p className="text-center text-stone-600 dark:text-stone-400 amoled:text-stone-500 mb-6">
                We encountered an unexpected error. Any unsaved work on this page may have been lost.
              </p>

              {/* Error Details (Development only) */}
              {import.meta.env.DEV && this.state.error && (
                <div className="mb-6 p-4 bg-stone-100 dark:bg-stone-700 amoled:bg-stone-800 rounded-lg">
                  <p className="text-sm font-mono text-stone-800 dark:text-stone-200 amoled:text-stone-300 mb-2">
                    {this.state.error.message}
                  </p>
                  {this.state.errorInfo && (
                    <details className="text-xs text-stone-600 dark:text-stone-400 amoled:text-stone-500">
                      <summary className="cursor-pointer hover:text-stone-800 dark:hover:text-stone-200 amoled:hover:text-stone-300">
                        View stack trace
                      </summary>
                      <pre className="mt-2 overflow-auto max-h-40 text-xs">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-stone-200 text-white dark:text-stone-900 rounded-lg transition-colors duration-200"
                  aria-label="Try again"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={this.handleGoHome}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600 amoled:bg-stone-800 amoled:hover:bg-stone-700 text-stone-800 dark:text-stone-200 amoled:text-stone-300 rounded-lg transition-colors duration-200"
                  aria-label="Go to homepage"
                >
                  <Home className="h-4 w-4" />
                  Go Home
                </button>
              </div>

              {/* Error count indicator */}
              {this.state.errorCount > 1 && (
                <p className="mt-4 text-center text-sm text-stone-500 dark:text-stone-400 amoled:text-stone-500">
                  This error has occurred {this.state.errorCount} times
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
