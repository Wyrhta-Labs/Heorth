import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';

describe('health', () => {
  const app = createApp([]);

  it('returns ok from /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('ok');
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const res = await app.request('/api/v1/nope');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
