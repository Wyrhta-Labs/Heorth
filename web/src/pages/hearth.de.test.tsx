import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import i18n from '@/i18n';

// Stub all data hooks so the page renders deterministically without a network.
const emptyQuery = { data: { data: [] }, isError: false, dataUpdatedAt: Date.parse('2026-07-24T12:00:00Z') };
vi.mock('@/hooks/use-calendar', () => ({ useEvents: () => emptyQuery }));
const useTasksSpy = vi.fn((_params: { due_from: string; due_to: string }, _opts?: unknown) => emptyQuery);
vi.mock('@/hooks/use-tasks', () => ({
  useTasks: (...args: Parameters<typeof useTasksSpy>) => useTasksSpy(...args),
  useCompleteTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/use-meals', () => ({
  useWeekPlan: () => emptyQuery,
  useRecipes: () => emptyQuery,
  useUpsertPlanEntry: () => ({ mutateAsync: vi.fn() }),
  useDeletePlanEntry: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/use-household', () => ({ useMembers: () => emptyQuery }));
vi.mock('@/hooks/use-m365', () => ({ useM365Status: () => ({ data: [] }) }));

import HearthPage from './hearth';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-24T12:00:00Z'));
  await i18n.changeLanguage('de');
});
afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await i18n.changeLanguage('en');
});

describe('HearthPage in German', () => {
  it('renders the view toggle, nav labels, and strip headings in German', async () => {
    render(<HearthPage />);
    expect(screen.getByRole('button', { name: 'Woche' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monat' })).toBeInTheDocument();
    expect(screen.getByLabelText('Weiter')).toBeInTheDocument();
    expect(screen.getByText('Heute Abend')).toBeInTheDocument();
    expect(screen.getByText('Heute fällig')).toBeInTheDocument();
    // Footer freshness line is translated:
    expect(screen.getByText(/Stand \d{2}:\d{2}/)).toBeInTheDocument();
  });
});
