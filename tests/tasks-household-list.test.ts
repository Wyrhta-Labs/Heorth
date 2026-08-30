import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { todoListAllowlist } from '../src/modules/tasks/schema.js';
import { getHouseholdFeed, setHouseholdList } from '../src/modules/tasks/store.js';
import { seedTestHousehold } from './helpers.js';

async function allowlist(memberId: string, provider: string, listId: string, name: string) {
  await db.insert(todoListAllowlist).values({ memberId, provider, listId, listName: name });
}

/**
 * The real migration's backfill statement, read from disk — NOT a copy. A copy
 * would let the checked-in migration rot silently while the test stayed green.
 *
 * Only the LAST statement (the backfill `UPDATE`) is executed: the migration's
 * earlier statements (`ALTER TABLE … ADD COLUMN`, `CREATE UNIQUE INDEX`) were
 * already applied by the standard migrator in `tests/setup.ts` — re-running them
 * here would fail on "column/index already exists", not exercise anything new.
 */
async function runHouseholdFlagBackfill(): Promise<void> {
  const path = fileURLToPath(
    new URL('../src/db/migrations/0026_household_list_flag.sql', import.meta.url),
  );
  const ddl = await readFile(path, 'utf8');
  const statements = ddl.split('--> statement-breakpoint');
  const backfill = statements[statements.length - 1]!;
  // Guard against an empty (or gutted) file: it would execute as a no-op and
  // let every assertion below pass vacuously.
  expect(backfill).toContain('is_household');
  expect(backfill).toContain('count(*)');
  await db.execute(sql.raw(backfill));
}

describe('household task list designation', () => {
  it('returns null when no list is designated', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');
    expect(await getHouseholdFeed()).toBeNull();
  });

  it('resolves the designated feed regardless of its display name', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Anything At All');
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    const feed = await getHouseholdFeed();
    expect(feed).toMatchObject({
      provider: 'm365',
      memberId: adult.user.id,
      listId: 'l1',
      feedKey: `m365:todo:member:${adult.user.id}:l1`,
    });
  });

  it('survives a rename at the source', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    // The member renames the list in Outlook; the next sync refreshes the cache.
    await db.update(todoListAllowlist).set({ listName: 'Haushalt' });

    expect(await getHouseholdFeed()).not.toBeNull();
  });

  it('allows at most one designated list household-wide', async () => {
    const { adult, admin } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'One');
    await allowlist(admin.user.id, 'google', 'l2', 'Two');

    await setHouseholdList(adult.user.id, 'm365', 'l1');
    await setHouseholdList(admin.user.id, 'google', 'l2');

    const flagged = await db.select().from(todoListAllowlist);
    expect(flagged.filter((r) => r.isHousehold)).toHaveLength(1);
    expect((await getHouseholdFeed())!.listId).toBe('l2');
  });

  it('clears the designation when the list leaves the allowlist', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    await db.delete(todoListAllowlist);
    expect(await getHouseholdFeed()).toBeNull();
  });
});

describe('migration 0026 backfill', () => {
  it('flags the sole allowlisted list when the household has exactly one', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');

    await runHouseholdFlagBackfill();

    const rows = await db.select().from(todoListAllowlist);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isHousehold).toBe(true);
    expect((await getHouseholdFeed())!.listId).toBe('l1');
  });

  it('flags nothing when the household has allowlisted more than one list', async () => {
    const { adult, admin } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'One');
    await allowlist(admin.user.id, 'google', 'l2', 'Two');

    await runHouseholdFlagBackfill();

    const rows = await db.select().from(todoListAllowlist);
    expect(rows.filter((r) => r.isHousehold)).toHaveLength(0);
    expect(await getHouseholdFeed()).toBeNull();
  });
});
