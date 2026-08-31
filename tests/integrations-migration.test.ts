import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { integrationSyncState } from '../src/integrations/schema.js';
import { feedKeys } from '../src/integrations/feed-keys.js';
import { taskMirror } from '../src/modules/tasks/schema.js';
import { calendarMirrorEvents } from '../src/modules/calendar/mirror-schema.js';
import { weorcRoutines, weorcOccurrences } from '../src/modules/weorc/schema.js';
import { seedTestHousehold } from './helpers.js';

/** The real migration, read from disk — NOT a copy. A copy would let the
 *  checked-in migration rot silently while the test stayed green. */
async function runPrefixMigration(): Promise<void> {
  const path = fileURLToPath(
    new URL('../src/db/migrations/0024_prefixed_feed_keys.sql', import.meta.url),
  );
  const ddl = await readFile(path, 'utf8');
  // Guard against an empty (or gutted) file: it would execute as a no-op and
  // let every assertion below pass vacuously.
  expect(ddl).toContain('integration_sync_state');
  expect(ddl).toContain("'m365:'");
  await db.execute(sql.raw(ddl));
}

describe('feed-key prefix migration', () => {
  it('rewrites legacy unprefixed keys to their m365 form', async () => {
    // Simulate rows written before the prefix convention existed.
    await db.insert(integrationSyncState).values([
      { feedKey: 'calendar:member:abc', syncToken: 't1' },
      { feedKey: 'calendar:family', syncToken: 't2' },
      { feedKey: 'todo:member:abc:list1', syncToken: 't3' },
    ]);

    // Run the actual checked-in migration file against the seeded rows.
    await runPrefixMigration();

    const rows = await db.select().from(integrationSyncState);
    const keys = rows.map((r) => r.feedKey).sort();
    expect(keys).toEqual([
      'm365:calendar:family',
      'm365:calendar:member:abc',
      'm365:todo:member:abc:list1',
    ]);
    // Tokens must survive the rewrite — losing one silently forces a full resync.
    expect(rows.find((r) => r.feedKey === 'm365:calendar:family')!.syncToken).toBe('t2');
  });

  it('rewrites unprefixed keys on all four surfaces that persist a feed key', async () => {
    // Four tables persist a feed key, not one: integration_sync_state was the
    // only one the original migration touched, which is exactly why 110 rows
    // stranded on a real upgrade went unnoticed here.
    const { adult } = await seedTestHousehold();

    await db.insert(integrationSyncState).values([
      { feedKey: 'calendar:family', syncToken: 't1' },
    ]);
    await db.insert(taskMirror).values([
      {
        source: 'm365', feedKey: `todo:member:${adult.user.id}:list1`, externalId: 'ext-task-1',
        memberId: adult.user.id, listId: 'list1', title: 'Legacy task',
      },
    ]);
    await db.insert(calendarMirrorEvents).values([
      {
        source: 'm365', feedKey: 'calendar:family', externalId: 'ext-event-1',
        title: 'Legacy event',
        startAt: new Date('2026-09-01T10:00:00Z'), endAt: new Date('2026-09-01T11:00:00Z'),
      },
    ]);
    const routine = (await db.insert(weorcRoutines).values({
      name: 'Service the boiler', mode: 'fixed', intervalUnit: 'month',
      intervalCount: 12, anchorDate: '2026-09-01',
    }).returning())[0]!;
    await db.insert(weorcOccurrences).values([
      // Prefixed via a real projection: the link must survive the migration.
      {
        routineId: routine.id, dueOn: '2026-09-01',
        taskFeedKey: `todo:member:${adult.user.id}:list1`, taskExternalId: 'ext-task-1',
      },
      // No projection yet: a null task_feed_key must stay null.
      { routineId: routine.id, dueOn: '2026-10-01', status: 'skipped' },
    ]);

    await runPrefixMigration();

    const [syncRows, taskRows, eventRows, occRows] = await Promise.all([
      db.select().from(integrationSyncState),
      db.select().from(taskMirror),
      db.select().from(calendarMirrorEvents),
      db.select().from(weorcOccurrences),
    ]);

    expect(syncRows.map((r) => r.feedKey)).toEqual(['m365:calendar:family']);
    expect(taskRows.map((r) => r.feedKey)).toEqual([`m365:todo:member:${adult.user.id}:list1`]);
    expect(eventRows.map((r) => r.feedKey)).toEqual(['m365:calendar:family']);

    const byDueOn = (r: (typeof occRows)[number]) => r.dueOn;
    const projected = occRows.find((r) => byDueOn(r) === '2026-09-01')!;
    const unprojected = occRows.find((r) => byDueOn(r) === '2026-10-01')!;
    expect(projected.taskFeedKey).toBe(`m365:todo:member:${adult.user.id}:list1`);
    expect(unprojected.taskFeedKey).toBeNull();
  });

  it('is idempotent — a second run does not double-prefix', async () => {
    await db.insert(integrationSyncState).values([
      { feedKey: feedKeys.calendarFamily('m365'), syncToken: 't1' },
    ]);

    await runPrefixMigration();

    const rows = await db.select().from(integrationSyncState);
    expect(rows.map((r) => r.feedKey)).toEqual(['m365:calendar:family']);
  });

  it('builds prefixed keys from the helpers', () => {
    expect(feedKeys.calendarMember('m365', 'abc')).toBe('m365:calendar:member:abc');
    expect(feedKeys.calendarFamily('google')).toBe('google:calendar:family');
    expect(feedKeys.todoMember('google', 'abc', 'l1')).toBe('google:todo:member:abc:l1');
    expect(feedKeys.calendarList('google', 'abc', 'c1')).toBe('google:calendar:member:abc:c1');
  });
});
