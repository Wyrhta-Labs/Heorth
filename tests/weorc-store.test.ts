import { describe, it, expect } from 'vitest';
import * as store from '../src/modules/weorc/store.js';

async function aRoutine(over = {}) {
  return store.createRoutine({
    name: 'Bins', mode: 'fixed', intervalUnit: 'week',
    intervalCount: 1, anchorDate: '2026-09-01', ...over,
  });
}

describe('weorc store', () => {
  it('inserting the same due date twice yields ONE row and does not throw', async () => {
    const r = await aRoutine();
    const first = await store.insertOccurrence(r.id, '2026-09-01');
    const second = await store.insertOccurrence(r.id, '2026-09-01');
    expect(second.id).toBe(first.id);
    expect(await store.listOccurrences({ routineId: r.id })).toHaveLength(1);
  });

  it('a second OPEN occurrence at a different date also does not throw', async () => {
    const r = await aRoutine();
    const first = await store.insertOccurrence(r.id, '2026-09-01');
    const second = await store.insertOccurrence(r.id, '2026-09-08');
    // The partial unique index refuses it; the store swallows the conflict and
    // returns the occurrence that IS open, so a racing tick is a no-op.
    expect(second.id).toBe(first.id);
  });

  it('finds active routines with no open occurrence', async () => {
    const a = await aRoutine({ name: 'Open' });
    await aRoutine({ name: 'None' });
    await aRoutine({ name: 'Inactive', active: false });
    await store.insertOccurrence(a.id, '2026-09-01');
    const rows = await store.activeRoutinesWithoutOpenOccurrence();
    expect(rows.map((r) => r.name)).toEqual(['None']);
  });

  it('terminating an occurrence records who and when', async () => {
    const r = await aRoutine();
    const occ = await store.insertOccurrence(r.id, '2026-09-01');
    const at = new Date('2026-09-01T09:00:00Z');
    const done = await store.terminateOccurrence(occ.id, 'completed', at, null, 'took two bags');
    expect(done!.status).toBe('completed');
    expect(done!.completedAt!.toISOString()).toBe(at.toISOString());
    expect(done!.note).toBe('took two bags');
    expect(await store.hasTerminalOccurrence(r.id)).toBe(true);
  });

  it('skipping records no completedAt', async () => {
    const r = await aRoutine();
    const occ = await store.insertOccurrence(r.id, '2026-09-01');
    const skipped = await store.terminateOccurrence(occ.id, 'skipped', null, null, 'away');
    expect(skipped!.status).toBe('skipped');
    expect(skipped!.completedAt).toBeNull();
  });

  it('lastTerminalOccurrence returns the newest by dueOn', async () => {
    const r = await aRoutine();
    const one = await store.insertOccurrence(r.id, '2026-09-01');
    await store.terminateOccurrence(one.id, 'skipped', null, null, null);
    const two = await store.insertOccurrence(r.id, '2026-09-08');
    await store.terminateOccurrence(two.id, 'skipped', null, null, null);
    expect((await store.lastTerminalOccurrence(r.id))!.dueOn).toBe('2026-09-08');
  });

  it('listTerminalOccurrences orders newest-first with the limit applied AFTER filtering to terminal rows', async () => {
    const r = await aRoutine();
    const dates = ['2026-09-01', '2026-09-08', '2026-09-15'];
    for (const d of dates) {
      const occ = await store.insertOccurrence(r.id, d);
      await store.terminateOccurrence(occ.id, 'skipped', null, null, null);
    }
    // A 4th, still-open occurrence must never displace a terminal row out of a
    // small limit - the generic ascending list-then-limit would let it.
    await store.insertOccurrence(r.id, '2026-09-22');

    const top2 = await store.listTerminalOccurrences(r.id, 2);
    expect(top2.map((o) => o.dueOn)).toEqual(['2026-09-15', '2026-09-08']);
  });

  it('refuses nothing at the store layer - delete is a plain delete', async () => {
    const r = await aRoutine();
    expect(await store.deleteRoutine(r.id)).toBe(true);
    expect(await store.getRoutine(r.id)).toBeNull();
  });
});
