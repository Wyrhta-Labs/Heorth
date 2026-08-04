import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createApp } from '../src/app.js';
import { MaintenanceAdminError } from '../src/household/maintenance-admin.js';

describe('MaintenanceAdminError mapping', () => {
  it('maps a thrown MaintenanceAdminError to 403 with its code', async () => {
    const app = createApp([]);
    app.get('/boom', () => { throw new MaintenanceAdminError('ADMIN_NOT_A_MEMBER'); });

    const res = await app.request('/boom');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ADMIN_NOT_A_MEMBER');
    expect(body.error.message).toContain('maintenance account');
  });

  it('maps ADMIN_PROTECTED too', async () => {
    const app = createApp([]);
    app.get('/boom', () => { throw new MaintenanceAdminError('ADMIN_PROTECTED', 'Nope'); });

    const res = await app.request('/boom');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('still delegates unknown errors to core (500, no detail leak)', async () => {
    const app = createApp([]);
    app.get('/boom', () => { throw new Error('secret internal detail'); });

    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});
