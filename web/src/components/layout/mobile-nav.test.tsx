import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import MobileNav from './mobile-nav';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

function renderAt(path = '/') {
  const rootRoute = createRootRoute({ component: () => <MobileNav /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const routeTree = rootRoute.addChildren([indexRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return render(<RouterProvider router={router} />);
}

/** Opens the "More" sheet, which is where navItems (incl. Feoh) are listed. */
async function openMore() {
  fireEvent.click(await screen.findByRole('button', { name: /more/i }));
}

afterEach(() => {
  cleanup();
});

describe('MobileNav "More" sheet', () => {
  it('shows the Feoh nav item', async () => {
    renderAt();
    await openMore();
    expect(screen.getByText('Feoh')).toBeInTheDocument();
  });
});
