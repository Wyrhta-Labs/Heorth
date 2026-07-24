import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { M365Store } from '../src/m365/store.js';
import { m365Connections } from '../src/m365/schema.js';
import { feedKeys } from '../src/m365/feed-keys.js';
import { seedTestHousehold } from './helpers.js';

const store = new M365Store();

describe('m365 store', () => {
  it('encrypts the refresh token at rest (row is not plaintext)', async () => {
    const { adult } = await seedTestHousehold();
    const secret = 'super-secret-refresh-token';
    const pub = await store.upsertConnection({
      memberId: adult.user.id, accountUpn: 'adult@contoso.test', refreshToken: secret, scopes: 'User.Read',
    });
    // Public projection never carries token material.
    expect(pub).not.toHaveProperty('refreshTokenEncrypted');

    // The stored column is ciphertext, not the plaintext token.
    const [row] = await db.select().from(m365Connections).where(eq(m365Connections.memberId, adult.user.id));
    expect(row!.refreshTokenEncrypted).not.toContain(secret);
    expect(row!.refreshTokenEncrypted.split(':')).toHaveLength(3);

    // But the store can decrypt it back.
    expect(await store.getRefreshToken(adult.user.id)).toBe(secret);
  });

  it('upsert is idempotent per member (one row)', async () => {
    const { adult } = await seedTestHousehold();
    await store.upsertConnection({ memberId: adult.user.id, accountUpn: 'a@t', refreshToken: 'r1', scopes: '' });
    await store.upsertConnection({ memberId: adult.user.id, accountUpn: 'a@t', refreshToken: 'r2', scopes: '' });
    const rows = await db.select().from(m365Connections).where(eq(m365Connections.memberId, adult.user.id));
    expect(rows).toHaveLength(1);
    expect(await store.getRefreshToken(adult.user.id)).toBe('r2');
  });

  it('tracks generic per-feed sync state', async () => {
    const key = feedKeys.calendarFamily();
    await store.recordSyncSuccess(key, 'delta-token-1');
    let st = await store.getSyncState(key);
    expect(st!.deltaToken).toBe('delta-token-1');
    expect(st!.consecutiveFailures).toBe(0);

    await store.recordSyncFailure(key, 'boom');
    st = await store.getSyncState(key);
    expect(st!.consecutiveFailures).toBe(1);
    expect(st!.lastError).toBe('boom');

    await store.recordSyncSuccess(key, 'delta-token-2');
    st = await store.getSyncState(key);
    expect(st!.deltaToken).toBe('delta-token-2');
    expect(st!.consecutiveFailures).toBe(0);
    expect(st!.lastError).toBeNull();
  });
});
