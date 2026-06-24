import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { Header } from './Header';

const renderWithRouter = (component: React.ReactNode) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('Header', () => {
  it('should render the header', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('should display brand name', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    expect(screen.getByText('Gemini')).toBeInTheDocument();
    expect(screen.getByText('OCR')).toBeInTheDocument();
  });

  it('should render navigation links', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    const navElements = screen.getAllByRole('navigation');
    expect(navElements.length).toBeGreaterThanOrEqual(1);
  });

  it('should show Add API Key button when no API key', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    expect(screen.getByRole('button', { name: 'Add API Key' })).toBeInTheDocument();
  });

  it('should show settings button when API key is present', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(
      <Header apiKey="test-api-key" onOpenSettings={onOpenSettings} />
    );

    expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
  });

  it('should call onOpenSettings when settings button is clicked', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(
      <Header apiKey="test-api-key" onOpenSettings={onOpenSettings} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('should call onOpenSettings when Add API Key button is clicked', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add API Key' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('should have link to home page', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    const homeLink = screen.getByRole('link', { name: /gemini/i });
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('should render mobile navigation', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    // Check mobile nav exists (has two navigation elements)
    const navElements = screen.getAllByRole('navigation');
    expect(navElements.length).toBeGreaterThanOrEqual(1);
  });

  // audit X-01: the brand must not be a heading so each route keeps a single page-level h1
  it('should not render an h1 heading (brand is a non-heading span)', () => {
    const onOpenSettings = vi.fn();
    const { container } = renderWithRouter(
      <Header apiKey="" onOpenSettings={onOpenSettings} />
    );

    expect(container.querySelectorAll('h1')).toHaveLength(0);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  // audit X-02: every icon-only mobile nav link exposes an accessible name and current-page state
  it('should give every mobile nav link an accessible name', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    const mobileNav = screen
      .getAllByRole('navigation')
      .find((nav) => nav.className.includes('md:hidden'));
    expect(mobileNav).toBeDefined();

    const expectedLabels = ['Simple OCR', 'Templates', 'Web OCR', 'Bulk OCR', 'Agentic OCR'];
    for (const label of expectedLabels) {
      expect(within(mobileNav as HTMLElement).getByRole('link', { name: label })).toBeInTheDocument();
    }

    // No mobile nav link should have an empty accessible name.
    const links = within(mobileNav as HTMLElement).getAllByRole('link');
    expect(links).toHaveLength(expectedLabels.length);
    for (const link of links) {
      expect(link.getAttribute('aria-label')).toBeTruthy();
    }
  });

  // audit X-02: the active mobile link is marked aria-current="page"
  it('should mark the active mobile nav link with aria-current="page"', () => {
    const onOpenSettings = vi.fn();
    renderWithRouter(<Header apiKey="" onOpenSettings={onOpenSettings} />);

    const mobileNav = screen
      .getAllByRole('navigation')
      .find((nav) => nav.className.includes('md:hidden')) as HTMLElement;

    // BrowserRouter starts at "/", which is the Simple OCR link.
    const activeLink = within(mobileNav).getByRole('link', { name: 'Simple OCR' });
    expect(activeLink).toHaveAttribute('aria-current', 'page');

    const inactiveLink = within(mobileNav).getByRole('link', { name: 'Templates' });
    expect(inactiveLink).not.toHaveAttribute('aria-current');
  });

  // audit X-03: action buttons must declare type="button" so they never submit a wrapping form
  it('should declare type="button" on the settings/API-key button', () => {
    const onOpenSettings = vi.fn();
    const { rerender } = renderWithRouter(
      <Header apiKey="" onOpenSettings={onOpenSettings} />
    );

    expect(screen.getByRole('button', { name: 'Add API Key' })).toHaveAttribute('type', 'button');

    rerender(
      <BrowserRouter>
        <Header apiKey="test-api-key" onOpenSettings={onOpenSettings} />
      </BrowserRouter>
    );
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveAttribute('type', 'button');
  });

  // audit X-05: the live-status dot disables its pulse under prefers-reduced-motion
  it('should disable the live indicator pulse for reduced motion', () => {
    const onOpenSettings = vi.fn();
    const { container } = renderWithRouter(
      <Header apiKey="key" onOpenSettings={onOpenSettings} />
    );

    const pulse = container.querySelector('.animate-pulse');
    expect(pulse).not.toBeNull();
    expect(pulse?.className).toContain('motion-reduce:animate-none');
  });
});
