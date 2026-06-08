import type { ReactNode, FC } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { theme, cn } from '../../design/theme';

export interface AlertProps {
  /** The content to be displayed inside the alert message */
  children?: ReactNode;
  /** The visual style and type of the alert */
  variant?: 'info' | 'success' | 'warning' | 'error';
  /** Optional title for the alert */
  title?: string;
  /** Optional additional CSS classes */
  className?: string;
  /** Whether to show the icon */
  showIcon?: boolean;
  /** Custom icon to override the default */
  icon?: LucideIcon;
  /** Optional action button or link */
  action?: ReactNode;
  /** Whether the alert can be dismissed */
  dismissible?: boolean;
  /** Callback when alert is dismissed */
  onDismiss?: () => void;
}

interface AlertVariant {
  icon: LucideIcon;
  styles: string;
  iconColor: string;
}

const alertVariants: Record<NonNullable<AlertProps['variant']>, AlertVariant> = {
  info: {
    icon: Info,
    styles: theme.components.alert.info,
    iconColor: theme.text.blue.primary
  },
  success: {
    icon: CheckCircle2,
    styles: theme.components.alert.success,
    iconColor: theme.text.success
  },
  warning: {
    icon: AlertTriangle,
    styles: theme.components.alert.warning,
    iconColor: theme.text.warning
  },
  error: {
    icon: AlertCircle,
    styles: theme.components.alert.error,
    iconColor: theme.text.error
  }
};

/**
 * Alert component - Displays informational messages with different severity levels
 * Fully type-safe with theme integration
 */
export const Alert: FC<AlertProps> = ({
  children,
  variant = 'info',
  title,
  className,
  showIcon = true,
  icon: customIcon,
  action,
  dismissible = false,
  onDismiss
}) => {
  const variantConfig = alertVariants[variant];
  const Icon = customIcon || variantConfig.icon;

  return (
    <div
      role="alert"
      className={cn(
        theme.components.alert.base,
        variantConfig.styles,
        theme.animation.fadeIn,
        className
      )}
    >
      {showIcon && (
        <Icon 
          className={cn('w-5 h-5 shrink-0', variantConfig.iconColor)} 
          aria-hidden="true" 
        />
      )}
      
      <div className="flex-1">
        {title && (
          <h3 className={cn('font-medium mb-1', theme.text.primary)}>
            {title}
          </h3>
        )}
        <div className={cn('text-sm', theme.text.secondary)}>
          {children}
        </div>
        {action && (
          <div className="mt-2">
            {action}
          </div>
        )}
      </div>

      {dismissible && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            // Minimum touch target: 44px for mobile accessibility
            'ml-auto -mx-1.5 -my-1.5 inline-flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-lg',
            theme.bg.hover,
            theme.text.secondary,
            // Use focus-visible for better keyboard accessibility
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2',
            'transition-colors'
          )}
          aria-label="Dismiss alert"
        >
          <span className="sr-only">Dismiss</span>
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export default Alert;