import type React from 'react';
import { Link, useLocation } from 'react-router';
import { Newspaper, Settings, Zap, FileText, Globe, Bot, Layers, BadgeCheck } from 'lucide-react';
import { cn } from '../../design/theme';

interface HeaderProps {
  apiKey: string;
  onOpenSettings: () => void;
}

export function Header({ apiKey, onOpenSettings }: HeaderProps) {
  const location = useLocation();

  return (
    <header className="relative bg-stone-50 dark:bg-stone-950 amoled:bg-black border-b border-stone-200 dark:border-stone-800 amoled:border-stone-900 sticky top-0 z-50">
      {/* Subtle top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: 'linear-gradient(90deg, transparent 0%, #E34234 20%, #E34234 80%, transparent 100%)' }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Main header row */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 md:flex md:h-20 md:justify-between md:py-0">

          {/* Logo & Masthead */}
          <Link
            to="/"
            className="group flex items-center gap-2 sm:gap-3 md:gap-4 shrink-0"
          >
            {/* Icon mark */}
            <div className="relative">
              <div className={cn(
                "w-9 h-9 sm:w-11 sm:h-11 md:w-12 md:h-12 rounded-lg sm:rounded-xl flex items-center justify-center",
                "bg-stone-900 dark:bg-stone-100",
                "shadow-lg shadow-stone-900/20 dark:shadow-black/30",
                "transition-all duration-300 ease-out",
                "group-hover:shadow-xl group-hover:shadow-stone-900/30 dark:group-hover:shadow-black/40",
                "group-hover:-translate-y-0.5 group-hover:rotate-[-2deg]",
                // audit X-05: respect prefers-reduced-motion for the logo hover transform
                "motion-reduce:transition-none motion-reduce:transform-none"
              )}>
                <Newspaper
                  className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-stone-100 dark:text-stone-900"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </div>

              {/* Live indicator dot */}
              <div className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 w-2.5 h-2.5 sm:w-3 sm:h-3">
                <span
                  className={cn(
                    "absolute inset-0 rounded-full",
                    // audit X-05: disable the pulse animation under prefers-reduced-motion
                    apiKey
                      ? "bg-emerald-500 animate-pulse motion-reduce:animate-none"
                      : "bg-amber-500 animate-pulse motion-reduce:animate-none"
                  )}
                  style={{ animationDuration: '2s' }}
                />
                <span
                  className={cn(
                    "absolute inset-[2px] rounded-full",
                    apiKey ? "bg-emerald-400" : "bg-amber-400"
                  )}
                />
              </div>
            </div>

            {/* Brand text */}
            <div className="flex flex-col">
              {/* audit X-01: brand is a non-heading <span> so each route keeps a single page-level <h1> */}
              <span
                className={cn(
                  "text-base sm:text-xl md:text-2xl tracking-tight",
                  "text-stone-900 dark:text-stone-100",
                  "transition-colors duration-200 motion-reduce:transition-none",
                  "group-hover:text-stone-700 dark:group-hover:text-white"
                )}
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                <span className="font-semibold">Gemini</span>
                {' '}
                <em className="font-normal italic">OCR</em>
              </span>

              {/* Tagline - hidden on mobile */}
              <div className="hidden md:flex items-center gap-2 mt-0.5">
                <span
                  className="text-[11px] tracking-[0.15em] uppercase text-stone-400 dark:text-stone-500"
                  style={{ fontFamily: "'Source Sans 3', sans-serif" }}
                >
                  Powered by Gemini 3
                </span>
              </div>
            </div>
          </Link>

          {/* Right side: Nav + Settings */}
          <div className="contents md:flex md:items-center md:gap-4">

            {/* Desktop Navigation */}
            <nav
              id="main-navigation"
              className="hidden md:flex items-center gap-1 p-1.5 rounded-2xl bg-stone-100/80 dark:bg-stone-900/80 amoled:bg-stone-950/80 border border-stone-200/60 dark:border-stone-800/60"
              role="navigation"
              aria-label="Main navigation"
            >
              <NavLink to="/" isActive={location.pathname === '/'} icon={FileText}>
                Simple
              </NavLink>
              <NavLink to="/templates" isActive={location.pathname === '/templates'} icon={BadgeCheck}>
                Templates
              </NavLink>
              <NavLink to="/web" isActive={location.pathname === '/web'} icon={Globe}>
                Web
              </NavLink>
              <NavLink to="/advanced" isActive={location.pathname === '/advanced'} icon={Layers}>
                Bulk
              </NavLink>
              <NavLink to="/agentic" isActive={location.pathname === '/agentic'} icon={Bot}>
                Agent
              </NavLink>
            </nav>

            {/* Mobile Navigation - Compact pills */}
            <nav
              className="col-span-2 row-start-2 grid w-full grid-cols-5 gap-1 rounded-xl border border-stone-200/60 bg-stone-100/80 p-1 dark:border-stone-800/60 dark:bg-stone-900/80 md:hidden"
              role="navigation"
              aria-label="Main navigation"
            >
              {/* audit X-02: icon-only links carry an accessible name; icons are decorative */}
              <MobileNavLink to="/" isActive={location.pathname === '/'} ariaLabel="Simple OCR">
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              </MobileNavLink>
              <MobileNavLink to="/templates" isActive={location.pathname === '/templates'} ariaLabel="Templates">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
              </MobileNavLink>
              <MobileNavLink to="/web" isActive={location.pathname === '/web'} ariaLabel="Web OCR">
                <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              </MobileNavLink>
              <MobileNavLink to="/advanced" isActive={location.pathname === '/advanced'} ariaLabel="Bulk OCR">
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              </MobileNavLink>
              <MobileNavLink to="/agentic" isActive={location.pathname === '/agentic'} ariaLabel="Agentic OCR">
                <Bot className="w-3.5 h-3.5" aria-hidden="true" />
              </MobileNavLink>
            </nav>

            {/* Settings Button */}
            <button
              id="settings-button"
              type="button"
              onClick={onOpenSettings}
              className={cn(
                "relative col-start-2 row-start-1 flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl text-xs font-medium sm:gap-2 sm:text-sm",
                "transition-all duration-200 ease-out",
                "focus:outline-none focus:ring-2 focus:ring-offset-2",
                "active:scale-95",
                // audit X-05: neutralize transition/transform when prefers-reduced-motion is set
                "motion-reduce:transition-none motion-reduce:transform-none",
                !apiKey
                  ? "px-2.5 py-2 sm:px-4 sm:py-2.5 bg-gradient-to-b from-[#E34234] to-[#C9352A] text-white shadow-lg shadow-[#E34234]/30 hover:shadow-xl hover:shadow-[#E34234]/40 hover:-translate-y-0.5 focus:ring-[#E34234]/50 border border-[#E34234]"
                  : "p-2 sm:px-3 sm:py-2.5 bg-white dark:bg-stone-900 amoled:bg-stone-950 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-700 amoled:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800 amoled:hover:bg-stone-900 hover:text-stone-900 dark:hover:text-stone-200 hover:border-stone-300 dark:hover:border-stone-600 focus:ring-stone-500/30 shadow-sm hover:shadow"
              )}
              style={{ fontFamily: "'Source Sans 3', sans-serif" }}
              aria-label={!apiKey ? "Add API Key" : "Open settings"}
            >
              {!apiKey ? (
                <>
                  <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Add API Key</span>
                </>
              ) : (
                <Settings className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

interface NavLinkProps {
  to: string;
  isActive: boolean;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  children: React.ReactNode;
}

function NavLink({ to, isActive, icon: Icon, children }: NavLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        "relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium",
        "transition-all duration-200 ease-out motion-reduce:transition-none",
        "focus:outline-none focus:ring-2 focus:ring-stone-500/20",
        isActive
          ? "bg-white dark:bg-stone-800 amoled:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm border border-stone-200/50 dark:border-stone-700/50"
          : "text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-white/50 dark:hover:bg-stone-800/50"
      )}
      style={{ fontFamily: "'Source Sans 3', sans-serif" }}
      aria-current={isActive ? 'page' : undefined}
    >
      {/* audit X-02: icon is decorative; the visible label provides the accessible name */}
      <Icon aria-hidden="true" className={cn(
        "w-4 h-4 transition-colors motion-reduce:transition-none",
        isActive
          ? "text-stone-700 dark:text-stone-300"
          : "text-stone-400 dark:text-stone-500"
      )} />
      <span>{children}</span>

      {/* Active indicator bar */}
      {isActive && (
        <span
          className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full"
          style={{ backgroundColor: '#E34234' }}
        />
      )}
    </Link>
  );
}

interface MobileNavLinkProps {
  to: string;
  isActive: boolean;
  /** audit X-02: accessible name for the icon-only link */
  ariaLabel: string;
  children: React.ReactNode;
}

function MobileNavLink({ to, isActive, ariaLabel, children }: MobileNavLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        "flex min-h-11 w-full items-center justify-center rounded-lg",
        "transition-all duration-200 motion-reduce:transition-none",
        isActive
          ? "bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-sm"
          : "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-white/50 dark:hover:bg-stone-800/50"
      )}
      aria-label={ariaLabel}
      aria-current={isActive ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}
