import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { integrationSyncState } from '../src/integrations/schema.js';
import { feedKeys } from '../src/integrations/feed-keys.js';

describe('feed-key prefix migration', () => {
  it('rewrites legacy unprefixed keys to their m365 form', async () => {
    // Simulate rows written before the prefix convention existed.
    await db.insert(integrationSyncState).values([
      { feedKey: 'calendar:member:abc', syncToken: 't1' },
      { feedKey: 'calendar:family', syncToken: 't2' },
      { feedKey: 'todo:member:abc:list1', syncToken: 't3' },
    ]);

    // Re-run the data migration's statements against the seeded rows.
    await db.execute(sql`
      UPDATE integration_sync_state
         SET feed_key = 'm365:' || feed_key
       WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%'
    `);

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

  it('is idempotent — a second run does not double-prefix', async () => {
    await db.insert(integrationSyncState).values([
      { feedKey: feedKeys.calendarFamily('m365'), syncToken: 't1' },
    ]);

    await db.execute(sql`
      UPDATE integration_sync_state
         SET feed_key = 'm365:' || feed_key
       WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%'
    `);

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
