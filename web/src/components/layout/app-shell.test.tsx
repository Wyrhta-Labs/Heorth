import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import AppShell from './app-shell';

vi.mock('@/hooks/use-features', () => ({ useFeatures: () => ({ data: { data: { kithledgerUrl: null } } }) }));
vi.mock('@/hooks/use-household', () => ({ useWhoami: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('@/hooks/use-nav-counts', () => ({ useNavCounts: () => ({ tasks: 2, shopping: 3, weorc: undefined, feoh: 1 }) }));

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
  it('passes the nav counts to the sidebar', async () => {
    renderShell();
    await screen.findByRole('main');
    expect(document.querySelectorAll('aside [data-nav-badge]')).toHaveLength(3);
    // The bottom bar (MobileNav) gets them too: its Shopping tab shows the count.
    expect(within(document.querySelector('nav.fixed') as HTMLElement).getByLabelText('3 open')).toBeInTheDocument();
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

  it('keeps room for the bottom bar and the safe area until md, where the bar goes', async () => {
    renderShell();
    const main = await screen.findByRole('main');
    expect(main).toHaveClass('pb-[calc(5rem+env(safe-area-inset-bottom,0px))]', 'md:pb-6');
    // A padding shorthand below md (sm:p-5) would reset the bottom padding
    // between 640px and 767px, where the bottom bar still covers the page.
    expect(main.className).not.toMatch(/(^|\s)sm:p-\d/);
  });
});
