import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventForm from './event-form';

vi.mock('@/hooks/use-household', () => ({
  useHouseholdMembers: () => ({
    data: { data: [
      { id: 'b', role: 'adult', displayName: 'Anna', avatarColor: 'sage' },
      { id: 'c', role: 'child', displayName: 'Kim', avatarColor: 'sky' },
    ] },
  }),
}));

describe('EventForm attendees', () => {
  it('never offers the maintenance admin as an attendee', () => {
    render(<EventForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('Kim')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
