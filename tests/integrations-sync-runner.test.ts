import { describe, it, expect } from 'vitest';
import { IntegrationStore } from '../src/integrations/store.js';
import {
  syncOneFeed, isFullResyncDue, DEFAULT_FULL_RESYNC_INTERVAL_MS,
} from '../src/integrations/sync-runner.js';
import { seedTestHousehold } from './helpers.js';

const store = new IntegrationStore('m365');

/** A classifier with no knowledge of Graph — proves the seam is real. */
const classifyError = (e: unknown): string =>
  e instanceof Error && e.message.startsWith('boom') ? 'test_reason' : 'error';

const deps = { store, classifyError, fullResyncIntervalMs: DEFAULT_FULL_RESYNC_INTERVAL_MS };

const ok = { nextToken: 'tok', fullResync: false, upserted: 2, deleted: 0 };

describe('syncOneFeed', () => {
  it('skips a member feed with no connection, without calling the provider', async () => {
    const { adult } = await seedTestHousehold();
    let called = false;
    const res = await syncOneFeed(deps, { feedKey: 'm365:todo:member:x:l', memberId: adult.user.id },
      async () => { called = true; return ok; });

    expect(res).toEqual({ feedKey: 'm365:todo:member:x:l', status: 'skipped', reason: 'no_connection' });
    expect(called).toBe(false);
  });

  it('skips a needs_reauth connection and records the failure', async () => {
    const { adult } = await seedTestHousehold();
    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r', scopes: '',
    });
    await store.recordRefreshError(adult.user.id, 'rejected', 'needs_reauth');

    let called = false;
    const res = await syncOneFeed(deps, { feedKey: 'm365:todo:member:y:l', memberId: adult.user.id },
      async () => { called = true; return ok; });

    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('needs_reauth');
    expect(called).toBe(false);
    expect((await store.getSyncState('m365:todo:member:y:l'))!.consecutiveFailures).toBe(1);
  });

  it('runs an app-only feed (memberId null) with no connection check', async () => {
    const res = await syncOneFeed(deps, { feedKey: 'm365:calendar:family', memberId: null },
      async () => ok);

    expect(res).toEqual({
      feedKey: 'm365:calendar:family', status: 'ok', upserted: 2, deleted: 0,
    });
    expect((await store.getSyncState('m365:calendar:family'))!.syncToken).toBe('tok');
  });

  it('classifies an error through the injected classifier, never Graph', async () => {
    const res = await syncOneFeed(deps, { feedKey: 'm365:calendar:family', memberId: null },
      async () => { throw new Error('boom-upstream'); });

    expect(res.status).toBe('error');
    expect(res.reason).toBe('test_reason');
    expect((await store.getSyncState('m365:calendar:family'))!.lastError).toBe('test_reason');
  });

  it('forces a full resync when the feed has never done one', async () => {
    let sawForce: boolean | null = null;
    await syncOneFeed(deps, { feedKey: 'm365:calendar:family', memberId: null },
      async (_token, force) => { sawForce = force; return { ...ok, fullResync: true }; });

    expect(sawForce).toBe(true);
    expect((await store.getSyncState('m365:calendar:family'))!.lastFullSyncAt).not.toBeNull();
  });

  it('honours a provider-supplied resync interval', () => {
    const now = new Date('2026-03-02T00:00:00Z');
    const oneDayAgo = new Date('2026-03-01T00:00:00Z');
    expect(isFullResyncDue(null, now, 1000)).toBe(true);
    expect(isFullResyncDue(oneDayAgo, now, 7 * 24 * 3600 * 1000)).toBe(false);
    expect(isFullResyncDue(oneDayAgo, now, 60 * 1000)).toBe(true);
  });
});
