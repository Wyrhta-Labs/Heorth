import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { IntegrationStore } from '../src/integrations/store.js';
import { integrationConnections } from '../src/integrations/schema.js';
import { seedTestHousehold } from './helpers.js';

const m365 = new IntegrationStore('m365');
const google = new IntegrationStore('google');

describe('IntegrationStore', () => {
  it('keeps one connection per member PER PROVIDER', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r-m365', scopes: '',
    });
    await google.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r-google', scopes: '',
    });

    const rows = await db.select().from(integrationConnections)
      .where(eq(integrationConnections.memberId, adult.user.id));
    expect(rows).toHaveLength(2);

    expect(await m365.getRefreshToken(adult.user.id)).toBe('r-m365');
    expect(await google.getRefreshToken(adult.user.id)).toBe('r-google');
  });

  it('scopes reads to its own provider', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r1', scopes: '',
    });

    expect(await m365.getConnection(adult.user.id)).not.toBeNull();
    expect(await google.getConnection(adult.user.id)).toBeNull();
    expect(await google.listConnections()).toHaveLength(0);
  });

  it('upsert is idempotent within a provider', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r1', scopes: '',
    });
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r2', scopes: '',
    });

    const rows = await db.select().from(integrationConnections)
      .where(and(
        eq(integrationConnections.memberId, adult.user.id),
        eq(integrationConnections.provider, 'm365'),
      ));
    expect(rows).toHaveLength(1);
    expect(await m365.getRefreshToken(adult.user.id)).toBe('r2');
  });

  it('encrypts the refresh token at rest and never exposes it', async () => {
    const { adult } = await seedTestHousehold();
    const secret = 'super-secret-refresh-token';
    const pub = await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: secret, scopes: 'User.Read',
    });
    expect(pub).not.toHaveProperty('refreshTokenEncrypted');

    const [row] = await db.select().from(integrationConnections)
      .where(eq(integrationConnections.memberId, adult.user.id));
    expect(row!.refreshTokenEncrypted).not.toContain(secret);
    expect(row!.refreshTokenEncrypted.split(':')).toHaveLength(3);
  });

  it('deletes only its own provider connection', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r1', scopes: '',
    });
    await google.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r2', scopes: '',
    });

    expect(await google.deleteConnection(adult.user.id)).toBe(true);
    expect(await google.getConnection(adult.user.id)).toBeNull();
    expect(await m365.getConnection(adult.user.id)).not.toBeNull();
  });

  it('listSyncState returns every provider feed (household-wide staleness)', async () => {
    await m365.recordSyncSuccess('m365:calendar:family', 'tok-1');
    await google.recordSyncSuccess('google:calendar:member:x:cal1', 'tok-2');

    const keys = (await m365.listSyncState()).map((r) => r.feedKey);
    expect(keys).toContain('m365:calendar:family');
    expect(keys).toContain('google:calendar:member:x:cal1');
  });

  it('records sync success, failure counters, and lastFullSyncAt only on full syncs', async () => {
    const key = 'm365:calendar:family';
    await m365.recordSyncSuccess(key, 'tok-1');
    let st = await m365.getSyncState(key);
    expect(st!.syncToken).toBe('tok-1');
    expect(st!.consecutiveFailures).toBe(0);
    expect(st!.lastFullSyncAt).toBeNull();

    await m365.recordSyncSuccess(key, 'tok-2', true);
    st = await m365.getSyncState(key);
    expect(st!.lastFullSyncAt).not.toBeNull();

    await m365.recordSyncFailure(key, 'needs_reauth');
    await m365.recordSyncFailure(key, 'needs_reauth');
    st = await m365.getSyncState(key);
    expect(st!.consecutiveFailures).toBe(2);
    expect(st!.lastError).toBe('needs_reauth');
  });
});
