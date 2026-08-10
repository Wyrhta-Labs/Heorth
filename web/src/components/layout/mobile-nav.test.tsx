import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import MobileNav from './mobile-nav';

const useFeaturesMock = vi.fn();
vi.mock('@/hooks/use-features', () => ({
  useFeatures: () => useFeaturesMock(),
}));
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
  useFeaturesMock.mockReset();
});

describe('MobileNav "More" sheet finance gating', () => {
  it('hides the Feoh nav item when finance is disabled', async () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: false } }, isError: false });
    renderAt();
    await openMore();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.queryByText('Feoh')).not.toBeInTheDocument();
  });

  it('shows the Feoh nav item when finance is enabled', async () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: true } }, isError: false });
    renderAt();
    await openMore();
    expect(screen.getByText('Feoh')).toBeInTheDocument();
  });

  it('treats a failed features fetch as all features off', async () => {
    useFeaturesMock.mockReturnValue({ data: undefined, isError: true });
    renderAt();
    await openMore();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.queryByText('Feoh')).not.toBeInTheDocument();
  });
});
