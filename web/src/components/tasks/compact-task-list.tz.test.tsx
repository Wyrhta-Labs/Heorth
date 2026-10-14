// The browser runs in UTC; the household lives in Pacific/Auckland.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Task } from '@/lib/types';

vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => ({ data: { data: { timezone: 'Pacific/Auckland' } }, isError: false }),
}));

import CompactTaskList from './compact-task-list';

afterEach(() => { cleanup(); });

describe('CompactTaskList in the household time zone', () => {
  it("shows a task's due date as the household's date", () => {
    // Due 21:00Z Sun 26 Jul = 09:00 Mon 27 Jul in Auckland.
    const task = { id: 't1', title: 'Bins out', dueAt: '2026-07-26T21:00:00Z', status: 'open' } as Task;
    render(<CompactTaskList tasks={[task]} onToggle={() => {}} />);
    expect(screen.getByText('Jul 27, 2026')).toBeInTheDocument();
  });
});
