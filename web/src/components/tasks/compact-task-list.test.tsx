import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompactTaskList from './compact-task-list';
import type { Task } from '@/lib/types';

const task = (over: Partial<Task>): Task => ({
  id: Math.random().toString(), source: 'native', feedKey: '', externalId: '', memberId: '',
  listId: '', listName: null, title: 'Task', notes: null, dueAt: null, completedAt: null,
  status: 'open', createdAt: '', updatedAt: '', syncedAt: '', ...over,
});

describe('CompactTaskList', () => {
  it('shows an empty state with no tasks', () => {
    render(<CompactTaskList tasks={[]} onToggle={() => {}} />);
    expect(screen.getByText('No open tasks.')).toBeInTheDocument();
  });

  it('sorts by due date ascending, undated last', () => {
    render(
      <CompactTaskList
        tasks={[
          task({ title: 'No date' }),
          task({ title: 'Later', dueAt: '2030-01-05' }),
          task({ title: 'Sooner', dueAt: '2030-01-01' }),
        ]}
        onToggle={() => {}}
      />,
    );
    const titles = screen.getAllByRole('checkbox').map((c) => c.closest('li')?.textContent);
    expect(titles[0]).toContain('Sooner');
    expect(titles[1]).toContain('Later');
    expect(titles[2]).toContain('No date');
  });

  it('caps rendered rows at limit and shows a "+N more" hint', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => task({ title: `T${i}` }));
    render(<CompactTaskList tasks={tasks} limit={5} onToggle={() => {}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('calls onToggle with the task when checked', () => {
    const onToggle = vi.fn();
    const t = task({ title: 'Do it' });
    render(<CompactTaskList tasks={[t]} onToggle={onToggle} />);
    screen.getByRole('checkbox').click();
    expect(onToggle).toHaveBeenCalledWith(t);
  });
});
