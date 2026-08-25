import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import * as api from '@/api/weorc';

vi.mock('@/api/weorc');

import WeorcPage from './weorc';

const TODAY = '2026-08-25';
const routine = (over = {}) => ({
  id: 'r1', name: 'Put the bins out', notes: null, mode: 'fixed',
  intervalUnit: 'week', intervalCount: 1, anchorDate: TODAY, leadDays: 0,
  ownerMemberId: null, anchorAssetId: null, anchorPlaceId: null, active: true,
  nextDueOn: TODAY, openOccurrence: null, ...over,
});
const occurrence = (over = {}) => ({
  id: 'o1', routineId: 'r1', dueOn: TODAY, status: 'due', completedAt: null,
  completedByMemberId: null, note: null, taskFeedKey: null,
  taskExternalId: null, projectionError: null, ...over,
});
const listing = (...rows: unknown[]) => ({ data: rows, meta: { total: rows.length } });

beforeEach(async () => {
  await i18n.changeLanguage('de');
  vi.resetAllMocks();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

function renderWeorc() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WeorcPage />
    </QueryClientProvider>,
  );
}

describe('the Weorc page in German', () => {
  it('renders the German catalogue while leaving "Weorc" untranslated', async () => {
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: occurrence() })) as never);
    renderWeorc();

    // The module name is a proper noun, following Feoh and Ethel - it stays
    // untranslated in every locale.
    expect(screen.getByText('Weorc')).toBeInTheDocument();
    expect(screen.getByText('Die wiederkehrende Arbeit im Haushalt — die Hausarbeit.')).toBeInTheDocument();
    expect(screen.getByText('Jetzt fällig')).toBeInTheDocument();
    expect(screen.getByText('Demnächst')).toBeInTheDocument();
    expect(screen.getByText('Routinen')).toBeInTheDocument();

    await screen.findByText('Put the bins out');
    expect(screen.getByRole('button', { name: 'Erledigt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Überspringen' })).toBeInTheDocument();
  });

  it('shows the German quiet projection notice', async () => {
    const failed = occurrence({ projectionError: 'needs_reauth' });
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: failed })) as never);
    renderWeorc();

    expect(await screen.findByText(/Aufgabenliste war nicht erreichbar/)).toBeInTheDocument();
  });
});
