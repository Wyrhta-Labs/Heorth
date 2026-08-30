import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { db } from '../src/db/index.js';
import { todoListAllowlist } from '../src/modules/tasks/schema.js';
import { getHouseholdFeed, setHouseholdList } from '../src/modules/tasks/store.js';
import { seedTestHousehold } from './helpers.js';

async function allowlist(memberId: string, provider: string, listId: string, name: string) {
  await db.insert(todoListAllowlist).values({ memberId, provider, listId, listName: name });
}

/**
 * The real migration file, read from disk — NOT a copy. A copy would let the
 * checked-in migration rot silently while the test stayed green.
 */
async function readHouseholdFlagMigration(): Promise<string> {
  const path = fileURLToPath(
    new URL('../src/db/migrations/0026_household_list_flag.sql', import.meta.url),
  );
  return readFile(path, 'utf8');
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

describe('migration 0026 ships no backfill', () => {
  // Both available inference strategies were unsafe (see the migration's own
  // comment): matching a display name needs a secret not available to a
  // migration, and flagging the sole allowlisted row guesses — if that row is
  // someone's PERSONAL list, household tasks would land there with no error at
  // all. So the shipped migration designates nothing, whatever the allowlist
  // holds, and an adult designates the real list explicitly afterward.
  it('the checked-in migration contains no data-mutating statement', async () => {
    const ddl = await readHouseholdFlagMigration();
    // Guard against an empty (or gutted) file: it would trivially "contain no
    // UPDATE" and let the assertion below pass vacuously.
    expect(ddl).toContain('is_household');
    expect(ddl.toUpperCase()).not.toMatch(/\bUPDATE\b/);
  });

  it('no list is auto-designated household, whatever the allowlist holds', async () => {
    const { adult, admin } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Solo list');
    expect(await getHouseholdFeed()).toBeNull(); // exactly one allowlisted row — still nothing designated

    await allowlist(admin.user.id, 'google', 'l2', 'Another list');
    expect(await getHouseholdFeed()).toBeNull(); // two rows now — still nothing designated
  });
});
