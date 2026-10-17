import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemberForm from './member-form';
import type { Member } from '@/lib/types';

const member: Member = {
  id: 'm1', createdAt: '', updatedAt: '', email: 'a@h.io', handle: null,
  role: 'adult', displayName: 'Ada', avatarColor: 'ember',
};

describe('MemberForm', () => {
  it('rejects a too-short new password when editing instead of sending it', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<MemberForm member={member} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('New password (optional)'), 'short');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
  });

  it('submits an edit with the password left blank', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<MemberForm member={member} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ password: '' }));
  });
});
