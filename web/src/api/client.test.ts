import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiGet, TOKEN_KEY } from './client';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('apiGet on 401', () => {
  it('clears the token and throws UNAUTHORIZED', async () => {
    localStorage.setItem(TOKEN_KEY, 'stale');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    await expect(apiGet('/feoh/ingestion/status')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
