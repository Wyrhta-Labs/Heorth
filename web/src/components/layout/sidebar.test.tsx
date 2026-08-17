import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider, Outlet } from '@tanstack/react-router';
import Sidebar from './sidebar';

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
  const routeTree = rootRoute.addChildren([leaf('/'), leaf('/calendar'), leaf('/inventory')]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, router };
}

/** The active item is the one painted with the ember background. */
function activeLabel(): string | undefined {
  return document.querySelector('aside a.bg-ember')?.textContent?.trim();
}

afterEach(() => {
  cleanup();
});

describe('Sidebar', () => {
  it('shows the Feoh nav item alongside the other nav items', async () => {
    renderAt();
    expect(await screen.findByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Feoh')).toBeInTheDocument();
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

    await router.navigate({ to: '/inventory' });
    await waitFor(() => expect(activeLabel()).toBe('Inventory'));
  });
});
