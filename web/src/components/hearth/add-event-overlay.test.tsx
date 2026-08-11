import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast';

// The overlay creates events via useCreateEvent and the embedded EventForm
// reads the household roster; stub both so no network is touched.
const mutateAsync = vi.fn();
vi.mock('@/hooks/use-calendar', () => ({
  useCreateEvent: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/hooks/use-household', () => ({
  useHouseholdMembers: () => ({ data: { data: [] } }),
}));

import AddEventOverlay from './add-event-overlay';

beforeEach(() => { mutateAsync.mockReset(); });
afterEach(cleanup);

function renderOverlay(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <AddEventOverlay date="2026-07-21" onClose={onClose} />
    </ToastProvider>,
  );
  return onClose;
}

describe('AddEventOverlay', () => {
  it('renders a modal dialog with the tapped day pre-filled into the form', () => {
    renderOverlay();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Add event' })).toBeInTheDocument();
    // Not today (fixed past date) → the default morning slot on that day.
    expect(screen.getByLabelText('Start *')).toHaveValue('2026-07-21T09:00');
    expect(screen.getByLabelText('End *')).toHaveValue('2026-07-21T10:00');
  });

  it('submits the create mutation with ISO instants on the tapped day, then closes', async () => {
    mutateAsync.mockResolvedValue({ data: { id: 'e1' } });
    const user = userEvent.setup();
    const onClose = renderOverlay();

    await user.type(screen.getByLabelText('Title *'), 'Dentist');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const input = mutateAsync.mock.calls[0]![0];
    expect(input.title).toBe('Dentist');
    expect(new Date(input.startAt).getTime()).toBe(new Date('2026-07-21T09:00:00').getTime());
    expect(new Date(input.endAt).getTime()).toBe(new Date('2026-07-21T10:00:00').getTime());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open and surfaces an error toast when the create fails', async () => {
    mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const onClose = renderOverlay();

    await user.type(screen.getByLabelText('Title *'), 'Dentist');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Could not add the event — try again.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes via the big corner X — and only via explicit controls (no Escape)', async () => {
    const user = userEvent.setup();
    const onClose = renderOverlay();

    // Escape must NOT close the wall overlay (accidental-dismiss protection).
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
