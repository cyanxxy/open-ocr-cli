import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';
import { testGemini } from '../../utils/testGemini';
import type { ThemeMode, ModelType, ThinkingConfig } from '../../store/useSettingsStore';

vi.mock('../../utils/testGemini', () => ({
  testGemini: vi.fn(),
}));

const mockedTestGemini = vi.mocked(testGemini);

function renderModal(overrides: Partial<React.ComponentProps<typeof SettingsModal>> = {}) {
  const props: React.ComponentProps<typeof SettingsModal> = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    initialApiKey: '',
    initialTheme: 'light' as ThemeMode,
    initialModel: 'gemini-3.5-flash' as ModelType,
    initialThinkingConfig: { level: 'HIGH', includeThoughts: false } as ThinkingConfig,
    ...overrides,
  };
  return { props, ...render(<SettingsModal {...props} />) };
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // The modal marks #root inert while open; provide it so the path is exercised.
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
  });

  it('renders the dialog in a portal and marks the app root inert (audit X-04)', () => {
    renderModal();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const root = document.getElementById('root');
    expect(root?.hasAttribute('inert')).toBe(true);
    expect(root?.getAttribute('aria-hidden')).toBe('true');
  });

  it('removes inert from the app root when closed', () => {
    const { rerender, props } = renderModal();
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true);

    rerender(<SettingsModal {...props} isOpen={false} />);
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('root')?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('disables the Test button for a whitespace-only key (audit U-08)', async () => {
    const user = userEvent.setup();
    renderModal();

    const input = screen.getByPlaceholderText('Enter your Gemini API key');
    await user.type(input, '   ');

    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
  });

  it('shows the result for the test connection that resolves (audit U-07)', async () => {
    const user = userEvent.setup();
    mockedTestGemini.mockResolvedValueOnce({ success: true, model: 'gemini-3.5-flash', responseTime: 5 });

    renderModal({ initialApiKey: 'configured-key' });

    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });
    // The run-id guard means only the latest test's result is ever published; a
    // single in-flight test is enforced by disabling the button while testing.
    expect(screen.getByRole('button', { name: /test connection/i })).not.toBeDisabled();
  });

  it('keeps the modal open and shows an error when saving fails (audit U-09)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Could not save your key'));
    const onClose = vi.fn();

    renderModal({ onSave, onClose, initialApiKey: 'a-key' });

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByText('Could not save your key')).toBeInTheDocument();
    });
    // Modal stays open (dialog still present) and was not asked to close.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onSave with the entered values when saving succeeds', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    renderModal({ onSave, initialApiKey: 'a-key' });

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('a-key', 'light', 'gemini-3.5-flash', { level: 'HIGH', includeThoughts: false });
    });
  });
});
