import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import AppShell from './app-shell';

vi.mock('@/hooks/use-features', () => ({ useFeatures: () => ({ data: { data: { kithledgerUrl: null } } }) }));
vi.mock('@/hooks/use-household', () => ({ useWhoami: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('@/hooks/use-nav-counts', () => ({ useNavCounts: () => ({ tasks: 2, shopping: 0, weorc: undefined, feoh: 1 }) }));

function renderShell() {
  const root = createRootRoute({ component: AppShell });
  const leaf = (p: string) => createRoute({ getParentRoute: () => root, path: p, component: () => <div>page {p}</div> });
  const router = createRouter({
    routeTree: root.addChildren([leaf('/'), leaf('/calendar')]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('AppShell', () => {
  // The router scrolls the window to the top on navigation; jsdom does not implement it.
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes the nav counts to the sidebar', async () => {
    renderShell();
    await screen.findByRole('main');
    expect(document.querySelectorAll('aside [data-nav-badge]')).toHaveLength(2);
  });

  it('scrolls inside <main>, marked as the scroll root, and resets it on navigation', async () => {
    const router = renderShell();
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('data-scroll-root');
    expect(main).toHaveClass('overflow-y-auto', 'min-h-0');
    main.scrollTop = 400;
    await router.navigate({ to: '/calendar' });
    await screen.findByText('page /calendar');
    await waitFor(() => expect(main.scrollTop).toBe(0));
  });
});
