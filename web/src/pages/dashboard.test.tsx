import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';

vi.mock('@/hooks/use-household', () => ({ useHousehold: () => ({ data: { data: { timezone: 'UTC' } }, isError: false }) }));
const useEventsSpy = vi.fn((_p: { from: string; to: string }, _o?: unknown) => ({
  data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn(),
}));
vi.mock('@/hooks/use-calendar', () => ({ useEvents: (...a: Parameters<typeof useEventsSpy>) => useEventsSpy(...a) }));
vi.mock('@/components/dashboard/supper-card', () => ({
  default: ({ day, label }: { day?: string; label?: string }) => <p data-testid="supper">{day} {label ?? 'tonight'}</p>,
}));
vi.mock('@/components/dashboard/due-work', () => ({
  default: ({ day }: { day?: string }) => <p data-testid="due-work">{day}</p>,
}));
vi.mock('@/components/dashboard/members-row', () => ({ default: () => null }));

import DashboardPage from './dashboard';

function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (s: Record<string, unknown>): { day?: string } => ({ day: typeof s['day'] === 'string' ? s['day'] : undefined }),
    component: DashboardPage,
  });
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]), history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

const cardTitles = () => screen.getAllByRole('heading').map((h) => h.textContent);
const fetchedDays = () => useEventsSpy.mock.calls.slice(-2).map(([p]) => p.from.slice(0, 10));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); // Thu 15 Oct
  useEventsSpy.mockClear();
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('This week focused on a day', () => {
  it('shows today and tomorrow by default', async () => {
    renderAt('/');
    await screen.findByTestId('due-work');
    expect(cardTitles()).toEqual(expect.arrayContaining(['Today', 'Tomorrow']));
    expect(screen.getByTestId('supper')).toHaveTextContent('2026-10-15 tonight');
  });

  it('clicking a later day shows that day and the day after, and focuses supper and work on it', async () => {
    const router = renderAt('/');
    await screen.findByTestId('due-work');
    const saturday = screen.getAllByTestId('day-strip-cell').find((c) => c.dataset.iso === '2026-10-17')!;
    await act(async () => { fireEvent.click(saturday); });

    await waitFor(() => expect(router.state.location.search).toEqual({ day: '2026-10-17' }));
    expect(saturday).toHaveAttribute('aria-pressed', 'true');
    expect(cardTitles()).toEqual(expect.arrayContaining(['Saturday, 17 October', 'Sunday, 18 October']));
    expect(fetchedDays()).toEqual(['2026-10-17', '2026-10-18']);
    expect(screen.getByTestId('supper')).toHaveTextContent('2026-10-17 Supper · Saturday, 17 October');
    expect(screen.getByTestId('due-work')).toHaveTextContent('2026-10-17');
  });

  it('names tomorrow as Tomorrow when it is the focused day', async () => {
    renderAt('/?day=2026-10-16');
    await screen.findByTestId('due-work');
    expect(cardTitles()).toEqual(expect.arrayContaining(['Tomorrow', 'Saturday, 17 October']));
  });

  it('clicking today again drops the parameter', async () => {
    const router = renderAt('/?day=2026-10-17');
    await screen.findByTestId('due-work');
    await act(async () => { fireEvent.click(screen.getAllByTestId('day-strip-cell')[0]!); });
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(cardTitles()).toEqual(expect.arrayContaining(['Today', 'Tomorrow']));
  });

  it('ignores a day outside the strip', async () => {
    renderAt('/?day=2026-10-01');
    await screen.findByTestId('due-work');
    expect(cardTitles()).toEqual(expect.arrayContaining(['Today', 'Tomorrow']));
  });
});
