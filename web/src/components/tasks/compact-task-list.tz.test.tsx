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

describe('CompactTaskList highlightDay', () => {
  it("highlights the tasks due on the household's day, and keeps them inside the cap", () => {
    // 21:00Z Sun 26 Jul is Mon 27 Jul in Auckland; 21:00Z Fri 31 Jul is Sat 1 Aug.
    const tasks = [
      ...['a', 'b', 'c'].map((id) => ({ id, title: `Early ${id}`, dueAt: '2026-07-26T21:00:00Z', status: 'open' }) as Task),
      { id: 'late', title: 'Saturday job', dueAt: '2026-07-31T21:00:00Z', status: 'open' } as Task,
    ];
    render(<CompactTaskList tasks={tasks} limit={2} onToggle={() => {}} highlightDay="2026-08-01" />);
    const rows = screen.getAllByRole('listitem').filter((li) => li.querySelector('input'));
    expect(rows.map((r) => r.textContent?.includes('Saturday job'))).toEqual([false, true]);
    expect(screen.getByText('Saturday job').closest('li')).toHaveAttribute('data-highlight', 'true');
    expect(screen.getByText('Early a').closest('li')).not.toHaveAttribute('data-highlight');
  });
});
