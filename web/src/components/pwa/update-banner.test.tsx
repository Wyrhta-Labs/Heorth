import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import {
  createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider,
} from '@tanstack/react-router';
import UpdateBanner from './update-banner';

let updateCallback: (() => void) | null = null;
const applyServiceWorkerUpdate = vi.fn();
let idleValue = false;

vi.mock('@/lib/sw-register', () => ({
  registerServiceWorker: (cb: () => void) => { updateCallback = cb; },
  applyServiceWorkerUpdate: (...args: unknown[]) => applyServiceWorkerUpdate(...args),
}));
vi.mock('@/components/hearth/use-idle', () => ({ useIdle: () => idleValue }));

/** Mounts UpdateBanner at the router root, navigated to `path` — mirrors how
 * app.tsx actually mounts it (inside the root route's component). */
function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: () => <UpdateBanner /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const hearthRoute = createRoute({ getParentRoute: () => rootRoute, path: '/hearth', component: () => null });
  const routeTree = rootRoute.addChildren([indexRoute, hearthRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  updateCallback = null;
  idleValue = false;
  applyServiceWorkerUpdate.mockClear();
});
afterEach(() => cleanup());

describe('UpdateBanner route awareness', () => {
  it('shows the reload banner on a normal route when an update is available', async () => {
    renderAt('/');
    await waitFor(() => expect(updateCallback).not.toBeNull());
    act(() => updateCallback!());
    expect(await screen.findByText('A new version of Heorth is ready.')).toBeInTheDocument();
  });

  it('renders nothing on /hearth even when an update is available', async () => {
    renderAt('/hearth');
    await waitFor(() => expect(updateCallback).not.toBeNull());
    act(() => updateCallback!());
    expect(screen.queryByText('A new version of Heorth is ready.')).toBeNull();
  });

  it('does not auto-apply the update on /hearth while the wall is active (not idle)', async () => {
    idleValue = false;
    renderAt('/hearth');
    await waitFor(() => expect(updateCallback).not.toBeNull());
    act(() => updateCallback!());
    expect(applyServiceWorkerUpdate).not.toHaveBeenCalled();
  });

  it('silently applies the update on /hearth once the wall goes idle', async () => {
    idleValue = true;
    renderAt('/hearth');
    await waitFor(() => expect(updateCallback).not.toBeNull());
    act(() => updateCallback!());
    await waitFor(() => expect(applyServiceWorkerUpdate).toHaveBeenCalledTimes(1));
  });

  it('does not auto-apply the update on a normal route', async () => {
    idleValue = true;
    renderAt('/');
    await waitFor(() => expect(updateCallback).not.toBeNull());
    act(() => updateCallback!());
    expect(applyServiceWorkerUpdate).not.toHaveBeenCalled();
  });
});
