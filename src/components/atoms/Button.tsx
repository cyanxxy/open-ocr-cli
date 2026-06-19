import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { theme, cn } from '../../design/theme';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Loading state */
  loading?: boolean;
  /** Icon to display before the text */
  leftIcon?: LucideIcon | ReactNode;
  /** Icon to display after the text */
  rightIcon?: LucideIcon | ReactNode;
  /** Full width button */
  fullWidth?: boolean;
  /** Children content */
  children: ReactNode;
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg'
} as const;

/**
 * Button component - A flexible button with multiple variants and sizes
 * Fully type-safe with theme integration
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled = false,
  className,
  children,
  ...props
}, ref) => {
  const isDisabled = disabled || loading;

  const variantClasses = {
    primary: theme.components.button.primary,
    secondary: theme.components.button.secondary,
    ghost: theme.components.button.ghost,
    danger: theme.components.button.danger,
    success: theme.components.button.success
  };

  const renderIcon = (icon: LucideIcon | ReactNode, position: 'left' | 'right') => {
    if (!icon) return null;
    
    const iconClass = cn(
      'inline-block',
      position === 'left' ? 'mr-2' : 'ml-2',
      size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'
    );

    // If it's already a React element, clone it to apply sizing classes.
    // Parametrize isValidElement so props are typed (React 19 defaults element props to `unknown`).
    if (React.isValidElement<React.HTMLAttributes<HTMLElement>>(icon)) {
      return React.cloneElement(icon, {
        className: cn(iconClass, icon.props.className),
        'aria-hidden': true
      });
    }

    // Render component types (including forwardRef components)
    if (typeof icon === 'function' || typeof icon === 'object') {
      const IconComponent = icon as LucideIcon;
      return <IconComponent className={iconClass} aria-hidden="true" />;
    }

    return null;
  };

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        isDisabled && theme.utils.disabled,
        className
      )}
      {...props}
    >
      {loading ? (
        <span role="status" aria-live="polite" className="inline-flex items-center">
          <svg
            className={cn(
              'animate-spin motion-reduce:animate-none',
              size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5',
              'mr-2'
            )}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading...</span>
        </span>
      ) : (
        <>
          {renderIcon(leftIcon, 'left')}
          {children}
          {renderIcon(rightIcon, 'right')}
        </>
      )}
    </button>
  );
});

// Add display name for debugging
Button.displayName = 'Button';

export default Button;
