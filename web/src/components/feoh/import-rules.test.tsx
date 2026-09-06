import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ImportRule, Envelope } from '@/lib/types';

const useImportRules = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
vi.mock('@/hooks/use-feoh-import', () => ({
  useImportRules: () => useImportRules(),
  useCreateRule: () => ({ mutateAsync: create, isPending: false }),
  useUpdateRule: () => ({ mutate: update, isPending: false }),
  useDeleteRule: () => ({ mutate: remove, isPending: false }),
}));
const useEnvelopes = vi.fn();
vi.mock('@/hooks/use-feoh', () => ({ useEnvelopes: () => useEnvelopes() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import ImportRules from './import-rules';

const groceries: Envelope = { id: 'e1', createdAt: '', updatedAt: '', name: 'Groceries', monthlyBudget: '400', tone: null };
const rule: ImportRule = { id: 'k1', createdAt: '', updatedAt: '', pattern: 'rewe', envelopeId: 'e1', priority: 0, enabled: true, createdBy: 'u1' };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ImportRules', () => {
  it('lists rules with their envelope name and toggles / removes them', () => {
    useImportRules.mockReturnValue({ data: { data: [rule] } });
    useEnvelopes.mockReturnValue({ data: { data: [groceries] } });
    render(<ImportRules />);
    expect(screen.getByText('rewe')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(update).toHaveBeenCalledWith({ id: 'k1', input: { enabled: false } }, expect.objectContaining({ onError: expect.any(Function) }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(remove).toHaveBeenCalledWith('k1', expect.objectContaining({ onError: expect.any(Function) }));
  });

  it('adds a rule from the form', async () => {
    useImportRules.mockReturnValue({ data: { data: [] } });
    useEnvelopes.mockReturnValue({ data: { data: [groceries] } });
    create.mockResolvedValue({});
    render(<ImportRules />);
    expect(screen.getByText('No rules yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payee contains'), { target: { value: 'Aldi' } });
    fireEvent.change(screen.getByLabelText('Envelope'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ pattern: 'Aldi', envelopeId: 'e1', priority: 3 }));
  });
});
