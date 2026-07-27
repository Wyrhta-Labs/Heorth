import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/use-auth';
import { I18nProvider, useDateFnsLocale } from '@/hooks/use-i18n';
import { TOKEN_KEY } from '@/api/client';
import i18n from '@/i18n';
import * as householdApi from '@/api/household';

vi.mock('@/api/household', { spy: true });

function Probe() {
  const locale = useDateFnsLocale();
  return <div data-testid="code">{locale.code}</div>;
}

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={qc}>
        <I18nProvider>{ui}</I18nProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

// Adjust this helper to the ACTUAL return shape of getHousehold() (ok envelope).
function householdResponse(locale: string) {
  return {
    data: {
      id: 'h1', name: 'Home', timezone: 'Europe/Berlin', locale, createdAt: '2026-01-01T00:00:00Z',
    },
  } as Awaited<ReturnType<typeof householdApi.getHousehold>>;
}

describe('I18nProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(householdApi.getHousehold).mockReset();
  });

  it('defaults to enUS and fetches nothing while unauthenticated', async () => {
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('code').textContent).toBe('en-US');
    await waitFor(() => expect(householdApi.getHousehold).not.toHaveBeenCalled());
    expect(i18n.language).toBe('en');
  });

  it('switches to de + de date-fns locale for a de-DE household', async () => {
    localStorage.setItem(TOKEN_KEY, 'jwt');
    vi.mocked(householdApi.getHousehold).mockResolvedValue(householdResponse('de-DE'));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('code').textContent).toBe('de'));
    expect(i18n.language).toBe('de');
  });

  it('gives useDateFnsLocale a safe enUS default outside the provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('code').textContent).toBe('en-US');
  });
});
