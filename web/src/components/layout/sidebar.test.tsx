import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import Sidebar from './sidebar';

const useFeaturesMock = vi.fn();
// Mock the underlying `useFeatures` fetch only — `useFinanceEnabled` (a
// separate module) is left real, so its `?? false` fetch-failure fallback is
// what's actually exercised here, not a re-stubbed shortcut.
vi.mock('@/hooks/use-features', () => ({
  useFeatures: () => useFeaturesMock(),
}));

function renderAt(path = '/') {
  const rootRoute = createRootRoute({ component: () => <Sidebar /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const routeTree = rootRoute.addChildren([indexRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  useFeaturesMock.mockReset();
});

describe('Sidebar finance gating', () => {
  it('hides the Feoh nav item when finance is disabled', async () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: false } }, isError: false });
    renderAt();
    expect(await screen.findByText('This week')).toBeInTheDocument();
    expect(screen.queryByText('Feoh')).not.toBeInTheDocument();
  });

  it('shows the Feoh nav item when finance is enabled', async () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: true } }, isError: false });
    renderAt();
    expect(await screen.findByText('Feoh')).toBeInTheDocument();
  });

  it('treats a failed features fetch as all features off', async () => {
    useFeaturesMock.mockReturnValue({ data: undefined, isError: true });
    renderAt();
    expect(await screen.findByText('This week')).toBeInTheDocument();
    expect(screen.queryByText('Feoh')).not.toBeInTheDocument();
  });

  it('still renders other nav items when finance is disabled', async () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: false } }, isError: false });
    renderAt();
    expect(await screen.findByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
  });
});
