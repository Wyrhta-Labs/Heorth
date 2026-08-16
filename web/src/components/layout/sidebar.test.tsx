import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import Sidebar from './sidebar';

function renderAt(path = '/') {
  const rootRoute = createRootRoute({ component: () => <Sidebar /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const routeTree = rootRoute.addChildren([indexRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return render(<RouterProvider router={router} />);
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
});
