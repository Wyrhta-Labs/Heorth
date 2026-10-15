import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const createTask = { mutateAsync: vi.fn(async () => ({})), isPending: false };
vi.mock('@/hooks/use-tasks', () => ({ useCreateTask: () => createTask }));
vi.mock('@/hooks/use-meals', () => ({ useUpsertPlanEntry: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => ({ data: { data: { timezone: 'Europe/Berlin' } }, isError: false }),
}));
const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

import QuickCapture from './quick-capture';

const trigger = () => screen.getByRole('button', { name: /quick capture/i });

beforeEach(() => { createTask.mutateAsync.mockClear(); toast.mockClear(); });
afterEach(cleanup);

describe('QuickCapture', () => {
  it('opens a menu with the two capture types', () => {
    render(<QuickCapture />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Add task', 'Meal note']);
  });

  it('closes the menu on Escape and on an outside click', () => {
    render(<div><QuickCapture /><p>outside</p></div>);
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the chosen type in a modal and closes it after saving', async () => {
    render(<QuickCapture />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add task' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Add task' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Buy milk' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add task' })); });
    expect(createTask.mutateAsync).toHaveBeenCalledWith({ title: 'Buy milk' });
    expect(toast).toHaveBeenCalledWith('Task added to the shared list', 'success');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancel closes the modal without saving', () => {
    render(<QuickCapture />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(createTask.mutateAsync).not.toHaveBeenCalled();
  });
});
