import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState } from './error-state';

describe('ErrorState', () => {
  it('shows a default message and a retry button that invokes onRetry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState onRetry={onRetry} />);

    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a caller-supplied message', () => {
    render(<ErrorState message="Calendar is unavailable" onRetry={() => {}} />);
    expect(screen.getByText('Calendar is unavailable')).toBeInTheDocument();
  });

  it('omits the retry button when no onRetry is given', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});
