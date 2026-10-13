import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider, Outlet } from '@tanstack/react-router';
import Sidebar, { type NavCounts } from './sidebar';

const useFeaturesMock = vi.fn();

vi.mock('@/hooks/use-features', () => ({
  useFeatures: () => useFeaturesMock(),
}));
vi.mock('@/hooks/use-household', () => ({
  useWhoami: () => ({ data: { data: { displayName: 'Ana', avatarColor: 'sky', role: 'adult' } } }),
}));
const logoutMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: logoutMock }) }));

/**
 * Mirrors the real tree: the sidebar lives in a parent component that stays
 * mounted across navigations, so it must subscribe to router state itself.
 */
function renderAt(path = '/', counts: NavCounts = {}) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Sidebar counts={counts} />
        <Outlet />
      </>
    ),
  });
  const leaf = (p: string) => createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null });
  const routeTree = rootRoute.addChildren([leaf('/'), leaf('/calendar'), leaf('/ethel'), leaf('/profile')]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, router };
}

function activeLabel(): string | undefined {
  return document.querySelector('aside a[aria-current="page"]')?.textContent?.trim();
}

afterEach(() => {
  useFeaturesMock.mockReset();
  cleanup();
});

describe('Sidebar', () => {
  beforeEach(() => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: true, kithledger: false, kithledgerUrl: null } } });
  });

  it('shows the Feoh nav item alongside the other nav items', async () => {
    renderAt();
    expect(await screen.findByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Feoh')).toBeInTheDocument();
  });

  it('shows KithLedger as an external nav item when configured', async () => {
    useFeaturesMock.mockReturnValue({
      data: { data: { finance: true, kithledger: true, kithledgerUrl: 'http://kith.test' } },
    });
    renderAt();

    const link = await screen.findByRole('link', { name: /KithLedger/i });
    expect(link).toHaveAttribute('href', 'http://kith.test');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('highlights the item for the initial path', async () => {
    renderAt('/calendar');
    await screen.findByText('Calendar');
    expect(activeLabel()).toBe('Calendar');
  });

  it('moves the highlight when the route changes under a static parent', async () => {
    const { router } = renderAt('/calendar');
    await screen.findByText('Calendar');
    expect(activeLabel()).toBe('Calendar');

    await router.navigate({ to: '/ethel' });
    await waitFor(() => expect(activeLabel()).toBe('Ethel'));
  });

  it('groups the items under Day, Household and System', async () => {
    renderAt();
    await screen.findByText('This week');
    const groups = [...document.querySelectorAll('aside [data-nav-group]')].map((g) => [
      g.getAttribute('data-nav-group'),
      [...g.querySelectorAll('a')].map((a) => a.textContent?.trim()),
    ]);
    expect(groups).toEqual([
      ['day', ['This week', 'Today', 'Calendar', 'Tasks', 'Shopping list', 'Quick capture', 'Meals']],
      ['household', ['Feoh', 'Ethel', 'Weorc', 'Library']],
      ['system', ['Household', 'Hearth (wall)']],
    ]);
  });

  it('appends KithLedger to System only', async () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: true, kithledger: true, kithledgerUrl: 'http://kith.test' } } });
    renderAt();
    const system = await screen.findByText('Hearth (wall)');
    expect(system.closest('[data-nav-group]')).toHaveAttribute('data-nav-group', 'system');
    expect(screen.getByRole('link', { name: /KithLedger/ }).closest('[data-nav-group]'))
      .toHaveAttribute('data-nav-group', 'system');
  });

  it('shows a badge above zero only, with an accessible label', async () => {
    renderAt('/', { tasks: 3, shopping: 0, weorc: undefined, feoh: 12 });
    await screen.findByText('Tasks');
    expect(screen.getByLabelText('3 open')).toBeInTheDocument();
    expect(screen.getByLabelText('12 open')).toBeInTheDocument();
    expect(screen.queryByLabelText('0 open')).toBeNull();
    expect(document.querySelectorAll('aside [data-nav-badge]')).toHaveLength(2);
  });

  it('gives every item a title for the icon rail', async () => {
    renderAt();
    expect(await screen.findByTitle('Weorc')).toBeInTheDocument();
  });

  it('shows the signed-in member in the footer, links to the profile and signs out', async () => {
    renderAt();
    const profile = await screen.findByRole('link', { name: /Ana/ });
    expect(profile).toHaveAttribute('href', '/profile');
    screen.getByRole('button', { name: 'Sign out' }).click();
    expect(logoutMock).toHaveBeenCalled();
  });
});
