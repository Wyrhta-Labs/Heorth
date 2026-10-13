import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import MobileNav from './mobile-nav';
import type { NavCounts } from './sidebar';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

const useFeaturesMock = vi.fn();

vi.mock('@/hooks/use-features', () => ({
  useFeatures: () => useFeaturesMock(),
}));

function renderAt(path = '/', counts: NavCounts = {}) {
  const rootRoute = createRootRoute({ component: () => <MobileNav counts={counts} /> });
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
  useFeaturesMock.mockReset();
  cleanup();
});

describe('MobileNav "More" sheet', () => {
  beforeEach(() => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: true, kithledger: false, kithledgerUrl: null } } });
  });

  it('shows the Feoh nav item', async () => {
    renderAt();
    await openMore();
    expect(screen.getByText('Feoh')).toBeInTheDocument();
  });

  it('shows KithLedger as an external nav item when configured', async () => {
    useFeaturesMock.mockReturnValue({
      data: { data: { finance: true, kithledger: true, kithledgerUrl: 'http://kith.test' } },
    });
    renderAt();
    await openMore();

    const link = screen.getByRole('link', { name: 'KithLedger' });
    expect(link).toHaveAttribute('href', 'http://kith.test');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the shopping count on the Shopping tab', async () => {
    renderAt('/', { shopping: 4 });
    expect(await screen.findByLabelText('4 open')).toBeInTheDocument();
  });
});
