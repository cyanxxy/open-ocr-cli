/**
 * Centralized theme system for the OCR Tool
 * Editorial Scanner Design - Stone palette with Vermillion accent
 */

export const theme = {
  // Background colors - Stone palette
  bg: {
    primary: 'bg-white dark:bg-stone-900 amoled:bg-black',
    secondary: 'bg-stone-50/80 dark:bg-stone-800/50 amoled:bg-stone-900/50',
    tertiary: 'bg-stone-100/80 dark:bg-stone-800 amoled:bg-stone-900',
    card: 'bg-white dark:bg-stone-800/80 amoled:bg-stone-900/80',
    hover: 'hover:bg-stone-50 dark:hover:bg-stone-700/50 amoled:hover:bg-stone-800/50',
    accent: {
      blue: 'bg-stone-50 dark:bg-stone-800/50 amoled:bg-stone-900/30',
      blueLight: 'bg-stone-50/30 dark:bg-stone-800/30 amoled:bg-stone-900/20',
      purple: 'bg-stone-50 dark:bg-stone-800/50 amoled:bg-stone-900/30',
      button: 'bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white',
      icon: 'bg-stone-900 dark:bg-stone-100',
      iconIndigo: 'bg-stone-900 dark:bg-stone-100',
      cardOverlay: 'bg-white/90 dark:bg-stone-900/90 amoled:bg-black/90 backdrop-blur-sm',
      overlayLight: 'bg-white/60 dark:bg-stone-900/60 amoled:bg-black/60 backdrop-blur-sm'
    },
    modal: 'bg-white dark:bg-stone-900 amoled:bg-black',
    input: 'bg-white dark:bg-stone-800/50 amoled:bg-stone-900/50',
    success: 'bg-emerald-50 dark:bg-emerald-900/20 amoled:bg-emerald-900/10',
    error: 'bg-rose-50 dark:bg-rose-900/20 amoled:bg-rose-900/10',
    warning: 'bg-amber-50 dark:bg-amber-900/20 amoled:bg-amber-900/10'
  },

  // Text colors - Stone palette
  text: {
    primary: 'text-stone-900 dark:text-stone-50 amoled:text-stone-100',
    secondary: 'text-stone-600 dark:text-stone-400 amoled:text-stone-500',
    tertiary: 'text-stone-500 dark:text-stone-500 amoled:text-stone-600',
    muted: 'text-stone-400 dark:text-stone-600 amoled:text-stone-700',
    heading: 'text-stone-900 dark:text-white amoled:text-white tracking-tight',
    label: 'text-stone-700 dark:text-stone-300 amoled:text-stone-400 font-medium',
    link: 'text-[#E34234] hover:text-[#C9352A] dark:text-[#E34234] dark:hover:text-[#F07264]',
    success: 'text-emerald-700 dark:text-emerald-400 amoled:text-emerald-500',
    error: 'text-rose-700 dark:text-rose-400 amoled:text-rose-500',
    warning: 'text-amber-700 dark:text-amber-400 amoled:text-amber-500',
    white: 'text-white',
    blue: {
      primary: 'text-stone-700 dark:text-stone-300 amoled:text-stone-400',
      secondary: 'text-stone-600 dark:text-stone-400 amoled:text-stone-500'
    },
    indigo: 'text-stone-700 dark:text-stone-300 amoled:text-stone-400',
    purple: 'text-stone-600 dark:text-stone-400 amoled:text-stone-500',
  },

  // Border colors - Stone palette
  border: {
    light: 'border-stone-100 dark:border-stone-800 amoled:border-stone-800',
    default: 'border-stone-200 dark:border-stone-700 amoled:border-stone-800',
    secondary: 'border-stone-100 dark:border-stone-800 amoled:border-stone-900',
    input: 'border-stone-200 dark:border-stone-700 amoled:border-stone-800',
    focus: 'focus:border-stone-500 dark:focus:border-stone-400',
    divider: 'border-stone-100 dark:border-stone-800 amoled:border-stone-900',
    dashed: 'border-2 border-dashed border-stone-300/60 dark:border-stone-700/60',
    transparent: 'border-transparent',
    active: 'border-stone-500 dark:border-stone-400 amoled:border-stone-500',
    success: 'border-emerald-200 dark:border-emerald-800 amoled:border-emerald-900',
    error: 'border-rose-200 dark:border-rose-800 amoled:border-rose-900',
    warning: 'border-amber-200 dark:border-amber-800 amoled:border-amber-900'
  },

  // Focus and ring styles - Stone palette
  focus: {
    ring: 'focus-visible:ring-2 focus-visible:ring-stone-500/30 dark:focus-visible:ring-stone-400/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900 focus:outline-none',
    outline: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/30',
    button: 'focus:outline-none focus-visible:ring-4 focus-visible:ring-stone-500/30',
    visible: 'focus:outline-none focus-visible:outline-2 focus-visible:outline-stone-500 focus-visible:outline-offset-2',
    link: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/30 focus-visible:ring-offset-2 rounded-sm'
  },

  // Shadow styles - Stone palette
  shadow: {
    default: 'shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none',
    md: 'shadow-md shadow-stone-200/50 dark:shadow-black/20',
    lg: 'shadow-lg shadow-stone-200/50 dark:shadow-black/30',
    xl: 'shadow-xl shadow-stone-200/50 dark:shadow-black/40',
    inner: 'shadow-inner',
    button: 'shadow-lg shadow-stone-900/10 dark:shadow-stone-900/30 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200',
    card: 'hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:hover:shadow-none transition-shadow duration-300',
    modal: 'shadow-[0_20px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]'
  },

  // Animation styles - with reduced motion support
  animation: {
    fadeIn: 'animate-fade-in motion-reduce:animate-none',
    slideIn: 'animate-slide-up motion-reduce:animate-none',
    pulse: 'animate-pulse motion-reduce:animate-none',
    spin: 'animate-spin motion-reduce:animate-none',
    transition: 'transition-all duration-200 ease-out motion-reduce:transition-none',
    transitionSlow: 'transition-all duration-300 ease-out motion-reduce:transition-none',
    transitionFast: 'transition-all duration-150 ease-out motion-reduce:transition-none',
    slideUp: 'animate-slide-up motion-reduce:animate-none',
    scaleIn: 'animate-scale-in motion-reduce:animate-none',
    bounce: 'animate-bounce motion-reduce:animate-none',
    reducedMotion: 'motion-reduce:transform-none motion-reduce:transition-none',
  },

  // Component-specific combinations - Stone palette with Vermillion accent
  components: {
    card: {
      base: 'bg-white dark:bg-stone-900 amoled:bg-black border border-stone-200 dark:border-stone-800 amoled:border-stone-800 rounded-2xl shadow-sm',
      hover: 'hover:shadow-md hover:border-stone-300 dark:hover:border-stone-700 transition-all duration-200',
      interactive: 'cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-transform duration-200',
      subtle: 'bg-stone-50 dark:bg-stone-800/50 amoled:bg-stone-900/30 border-stone-200/60 dark:border-stone-700/60 amoled:border-stone-800',
      default: 'bg-white dark:bg-stone-800 amoled:bg-stone-900 border-stone-200/60 dark:border-stone-700/60 amoled:border-stone-800'
    },
    button: {
      base: 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
      primary: 'px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 font-medium shadow-lg shadow-stone-900/10 dark:shadow-stone-900/30 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-stone-500/20',
      secondary: 'px-5 py-2.5 rounded-xl bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 border border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-700 hover:border-stone-300 dark:hover:border-stone-600 shadow-sm hover:-translate-y-0.5 transition-all duration-200',
      ghost: 'px-4 py-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-white transition-colors',
      danger: 'px-5 py-2.5 rounded-xl bg-[#E34234] hover:bg-[#C9352A] text-white font-medium shadow-lg shadow-[#E34234]/20 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-[#E34234]/20',
      success: 'px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-lg shadow-emerald-500/20 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-emerald-500/20'
    },
    input: {
      base: 'w-full px-4 py-3 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-500/20 focus:border-stone-500 transition-all',
      error: 'border-rose-500 focus:ring-rose-500/20 focus:border-rose-500',
    },
    toggle: {
      track: {
        base: 'w-11 h-6 rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-stone-500/20',
        on: 'bg-stone-900 dark:bg-stone-100',
        off: 'bg-stone-200 dark:bg-stone-700',
      },
      thumb: {
        base: 'inline-block w-4 h-4 transform bg-white dark:bg-stone-900 rounded-full shadow transition duration-200 ease-in-out',
        on: 'translate-x-6',
        off: 'translate-x-1',
      },
    },
    badge: {
      default: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
      base: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
      blue: 'bg-stone-50 dark:bg-stone-800/50 amoled:bg-stone-900/30 text-stone-700 dark:text-stone-300 amoled:text-stone-400 border border-stone-200 dark:border-stone-700 amoled:border-stone-800',
      green: 'bg-emerald-50 dark:bg-emerald-900/20 amoled:bg-emerald-900/10 text-emerald-700 dark:text-emerald-300 amoled:text-emerald-400 border border-emerald-100 dark:border-emerald-800 amoled:border-emerald-900',
      red: 'bg-rose-50 dark:bg-rose-900/20 amoled:bg-rose-900/10 text-rose-700 dark:text-rose-300 amoled:text-rose-400 border-rose-100 dark:border-rose-800 amoled:border-rose-900',
      yellow: 'bg-amber-50 dark:bg-amber-900/20 amoled:bg-amber-900/10 text-amber-700 dark:text-amber-300 amoled:text-amber-400 border-amber-100 dark:border-amber-800 amoled:border-amber-900',
      amber: 'bg-amber-50 dark:bg-amber-900/20 amoled:bg-amber-900/10 text-amber-700 dark:text-amber-300 amoled:text-amber-400 border border-amber-100 dark:border-amber-800 amoled:border-amber-900',
      gray: 'bg-stone-100 dark:bg-stone-800 amoled:bg-stone-900 text-stone-700 dark:text-stone-300 amoled:text-stone-400 border border-stone-200 dark:border-stone-700 amoled:border-stone-800',
      purple: 'bg-stone-100 dark:bg-stone-800 amoled:bg-stone-900 text-stone-700 dark:text-stone-300 amoled:text-stone-400 border border-stone-200 dark:border-stone-700 amoled:border-stone-800'
    },
    alert: {
      base: 'p-4 rounded-2xl flex items-start gap-3 border backdrop-blur-sm',
      info: 'bg-stone-50/80 dark:bg-stone-800/50 amoled:bg-stone-900/30 border-stone-200 dark:border-stone-700 amoled:border-stone-800',
      success: 'bg-emerald-50/80 dark:bg-emerald-900/20 amoled:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800 amoled:border-emerald-900',
      warning: 'bg-amber-50/80 dark:bg-amber-900/20 amoled:bg-amber-900/10 border-amber-100 dark:border-amber-800 amoled:border-amber-900',
      error: 'bg-rose-50/80 dark:bg-rose-900/20 amoled:bg-rose-900/10 border-rose-100 dark:border-rose-800 amoled:border-rose-900'
    }
  },

  // Utility classes
  utils: {
    scrollbar: 'scrollbar-thin scrollbar-thumb-stone-300 dark:scrollbar-thumb-stone-600 amoled:scrollbar-thumb-stone-700 hover:scrollbar-thumb-stone-400 dark:hover:scrollbar-thumb-stone-500',
    disabled: 'opacity-50 cursor-not-allowed saturate-0',
    overlay: 'fixed inset-0 bg-black/40 dark:bg-black/60 amoled:bg-black/80 backdrop-blur-sm z-50',
    container: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
    prose: 'prose prose-stone dark:prose-invert max-w-none prose-headings:tracking-tight prose-a:text-[#E34234] dark:prose-a:text-[#E34234]'
  }
};

// Helper function to combine theme classes
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Editorial Scanner Design System
 * A newspaper-inspired aesthetic with elegant typography and refined colors
 */
export const editorial = {
  // Typography
  fonts: {
    heading: "'Playfair Display', Georgia, serif",
    body: "'Source Sans 3', sans-serif",
  },

  // Colors
  colors: {
    vermillion: '#E34234',
    paper: '#FBF9F4',
    ink: '#1C1917',
  },

  // Backgrounds
  bg: {
    paper: 'bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 dark:from-stone-900 dark:via-stone-800 dark:to-stone-900',
    card: 'bg-white dark:bg-stone-900 border-stone-200/60 dark:border-stone-700/50',
    subtle: 'bg-stone-50/80 dark:bg-stone-800/50',
  },

  // Shadows
  shadow: {
    paper: 'shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50',
    lift: 'hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200',
  },

  // Components
  components: {
    badge: 'px-4 py-1.5 text-xs font-medium tracking-wide rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-700',
    statusDot: 'w-2 h-2 rounded-full animate-pulse',
    accentBar: 'w-1.5 h-8 rounded-full',
    cornerFrame: 'w-8 h-8 border-2 border-stone-300 dark:border-stone-700',
    button: {
      primary: 'bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 shadow-lg shadow-stone-900/20 dark:shadow-stone-900/40 hover:-translate-y-0.5 transition-all duration-200',
      secondary: 'bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-700',
      vermillion: 'bg-[#E34234] hover:bg-[#C9352A] text-white shadow-lg shadow-[#E34234]/20 hover:-translate-y-0.5 transition-all duration-200',
      danger: 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20',
    },
    card: {
      editorial: 'rounded-2xl bg-white dark:bg-stone-900 border border-stone-200/60 dark:border-stone-700/50 shadow-lg shadow-stone-200/30 dark:shadow-stone-900/50',
    },
    input: 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:ring-stone-500/20 focus:border-stone-500',
  },

  // Text styles
  text: {
    heading: 'text-stone-900 dark:text-stone-100',
    body: 'text-stone-600 dark:text-stone-400',
    muted: 'text-stone-500 dark:text-stone-500',
    label: 'text-xs font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400',
  },
};

// Re-export commonly used combinations
export const themePresets = {
  pageContainer: cn(theme.bg.primary, theme.text.primary, 'min-h-screen'),
  cardContainer: cn(theme.components.card.base, theme.components.card.default),
  cardSubtle: cn(theme.components.card.base, theme.components.card.subtle),
  primaryButton: theme.components.button.primary,
  secondaryButton: theme.components.button.secondary,
  inputField: theme.components.input.base,
  modalOverlay: cn(theme.utils.overlay, theme.animation.fadeIn),
  contentSection: cn(theme.bg.secondary, theme.border.default, 'rounded-xl p-4'),
  divider: cn(theme.border.divider, 'border-t my-4')
};

