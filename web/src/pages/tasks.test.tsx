import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/tasks', () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  completeTask: vi.fn(),
  listAvailableLists: vi.fn(),
  getAllowlist: vi.fn(),
  setAllowlist: vi.fn(),
  setHouseholdList: vi.fn(),
}));

vi.mock('@/api/auth', () => ({
  whoami: vi.fn(),
}));

import {
  listTasks, listAvailableLists, getAllowlist, setAllowlist, setHouseholdList,
} from '@/api/tasks';
import { whoami } from '@/api/auth';
import TasksPage from './tasks';

/**
 * Local wrapper — no shared render utility exists in this repo
 * (see web/src/hooks/use-i18n.test.tsx). Uses RTL's `wrapper` option so
 * QueryClientProvider survives across rerenders.
 */
function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

const mocked = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

function whoamiResponse(role: 'admin' | 'adult' | 'child') {
  return {
    data: {
      id: 'm1', createdAt: '', updatedAt: '', email: 'a@example.com', handle: 'anna',
      role, displayName: 'Anna', avatarColor: 'ember',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked(listTasks).mockResolvedValue({ data: [], meta: { total: 0 } });
  mocked(setAllowlist).mockResolvedValue({ data: [] });
  mocked(setHouseholdList).mockResolvedValue({ data: null });
  mocked(whoami).mockResolvedValue(whoamiResponse('adult'));
});

describe('TasksPage list settings', () => {
  it('submits the full desired selection, provider-tagged', async () => {
    mocked(listAvailableLists).mockResolvedValue({ data: [
      { provider: 'google', id: 'g-1', name: 'Groceries', enabled: true },
      { provider: 'google', id: 'g-2', name: 'Chores', enabled: false },
    ] });
    mocked(getAllowlist).mockResolvedValue({ data: [
      { id: 'a1', provider: 'google', memberId: 'm1', listId: 'g-1', listName: 'Groceries', isHousehold: false },
    ] });

    renderWithProviders(<TasksPage />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/i }));
    await userEvent.click(await screen.findByLabelText('Chores'));

    await waitFor(() => expect(setAllowlist).toHaveBeenCalledWith([
      { provider: 'google', listId: 'g-1' },
      { provider: 'google', listId: 'g-2' },
    ]));
  });

  it('preserves an already-enabled other-provider list when toggling this one on', async () => {
    mocked(listAvailableLists).mockResolvedValue({ data: [
      { provider: 'm365', id: 'm-1', name: 'Work', enabled: true },
      { provider: 'google', id: 'g-1', name: 'Groceries', enabled: false },
    ] });
    mocked(getAllowlist).mockResolvedValue({ data: [
      { id: 'a1', provider: 'm365', memberId: 'm1', listId: 'm-1', listName: 'Work', isHousehold: false },
    ] });

    renderWithProviders(<TasksPage />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/i }));
    await userEvent.click(await screen.findByLabelText('Groceries'));

    await waitFor(() => expect(setAllowlist).toHaveBeenCalledWith([
      { provider: 'm365', listId: 'm-1' },
      { provider: 'google', listId: 'g-1' },
    ]));
  });

  it('designates the household list when the radio is picked, for an adult', async () => {
    mocked(listAvailableLists).mockResolvedValue({ data: [
      { provider: 'google', id: 'g-1', name: 'Groceries', enabled: true },
    ] });
    mocked(getAllowlist).mockResolvedValue({ data: [
      { id: 'a1', provider: 'google', memberId: 'm1', listId: 'g-1', listName: 'Groceries', isHousehold: false },
    ] });

    renderWithProviders(<TasksPage />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/i }));
    await userEvent.click(await screen.findByRole('radio'));

    await waitFor(() => expect(setHouseholdList).toHaveBeenCalledWith('google', 'g-1'));
  });

  it('hides the household-list radio for a child', async () => {
    mocked(whoami).mockResolvedValue(whoamiResponse('child'));
    mocked(listAvailableLists).mockResolvedValue({ data: [
      { provider: 'google', id: 'g-1', name: 'Groceries', enabled: true },
    ] });
    mocked(getAllowlist).mockResolvedValue({ data: [
      { id: 'a1', provider: 'google', memberId: 'm1', listId: 'g-1', listName: 'Groceries', isHousehold: false },
    ] });

    renderWithProviders(<TasksPage />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/i }));
    await screen.findByLabelText('Groceries');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
