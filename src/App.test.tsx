import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { useSettingsStore } from './store/useSettingsStore';

vi.mock('./pages/SimpleOCR', () => ({
  default: () => <div>Simple OCR Page</div>,
}));

vi.mock('./pages/TemplatesOCR', () => ({
  default: () => <div>Templates OCR Page</div>,
}));

vi.mock('./pages/WebOCR', () => ({
  default: () => <div>Web OCR Page</div>,
}));

vi.mock('./pages/AdvancedOCR', () => ({
  default: () => <div>Advanced OCR Page</div>,
}));

vi.mock('./pages/AgenticOCR', () => ({
  default: () => <div>Agentic OCR Page</div>,
}));

vi.mock('./utils/testGemini', () => ({
  testGemini: vi.fn(async () => ({
    success: true,
    model: 'gemini-3.5-flash',
    responseTime: 10,
    response: 'API test successful',
  })),
}));

describe('App', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      apiKey: '',
      model: 'gemini-3.5-flash',
      handwritingMode: false,
      theme: 'light',
      hasSeenOnboarding: false,
      thinkingConfig: {
        level: 'HIGH',
        includeThoughts: false,
      },
      hasHydrated: false,
    });
  });

  it('waits for settings hydration before showing API-key UI', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
    expect(screen.queryByText('API Key Required')).not.toBeInTheDocument();
    expect(screen.queryByText('Set API Key')).not.toBeInTheDocument();
  });

  it('shows the banner again after a previously configured key is cleared', async () => {
    const user = userEvent.setup();

    useSettingsStore.setState({
      hasHydrated: true,
      apiKey: '',
    });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('API Key Required')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Dismiss banner'));
    expect(screen.queryByText('API Key Required')).not.toBeInTheDocument();

    await act(async () => {
      useSettingsStore.setState({ apiKey: 'configured-key' });
    });

    await waitFor(() => {
      expect(screen.queryByText('API Key Required')).not.toBeInTheDocument();
    });

    await act(async () => {
      useSettingsStore.setState({ apiKey: '' });
    });

    await waitFor(() => {
      expect(screen.getByText('API Key Required')).toBeInTheDocument();
    });
  });

  it('restores focus to the settings trigger when the modal closes', async () => {
    const user = userEvent.setup();

    useSettingsStore.setState({
      hasHydrated: true,
      apiKey: '',
    });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    const settingsButton = document.getElementById('settings-button');
    expect(settingsButton).toBeInstanceOf(HTMLButtonElement);

    await user.click(settingsButton as HTMLButtonElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(settingsButton).toHaveFocus();
  });
});
