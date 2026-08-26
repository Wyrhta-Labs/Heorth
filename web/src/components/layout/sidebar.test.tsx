import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider, Outlet } from '@tanstack/react-router';
import Sidebar from './sidebar';

const useFeaturesMock = vi.fn();

vi.mock('@/hooks/use-features', () => ({
  useFeatures: () => useFeaturesMock(),
}));

/**
 * Mirrors the real tree: the sidebar lives in a parent component that stays
 * mounted across navigations, so it must subscribe to router state itself.
 */
function renderAt(path = '/') {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Sidebar />
        <Outlet />
      </>
    ),
  });
  const leaf = (p: string) => createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null });
  const routeTree = rootRoute.addChildren([leaf('/'), leaf('/calendar'), leaf('/ethel')]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, router };
}

/** The active item is the one painted with the ember background. */
function activeLabel(): string | undefined {
  return document.querySelector('aside a.bg-ember')?.textContent?.trim();
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
});
