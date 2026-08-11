import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DisplayPrefsModal from './display-prefs-modal';
import type { HearthDisplayPrefs } from '@/lib/hearth-prefs';

const ALL_ON: HearthDisplayPrefs = { kithReminders: true, tasks: true, meals: true, staleFooter: true };

const setup = (over: Partial<React.ComponentProps<typeof DisplayPrefsModal>> = {}) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<DisplayPrefsModal prefs={ALL_ON} showKithRow onChange={onChange} onClose={onClose} {...over} />);
  return { onChange, onClose };
};

afterEach(cleanup);

describe('DisplayPrefsModal', () => {
  it('renders a labelled dialog with all four rows pressed ON', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Display settings' })).toBeInTheDocument();
    for (const name of ['Reminders', 'Tasks', 'Meals & supper', 'Sync status']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('omits the reminders row when showKithRow is false', () => {
    setup({ showKithRow: false });
    expect(screen.queryByRole('button', { name: 'Reminders' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('reports a single-field patch when a row is tapped', () => {
    const { onChange, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(onChange).toHaveBeenCalledWith({ tasks: false });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reflects OFF state via aria-pressed', () => {
    setup({ prefs: { ...ALL_ON, meals: false } });
    expect(screen.getByRole('button', { name: 'Meals & supper' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes via the X button', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Display settings' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a direct backdrop tap but NOT on taps inside the dialog', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('dialog', { name: 'Display settings' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('display-prefs-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the close button on open', () => {
    setup();
    expect(screen.getByLabelText('Close')).toHaveFocus();
  });

  it('traps Tab: shift-Tab from the close button wraps to the last row', () => {
    setup();
    fireEvent.keyDown(screen.getByLabelText('Close'), { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Sync status' })).toHaveFocus();
  });
});
