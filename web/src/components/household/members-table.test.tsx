import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MembersTable from './members-table';
import type { Member } from '@/lib/types';

const member = (over: Partial<Member>): Member => ({
  id: 'm1', createdAt: '', updatedAt: '', email: 'a@h.io', handle: null,
  role: 'adult', displayName: 'Ada', avatarColor: 'ember', ...over,
});

describe('MembersTable', () => {
  it('shows a role dropdown when the caller can manage', () => {
    render(<MembersTable members={[member({})]} canManage onEdit={vi.fn()} onRole={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows a read-only role badge when the caller cannot manage', () => {
    render(<MembersTable members={[member({})]} canManage={false} onEdit={vi.fn()} onRole={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('adult')).toBeInTheDocument();
  });
});
