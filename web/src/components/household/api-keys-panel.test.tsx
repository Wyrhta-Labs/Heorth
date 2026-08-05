import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ApiKeysPanel from './api-keys-panel';

vi.mock('@/hooks/use-api-keys', () => ({
  useApiKeys: () => ({
    data: { data: [{ id: 'k1', name: 'agent', keyPrefix: 'he_abc', lastUsedAt: null }] },
  }),
  useCreateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

  it('hides create and revoke when read-only', () => {
    render(<ApiKeysPanel readOnly />);
    expect(screen.queryByRole('button', { name: /new key/i })).not.toBeInTheDocument();
    // The key itself is still listed; only the mutating controls are gone.
    expect(screen.getByText('agent')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
