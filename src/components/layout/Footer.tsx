import type React from 'react';
import { Mail, Code2, ExternalLink } from 'lucide-react';
import { cn, theme, editorial } from '../../design/theme';

export function Footer() {
  return (
    <footer
      className="mt-auto border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900"
      role="contentinfo"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Brand section */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-stone-900 dark:bg-stone-100 flex items-center justify-center shrink-0 shadow-sm">
              <Code2 className="w-3 h-3 text-stone-100 dark:text-stone-900" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold text-stone-900 dark:text-stone-100 tracking-tight"
                style={{ fontFamily: editorial.fonts.heading }}
              >
                Gemini <em className="font-normal">OCR</em>
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 font-medium border border-stone-200 dark:border-stone-700"
                style={{ fontFamily: editorial.fonts.body }}
              >
                Gemini 3
              </span>
            </div>
          </div>

          {/* Social links */}
          <div className="flex items-center gap-4">
            <FooterLink
              href="https://github.com/cyanxxy"
              label="GitHub"
              icon={<GitHubIcon className="w-3.5 h-3.5" />}
            />
            <FooterLink
              href="https://www.linkedin.com/in/mansour-damanpak/"
              label="LinkedIn"
              icon={<LinkedInIcon className="w-3.5 h-3.5" />}
            />
            <FooterLink
              href="mailto:mansoor.damanpak@gmail.com"
              label="Email"
              icon={<Mail className="w-3.5 h-3.5" />}
            />
          </div>

          {/* Copyright */}
          <div
            className="text-xs text-stone-400 dark:text-stone-500"
            style={{ fontFamily: editorial.fonts.body }}
          >
            <span>© {new Date().getFullYear()} All rights reserved</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

interface FooterLinkProps {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface SocialIconProps {
  className?: string;
}

function GitHubIcon({ className }: SocialIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.39.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.25.45-2.28 1.2-3.08-.12-.29-.52-1.46.11-3.04 0 0 .98-.31 3.16 1.18a10.96 10.96 0 0 1 5.75 0c2.19-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.42-2.7 5.38-5.28 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function LinkedInIcon({ className }: SocialIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.02H3.56V9h3.56v11.45ZM22.23 0H1.77A1.75 1.75 0 0 0 0 1.73v20.54A1.75 1.75 0 0 0 1.77 24h20.46A1.76 1.76 0 0 0 24 22.27V1.73A1.76 1.76 0 0 0 22.23 0Z" />
    </svg>
  );
}

function FooterLink({ href, label, icon }: FooterLinkProps) {
  const isExternal = href.startsWith('http') || href.startsWith('mailto:');

  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className={cn(
        "group flex items-center gap-1.5 text-xs font-medium rounded-md",
        "text-stone-500 dark:text-stone-400",
        "hover:text-stone-900 dark:hover:text-stone-100",
        "transition-colors duration-200",
        theme.focus.link
      )}
      style={{ fontFamily: editorial.fonts.body }}
      aria-label={isExternal ? `${label} (opens in new tab)` : label}
    >
      <span className="transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:transform-none">
        {icon}
      </span>
      <span className="hidden sm:inline">{label}</span>
      {isExternal && !href.startsWith('mailto:') && (
        <ExternalLink className="w-2.5 h-2.5 opacity-50 hidden sm:inline" aria-hidden="true" />
      )}
    </a>
  );
}
