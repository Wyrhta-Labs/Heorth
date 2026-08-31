import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { taskMirror } from '../src/modules/tasks/schema.js';
import { clearProviders } from '../src/integrations/registry.js';
import * as store from '../src/modules/weorc/store.js';
import { runWeorcTick, advanceRoutine, occurrenceMarker } from '../src/modules/weorc/engine.js';
import { householdToday, householdMidnightUtc } from '../src/modules/weorc/dates.js';
import { seedTestHousehold } from './helpers.js';
import { addDays, nextDueOn } from '../src/modules/weorc/recurrence.js';

describe('the tick with NO provider - the demo stack, permanently', () => {
  beforeEach(() => clearProviders());

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
  beforeEach(() => clearProviders());

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

  it('RELINKS to the marker row found in a different feed when a task was moved between lists', async () => {
    const { adult } = await seedTestHousehold();
    const today = await householdToday();
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: today,
    });
    const occ = await store.insertOccurrence(r.id, today);
    // The occurrence is linked to a feed whose mirror row is now gone (moved to
    // a different list), but a mirror row carrying its marker exists elsewhere -
    // a full resync would produce exactly this shape.
    await store.setProjection(occ.id, 'todo:member:old:list-1', 'ext-old');
    await db.insert(taskMirror).values({
      source: 'm365', feedKey: 'todo:member:new:list-2', externalId: 'ext-new',
      memberId: adult.user.id, listId: 'list-2', title: 'Bins',
      notes: occurrenceMarker(occ.id), status: 'open',
    });

    const result = await runWeorcTick();

    // No new task was created - only the one mirror row from the "move" exists.
    const mirrorRows = await db.select().from(taskMirror);
    expect(mirrorRows.length).toBe(1);

    const relinked = await store.getOccurrence(occ.id);
    expect(relinked!.taskFeedKey).toBe('todo:member:new:list-2');
    expect(relinked!.taskExternalId).toBe('ext-new');
    expect(relinked!.status).toBe('due');
    void result;
  });
});

describe('fixed mode must never drift on a late completion', () => {
  beforeEach(() => clearProviders());

  it('a weekly fixed routine completed 14 days late is next due on the completion day, not a week past it', async () => {
    // Worked example from the spec: grid origin/last due 2026-08-11, completed
    // late on 2026-08-25. The next grid slot after 08-11 fast-forwards to
    // 08-25 (08-18's successor, 08-25, is not in the future); it must NOT be
    // computed from the completion date itself, which would jump to 09-01.
    const r = await store.createRoutine({
      name: 'Bins', mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: '2026-08-11',
    });
    const occ = await store.insertOccurrence(r.id, '2026-08-11');
    await store.terminateOccurrence(
      occ.id, 'completed', await householdMidnightUtc('2026-08-25'), null, null,
    );

    const next = await advanceRoutine(r.id, '2026-08-25');
    expect(next).not.toBeNull();
    expect(next!.dueOn).toBe('2026-08-25');
  });
});
