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

  it('marks the active bottom-bar tab with aria-current', async () => {
    renderAt('/today');
    expect(await screen.findByRole('link', { name: /today/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /shopping/i })).not.toHaveAttribute('aria-current');
  });

  it('marks the active More-sheet link with aria-current', async () => {
    renderAt('/calendar');
    await openMore();
    const links = screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/calendar');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    const other = screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/weorc');
    expect(other[0]).not.toHaveAttribute('aria-current');
  });

  it('marks a More-sheet link active across its activePrefix, as the sidebar does', async () => {
    renderAt('/household/settings');
    await openMore();
    const link = screen.getAllByRole('link').find((l) => l.getAttribute('href') === '/household/members');
    expect(link).toHaveAttribute('aria-current', 'page');
  });
});
