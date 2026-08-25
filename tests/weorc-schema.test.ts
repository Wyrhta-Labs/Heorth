import { describe, it, expect } from 'vitest';
import { db } from '../src/db/index.js';
import { weorcRoutines, weorcOccurrences } from '../src/modules/weorc/schema.js';
import { ethelAssets, ethelPlaces } from '../src/modules/ethel/schema.js';

async function routine(over: Partial<typeof weorcRoutines.$inferInsert> = {}) {
  const [row] = await db.insert(weorcRoutines).values({
    name: 'Put the bins out', mode: 'fixed', intervalUnit: 'week',
    intervalCount: 1, anchorDate: '2026-09-01', ...over,
  }).returning();
  return row!;
}

describe('weorc_routines schema', () => {
  it('inserts an unanchored routine — the normal case', async () => {
    const r = await routine();
    expect(r.anchorAssetId).toBeNull();
    expect(r.anchorPlaceId).toBeNull();
    expect(r.active).toBe(true);
    expect(r.leadDays).toBe(0);
  });

  it('rejects an unknown mode', async () => {
    await expect(routine({ mode: 'whenever' as never })).rejects.toThrow();
  });

  it('rejects a non-positive interval', async () => {
    await expect(routine({ intervalCount: 0 })).rejects.toThrow();
  });

  it('rejects negative leadDays', async () => {
    await expect(routine({ leadDays: -1 })).rejects.toThrow();
  });

  it('rejects two anchors at once', async () => {
    const [a] = await db.insert(ethelAssets).values({ name: 'Boiler' }).returning();
    const [p] = await db.insert(ethelPlaces).values({ name: 'Utility', kind: 'room' }).returning();
    await expect(routine({ anchorAssetId: a!.id, anchorPlaceId: p!.id })).rejects.toThrow();
  });

  it('keeps the routine when its anchor asset is deleted', async () => {
    const [a] = await db.insert(ethelAssets).values({ name: 'Kettle' }).returning();
    const r = await routine({ anchorAssetId: a!.id });
    await db.delete(ethelAssets);
    const [after] = await db.select().from(weorcRoutines);
    expect(after!.id).toBe(r.id);
    expect(after!.anchorAssetId).toBeNull();
  });
});

describe('weorc_occurrences schema', () => {
  it('allows only ONE open occurrence per routine', async () => {
    const r = await routine();
    await db.insert(weorcOccurrences).values({ routineId: r.id, dueOn: '2026-09-01' });
    await expect(
      db.insert(weorcOccurrences).values({ routineId: r.id, dueOn: '2026-09-08' }),
    ).rejects.toThrow();
  });

  it('allows many TERMINAL occurrences per routine', async () => {
    const r = await routine();
    await db.insert(weorcOccurrences).values({
      routineId: r.id, dueOn: '2026-09-01', status: 'completed', completedAt: new Date(),
    });
    await db.insert(weorcOccurrences).values({ routineId: r.id, dueOn: '2026-09-08', status: 'skipped' });
    const rows = await db.select().from(weorcOccurrences);
    expect(rows).toHaveLength(2);
  });

  it('rejects the same dueOn twice for one routine', async () => {
    const r = await routine();
    await db.insert(weorcOccurrences).values({ routineId: r.id, dueOn: '2026-09-01', status: 'skipped' });
    await expect(
      db.insert(weorcOccurrences).values({ routineId: r.id, dueOn: '2026-09-01', status: 'skipped' }),
    ).rejects.toThrow();
  });

  it('rejects completed without completedAt, and skipped WITH it', async () => {
    const r = await routine();
    await expect(
      db.insert(weorcOccurrences).values({ routineId: r.id, dueOn: '2026-10-01', status: 'completed' }),
    ).rejects.toThrow();
    await expect(
      db.insert(weorcOccurrences).values({
        routineId: r.id, dueOn: '2026-10-02', status: 'skipped', completedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('rejects half a task link', async () => {
    const r = await routine();
    await expect(
      db.insert(weorcOccurrences).values({ routineId: r.id, dueOn: '2026-11-01', taskFeedKey: 'todo:member:x:y' }),
    ).rejects.toThrow();
  });
});
