import { describe, it, expect, afterEach, vi } from 'vitest';
import { db } from '../src/db/index.js';
import { seedTestHousehold } from './helpers.js';
import * as feoh from '../src/modules/feoh/service.js';
import * as imp from '../src/modules/feoh/import/service.js';
import { runImportTick, getImportStatus, FEED_KEY, classifySourceError } from '../src/modules/feoh/import/sync.js';
import { setTransactionSourceProvider, resetTransactionSourceProvider } from '../src/modules/feoh/import/provider.js';
import { SourceProviderError } from '../src/modules/feoh/import/providers/types.js';
import { feohImportState, feohImportedTransactions } from '../src/modules/feoh/import/schema.js';
import { FakeSource, fakeLine } from './fake-source.js';

afterEach(() => {
  resetTransactionSourceProvider();
  vi.restoreAllMocks();
});

async function state() {
  const [row] = await db.select().from(feohImportState);
  return row!;
}

describe('runImportTick', () => {
  it('reports provider_unavailable and writes no state when import is disabled', async () => {
    const r = await runImportTick();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('provider_unavailable');
    expect(await db.select().from(feohImportState)).toHaveLength(0);
  });

  it('pulls every page of a sweep, ingests, and persists the checkpoint with a success stamp', async () => {
    await seedTestHousehold();
    const fake = new FakeSource();
    fake.rows = Array.from({ length: 250 }, (_, i) => fakeLine({ sourceId: `1:${i}`, date: '2026-09-01' }));
    setTransactionSourceProvider(fake);
    const r = await runImportTick();
    expect(r).toMatchObject({ ok: true, pages: 3, inserted: 250, booked: 0 });
    expect(fake.calls).toBe(3);
    const s = await state();
    expect(s.feedKey).toBe(FEED_KEY);
    expect(s.cursor).toBe('0'); // the fake's checkpoint
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.consecutiveFailures).toBe(0);
  });

  it('a second sweep over the same rows is a no-op (overlap replay is free)', async () => {
    await seedTestHousehold();
    const fake = new FakeSource();
    fake.rows = [fakeLine({ sourceId: '2:1' }), fakeLine({ sourceId: '2:2' })];
    setTransactionSourceProvider(fake);
    await runImportTick();
    const r = await runImportTick();
    expect(r).toMatchObject({ ok: true, inserted: 0, skipped: 2 });
    expect(await db.select().from(feohImportedTransactions)).toHaveLength(2);
  });

  it('books rule hits during the tick and counts them', async () => {
    const { adult } = await seedTestHousehold();
    const account = await feoh.createAccount({ name: 'Joint', kind: 'asset', openingBalance: 0 });
    const groceries = await feoh.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.createRule({ pattern: 'rewe', envelopeId: groceries.id }, adult.user.id);
    const fake = new FakeSource();
    fake.rows = [fakeLine({ sourceId: '3:1', payee: 'REWE' }), fakeLine({ sourceId: '3:2', payee: 'Aldi' })];
    setTransactionSourceProvider(fake);
    const r = await runImportTick();
    expect(r).toMatchObject({ ok: true, inserted: 2, booked: 1 });
  });

  it('never throws: a provider failure increments consecutive_failures and stores only the token', async () => {
    await seedTestHousehold();
    const fake = new FakeSource();
    fake.failWith = new SourceProviderError('auth_failed', 'HTTP 401 from https://firefly/api?token=SECRET');
    setTransactionSourceProvider(fake);
    const r1 = await runImportTick();
    expect(r1.ok).toBe(false);
    expect(r1.error).toBe('auth_failed');
    const r2 = await runImportTick();
    expect(r2.ok).toBe(false);
    const s = await state();
    expect(s.consecutiveFailures).toBe(2);
    expect(s.lastError).toBe('auth_failed');
    expect(s.lastSuccessAt).toBeNull();
    // a later success clears the failure state
    fake.failWith = null;
    await runImportTick();
    const after = await state();
    expect(after.consecutiveFailures).toBe(0);
    expect(after.lastError).toBeNull();
  });

  it('persists the mid-sweep cursor after each fully written page', async () => {
    await seedTestHousehold();
    const fake = new FakeSource();
    fake.rows = Array.from({ length: 150 }, (_, i) => fakeLine({ sourceId: `4:${i}` }));
    // fail on the second call, after the first page was written
    const original = fake.listSince.bind(fake);
    fake.listSince = async (cursor, limit) => {
      if (fake.calls === 1) { fake.calls++; throw new SourceProviderError('network_error'); }
      return original(cursor, limit);
    };
    setTransactionSourceProvider(fake);
    const r = await runImportTick();
    expect(r.ok).toBe(false);
    expect(r.inserted).toBe(100);
    expect((await state()).cursor).toBe('100');
    // the next tick resumes from that cursor and finishes the sweep
    const r2 = await runImportTick();
    expect(r2).toMatchObject({ ok: true, inserted: 50 });
    expect((await state()).cursor).toBe('0');
  });

  it('never rejects when the state read fails', async () => {
    await seedTestHousehold();
    const fake = new FakeSource();
    fake.rows = [fakeLine({ sourceId: '6:1' })];
    setTransactionSourceProvider(fake);
    // getOrCreateState's first call is db.select(...) — make it throw so the
    // sweep fails before it ever reaches the provider or ingest().
    vi.spyOn(db, 'select').mockImplementationOnce(() => { throw new Error('db down'); });
    await expect(runImportTick()).resolves.toMatchObject({ ok: false, error: 'error' });
  });
});

describe('runImportTick — one at a time', () => {
  it('a second tick while one is running answers already_running and leaves the feed state alone', async () => {
    await seedTestHousehold();
    const fake = new FakeSource();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = fake.listSince.bind(fake);
    fake.listSince = async (cursor, limit) => { await gate; return original(cursor, limit); };
    setTransactionSourceProvider(fake);
    const first = runImportTick();
    const second = await runImportTick();
    expect(second.error).toBe('already_running');
    release();
    expect((await first).ok).toBe(true);
    expect((await state()).consecutiveFailures).toBe(0);
    expect((await state()).lastError).toBeNull();
  });
});

describe('classifySourceError', () => {
  it('maps provider reasons, TypeError to network_error, everything else to error', () => {
    expect(classifySourceError(new SourceProviderError('rate_limited'))).toBe('rate_limited');
    expect(classifySourceError(new TypeError('fetch failed'))).toBe('network_error');
    expect(classifySourceError(new Error('boom'))).toBe('error');
  });
});

describe('getImportStatus', () => {
  it('reports disabled + no feed before any tick, and never the cursor text', async () => {
    const before = await getImportStatus();
    expect(before).toEqual({ enabled: false, currency: 'EUR', pendingCount: 0, feed: null });
    await seedTestHousehold();
    const fake = new FakeSource();
    fake.rows = [fakeLine({ sourceId: '5:1' })];
    setTransactionSourceProvider(fake);
    await runImportTick();
    const after = await getImportStatus();
    expect(after.enabled).toBe(true);
    expect(after.pendingCount).toBe(1);
    expect(after.feed).toMatchObject({ feedKey: FEED_KEY, hasCursor: true, consecutiveFailures: 0 });
    expect(JSON.stringify(after)).not.toContain('"cursor"');
  });
});
