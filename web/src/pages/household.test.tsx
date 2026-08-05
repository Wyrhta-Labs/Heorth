import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import {
  createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider, redirect, Outlet,
} from '@tanstack/react-router';
import HouseholdPage from './household';
import SettingsTabPanel from '@/components/household/settings-tab-panel';
import { DEFAULT_SETTINGS_TAB } from '@/lib/settings-tabs';

const useWhoamiMock = vi.fn();
const useMembersMock = vi.fn();

vi.mock('@/hooks/use-household', () => ({
  useWhoami: () => useWhoamiMock(),
  useMembers: () => useMembersMock(),
  useCreateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetMemberRole: () => ({ mutateAsync: vi.fn() }),
  useDeleteMember: () => ({ mutateAsync: vi.fn() }),
}));

// Each panel's own behaviour is covered by its own suite; stubbed here so this
// file only exercises the layout's tab gating and the routing.
vi.mock('@/components/household/connections-panel', () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => <div>connections-panel-stub:{String(!!readOnly)}</div>,
}));
vi.mock('@/components/household/api-keys-panel', () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => <div>api-keys-panel-stub:{String(!!readOnly)}</div>,
}));
vi.mock('@/components/household/household-settings', () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => <div>household-settings-stub:{String(!!readOnly)}</div>,
}));

const members = [
  { id: 'a', role: 'admin' as const, displayName: 'Admin', email: 'admin@example.com', avatarColor: 'ember' as const },
  { id: 'b', role: 'adult' as const, displayName: 'Anna', email: 'anna@example.com', avatarColor: 'sage' as const },
];

function setRole(role: 'admin' | 'adult' | 'child') {
  useWhoamiMock.mockReturnValue({
    data: { data: { id: 'b', handle: 'anna', role, displayName: 'Anna' } },
    isError: false, refetch: vi.fn(),
  });
  useMembersMock.mockReturnValue({ data: { data: members }, isError: false, refetch: vi.fn() });
}

/** whoami still in flight: no data, no error. */
function setWhoamiPending() {
  useWhoamiMock.mockReturnValue({ data: undefined, isError: false, refetch: vi.fn() });
  useMembersMock.mockReturnValue({ data: { data: members }, isError: false, refetch: vi.fn() });
}

/** whoami itself failed to load. Returns its refetch spy so a test can assert on it. */
function setWhoamiError() {
  const refetch = vi.fn();
  useWhoamiMock.mockReturnValue({ data: undefined, isError: true, refetch });
  useMembersMock.mockReturnValue({ data: { data: members }, isError: false, refetch: vi.fn() });
  return refetch;
}

/** whoami resolved fine, but the members query failed. Returns its refetch spy. */
function setMembersError(role: 'admin' | 'adult' | 'child') {
  const refetch = vi.fn();
  useWhoamiMock.mockReturnValue({
    data: { data: { id: 'b', handle: 'anna', role, displayName: 'Anna' } },
    isError: false, refetch: vi.fn(),
  });
  useMembersMock.mockReturnValue({ data: undefined, isError: true, refetch });
  return refetch;
}

/** Mounts the real /household layout + $tab child route at `path`. */
function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const householdRoute = createRoute({ getParentRoute: () => rootRoute, path: '/household', component: HouseholdPage });
  const indexRoute = createRoute({
    getParentRoute: () => householdRoute,
    path: '/',
    beforeLoad: () => { throw redirect({ to: '/household/$tab', params: { tab: DEFAULT_SETTINGS_TAB } }); },
  });
  const tabRoute = createRoute({ getParentRoute: () => householdRoute, path: '$tab', component: SettingsTabPanel });
  const routeTree = rootRoute.addChildren([householdRoute.addChildren([indexRoute, tabRoute])]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return { router, ...render(<RouterProvider router={router} />) };
}

afterEach(() => {
  cleanup();
  useWhoamiMock.mockReset();
  useMembersMock.mockReset();
});

describe('HouseholdPage tab gating', () => {
  it('shows all four tabs to an admin', async () => {
    setRole('admin');
    renderAt('/household/members');

    expect(await screen.findByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  });

  it('shows all four tabs to an adult too', async () => {
    setRole('adult');
    renderAt('/household/members');

    expect(await screen.findByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  });

  it('shows only the Members tab to a child', async () => {
    setRole('child');
    renderAt('/household/members');

    expect(await screen.findByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'API keys' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connections' })).not.toBeInTheDocument();
  });

  it('renders the Members content read-only for an adult', async () => {
    setRole('adult');
    renderAt('/household/members');

    expect(await screen.findByText('Anna')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add member/i })).not.toBeInTheDocument();
  });
});

describe('HouseholdPage read-only propagation', () => {
  it('passes readOnly=true to the settings panel for an adult', async () => {
    setRole('adult');
    renderAt('/household/settings');
    expect(await screen.findByText('household-settings-stub:true')).toBeInTheDocument();
  });

  it('passes readOnly=false to the settings panel for an admin', async () => {
    setRole('admin');
    renderAt('/household/settings');
    expect(await screen.findByText('household-settings-stub:false')).toBeInTheDocument();
  });

  it('passes readOnly=true to the connections panel for an adult', async () => {
    setRole('adult');
    renderAt('/household/connections');
    expect(await screen.findByText('connections-panel-stub:true')).toBeInTheDocument();
  });

  it('leaves the API keys panel writable for an adult', async () => {
    setRole('adult');
    renderAt('/household/keys');
    expect(await screen.findByText('api-keys-panel-stub:false')).toBeInTheDocument();
  });
});

describe('HouseholdPage error states', () => {
  it('shows a load error and retries when whoami fails', async () => {
    const refetch = setWhoamiError();
    renderAt('/household/members');

    expect(await screen.findByText('We couldn’t load your household.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows a load error and retries when the members query fails', async () => {
    const refetch = setMembersError('admin');
    renderAt('/household/members');

    expect(await screen.findByText('We couldn’t load your household.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('HouseholdPage routing', () => {
  it('redirects /household to the default tab', async () => {
    setRole('admin');
    const { router } = renderAt('/household');
    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });

  it('redirects an unknown tab to the default tab', async () => {
    setRole('admin');
    const { router } = renderAt('/household/does-not-exist');
    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });

  it('redirects a tab the member may not open to the default tab', async () => {
    setRole('child');
    const { router } = renderAt('/household/keys');
    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });

  it('does NOT redirect a deep link while whoami is still loading', async () => {
    setWhoamiPending();
    const { router } = renderAt('/household/keys');

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/household/keys');
  });

  // The test above only proves the LAYOUT holds the line: its `if (!member)`
  // returns before <Outlet />, so SettingsTabPanel never mounts and a broken
  // guard inside it would pass vacuously. This mounts the panel under a parent
  // that always renders its Outlet, so the panel's own guard is what is tested.
  it('SettingsTabPanel itself does not redirect while whoami is loading', async () => {
    setWhoamiPending();
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const householdRoute = createRoute({
      getParentRoute: () => rootRoute, path: '/household', component: () => <Outlet />,
    });
    const tabRoute = createRoute({
      getParentRoute: () => householdRoute, path: '$tab', component: SettingsTabPanel,
    });
    const routeTree = rootRoute.addChildren([householdRoute.addChildren([tabRoute])]);
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/household/keys'] }) });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/household/keys');
  });

  // Same harness, but with a resolved role — proves the panel DOES redirect a
  // forbidden tab once it knows the role, so the test above is not just
  // asserting that the panel never redirects at all.
  it('SettingsTabPanel redirects a forbidden tab once the role is known', async () => {
    setRole('child');
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const householdRoute = createRoute({
      getParentRoute: () => rootRoute, path: '/household', component: () => <Outlet />,
    });
    const tabRoute = createRoute({
      getParentRoute: () => householdRoute, path: '$tab', component: SettingsTabPanel,
    });
    const routeTree = rootRoute.addChildren([householdRoute.addChildren([tabRoute])]);
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/household/keys'] }) });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });

  it('clicking a tab trigger navigates to that tab', async () => {
    setRole('admin');
    const { router } = renderAt('/household/members');

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/household/settings'));
  });
});
