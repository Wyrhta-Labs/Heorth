import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { taskMirror } from '../src/modules/tasks/schema.js';
import { setTaskProvider } from '../src/modules/tasks/provider.js';
import * as store from '../src/modules/weorc/store.js';
import { runWeorcTick } from '../src/modules/weorc/engine.js';
import { householdToday } from '../src/modules/weorc/dates.js';
import { seedTestHousehold } from './helpers.js';
import { addDays, nextDueOn } from '../src/modules/weorc/recurrence.js';

describe('the tick with NO provider - the demo stack, permanently', () => {
  beforeEach(() => setTaskProvider(null));

  it('materialises a due occurrence and records NO projection error', async () => {
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const result = await runWeorcTick();
    expect(result.materialised).toBe(1);
    expect(result.projected).toBe(0);
    expect(result.projectionFailures).toBe(0);

    const open = await store.getOpenOccurrence(r.id);
    expect(open!.dueOn).toBe(today);
    // Absent is not an error: nothing to see, nothing to alarm the household.
    expect(open!.projectionError).toBeNull();
  });

  it('does NOT materialise beyond the lead horizon', async () => {
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Boiler', mode: 'from_completion', intervalUnit: 'month', intervalCount: 12,
      anchorDate: addDays(today, 30), leadDays: 14,
    });
    await runWeorcTick();
    expect(await store.getOpenOccurrence(r.id)).toBeNull();
  });

  it('DOES materialise inside the lead horizon', async () => {
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Boiler', mode: 'from_completion', intervalUnit: 'month', intervalCount: 12,
      anchorDate: addDays(today, 10), leadDays: 14,
    });
    await runWeorcTick();
    expect((await store.getOpenOccurrence(r.id))!.dueOn).toBe(addDays(today, 10));
  });

  it('skips inactive routines', async () => {
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Off', mode: 'fixed', intervalUnit: 'week', intervalCount: 1,
      anchorDate: today, active: false,
    });
    await runWeorcTick();
    expect(await store.getOpenOccurrence(r.id)).toBeNull();
  });

  it('is idempotent - a second tick changes nothing', async () => {
    const today = await householdToday();
    await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    await runWeorcTick();
    const second = await runWeorcTick();
    expect(second.materialised).toBe(0);
  });
});

describe('the reconcile pass', () => {
  beforeEach(() => setTaskProvider(null));

  it('completes an occurrence but defers its successor outside the horizon', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const occ = await store.insertOccurrence(r.id, today);
    const feedKey = `todo:member:${adult.user.id}:list-1`;
    await store.setProjection(occ.id, feedKey, 'ext-1');
    const completedAt = new Date();
    await db.insert(taskMirror).values({
      source: 'm365', feedKey, externalId: 'ext-1', memberId: adult.user.id,
      listId: 'list-1', title: 'Bins', status: 'completed', completedAt,
    });

    const result = await runWeorcTick();
    expect(result.reconciled).toBe(1);
    expect(result.materialised).toBe(0);

    const done = await store.getOccurrence(occ.id);
    expect(done!.status).toBe('completed');
    const next = await store.getOpenOccurrence(r.id);
    expect(next).toBeNull();
    expect(nextDueOn({
      mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    }, done!.dueOn, today)).toBe(addDays(today, 7));
  });

  it('materialises the reconciled successor in the same tick when inside the horizon', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1,
      anchorDate: today, leadDays: 7,
    });
    const occ = await store.insertOccurrence(r.id, today);
    const feedKey = `todo:member:${adult.user.id}:list-1`;
    await store.setProjection(occ.id, feedKey, 'ext-1');
    const completedAt = new Date();
    await db.insert(taskMirror).values({
      source: 'm365', feedKey, externalId: 'ext-1', memberId: adult.user.id,
      listId: 'list-1', title: 'Bins', status: 'completed', completedAt,
    });

    const result = await runWeorcTick();
    expect(result.reconciled).toBe(1);
    expect(result.materialised).toBe(1);

    // Reconcile runs FIRST, so the admitted successor appears in the SAME tick.
    const next = await store.getOpenOccurrence(r.id);
    expect(next!.dueOn).toBe(addDays(today, 7));
  });

  it('does NOTHING when the mirror row is absent - that is not a deletion', async () => {
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const occ = await store.insertOccurrence(r.id, today);
    await store.setProjection(occ.id, 'todo:member:gone:list-1', 'ext-vanished');

    const result = await runWeorcTick();
    expect(result.reconciled).toBe(0);

    // De-allowlisting a list drops a whole feed's mirror rows. Treating that as
    // "deleted upstream" would clear the link and spawn a duplicate task for
    // every projected occurrence at once.
    const still = await store.getOccurrence(occ.id);
    expect(still!.status).toBe('due');
    expect(still!.taskExternalId).toBe('ext-vanished');
  });
});
