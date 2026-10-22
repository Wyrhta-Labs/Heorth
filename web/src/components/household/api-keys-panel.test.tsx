import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ApiKeysPanel from './api-keys-panel';

// Shapes mirror @wyrhta/core identity: list rows carry `prefix`, and the create
// response carries the raw secret as `key` — returned exactly once.
const createKey = vi.fn(async (name: string) => ({
  data: { id: 'k2', name, prefix: 'he_new12345', key: 'he_new12345secret', createdAt: '2026-10-22T00:00:00Z' },
}));

vi.mock('@/hooks/use-api-keys', () => ({
  useApiKeys: () => ({
    data: { data: [{ id: 'k1', name: 'agent', prefix: 'he_abc', lastUsedAt: null, createdAt: '2026-10-01T00:00:00Z' }] },
  }),
  useCreateApiKey: () => ({ mutateAsync: createKey, isPending: false }),
  useRevokeApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-formatters', () => ({ useFormatters: () => ({ formatDate: (s: string) => s }) }));

afterEach(() => cleanup());

describe('ApiKeysPanel', () => {
  it('offers create and revoke by default', () => {
    render(<ApiKeysPanel />);
    expect(screen.getByRole('button', { name: /new key/i })).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();
  });

  it('shows the display prefix of each key', () => {
    render(<ApiKeysPanel />);
    expect(screen.getByText('he_abc…')).toBeInTheDocument();
  });

  it('shows the raw key once after creating one', async () => {
    render(<ApiKeysPanel />);
    fireEvent.click(screen.getByRole('button', { name: /new key/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'claude' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText('he_new12345secret')).toBeInTheDocument();
  });

  it('hides create and revoke when read-only', () => {
    render(<ApiKeysPanel readOnly />);
    expect(screen.queryByRole('button', { name: /new key/i })).not.toBeInTheDocument();
    // The key itself is still listed; only the mutating controls are gone.
    expect(screen.getByText('agent')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
