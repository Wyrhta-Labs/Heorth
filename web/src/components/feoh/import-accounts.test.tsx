import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Account, ImportAccountMapping } from '@/lib/types';

const useImportAccounts = vi.fn();
const upsert = vi.fn();
const remove = vi.fn();
vi.mock('@/hooks/use-feoh-import', () => ({
  useImportAccounts: () => useImportAccounts(),
  useUpsertAccountMapping: () => ({ mutateAsync: upsert, isPending: false }),
  useDeleteAccountMapping: () => ({ mutate: remove, isPending: false }),
}));
const useAccounts = vi.fn();
vi.mock('@/hooks/use-feoh', () => ({ useAccounts: () => useAccounts() }));
const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

import ImportAccounts from './import-accounts';

const joint: Account = { id: 'a1', createdAt: '', updatedAt: '', name: 'Joint', kind: 'asset', openingBalance: '0' };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ImportAccounts', () => {
  it('adds a mapping from the form', async () => {
    useImportAccounts.mockReturnValue({ data: { data: [] as ImportAccountMapping[] } });
    useAccounts.mockReturnValue({ data: { data: [joint] } });
    upsert.mockResolvedValue({});
    render(<ImportAccounts />);
    fireEvent.change(screen.getByLabelText('Source account id'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Feoh account'), { target: { value: 'a1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith({ sourceAccountId: '7', accountId: 'a1' }));
  });

  it('shows an error toast when the mapping is rejected', async () => {
    useImportAccounts.mockReturnValue({ data: { data: [] as ImportAccountMapping[] } });
    useAccounts.mockReturnValue({ data: { data: [joint] } });
    upsert.mockRejectedValue(new Error('boom'));
    render(<ImportAccounts />);
    fireEvent.change(screen.getByLabelText('Source account id'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Feoh account'), { target: { value: 'a1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('boom', 'error'));
  });
});
