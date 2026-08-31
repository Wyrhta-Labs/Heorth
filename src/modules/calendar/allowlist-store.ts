import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { feedKeys } from '../../integrations/feed-keys.js';
import { integrationSyncState } from '../../integrations/schema.js';
import { calendarMirrorEvents } from './mirror-schema.js';
import { calendarAllowlist, type CalendarAllowlistRow } from './allowlist-schema.js';

/** A feed = one allowlisted calendar of one member, at one provider. */
export interface CalendarAllowlistFeed {
  provider: string;
  feedKey: string;
  memberId: string;
  calendarId: string;
  calendarName: string | null;
  isHousehold: boolean;
}

function toFeed(row: CalendarAllowlistRow): CalendarAllowlistFeed {
  return {
    provider: row.provider,
    feedKey: feedKeys.calendarList(row.provider, row.memberId, row.calendarId),
    memberId: row.memberId,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    isHousehold: row.isHousehold,
  };
}

export async function getCalendarAllowlist(
  memberId: string, provider?: string,
): Promise<CalendarAllowlistRow[]> {
  const where = provider
    ? and(eq(calendarAllowlist.memberId, memberId), eq(calendarAllowlist.provider, provider))
    : eq(calendarAllowlist.memberId, memberId);
  return db.select().from(calendarAllowlist).where(where).orderBy(asc(calendarAllowlist.calendarName));
}

/**
 * Replace a member's allowlist for ONE provider. De-selected calendars lose
 * their row AND their mirrored events, so an unpicked calendar disappears from
 * the wall immediately instead of lingering until something re-syncs. The other
 * provider's rows for the same member are untouched — the exact semantics of
 * `setAllowlist` in the tasks store.
 */
export async function setCalendarAllowlist(
  memberId: string, provider: string, calendars: Array<{ id: string; name: string | null }>,
): Promise<CalendarAllowlistRow[]> {
  const keepIds = new Set(calendars.map((c) => c.id));
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(calendarAllowlist)
      .where(and(eq(calendarAllowlist.memberId, memberId), eq(calendarAllowlist.provider, provider)));

    for (const row of existing) {
      if (!keepIds.has(row.calendarId)) {
        const feedKey = feedKeys.calendarList(provider, memberId, row.calendarId);
        await tx.delete(calendarAllowlist).where(eq(calendarAllowlist.id, row.id));
        await tx.delete(calendarMirrorEvents).where(eq(calendarMirrorEvents.feedKey, feedKey));
        // Its sync state goes too. Nothing enumerates a de-selected feed any
        // more, so a surviving row would sit in `/integrations/status`'s
        // `feeds[]` forever, frozen at its last success and eventually
        // rendering as a permanently stale badge on the wall.
        await tx.delete(integrationSyncState).where(eq(integrationSyncState.feedKey, feedKey));
      }
    }

    for (const c of calendars) {
      await tx.insert(calendarAllowlist)
        .values({ memberId, provider, calendarId: c.id, calendarName: c.name })
        .onConflictDoUpdate({
          target: [calendarAllowlist.provider, calendarAllowlist.memberId, calendarAllowlist.calendarId],
          set: { calendarName: c.name, updatedAt: new Date() },
        });
    }

    return tx.select().from(calendarAllowlist)
      .where(and(eq(calendarAllowlist.memberId, memberId), eq(calendarAllowlist.provider, provider)))
      .orderBy(asc(calendarAllowlist.calendarName));
  });
}

/** Every allowlisted calendar, across members, as sync feeds. */
export async function listAllowlistedCalendarFeeds(provider?: string): Promise<CalendarAllowlistFeed[]> {
  const rows = provider
    ? await db.select().from(calendarAllowlist).where(eq(calendarAllowlist.provider, provider))
    : await db.select().from(calendarAllowlist);
  return rows.map(toFeed);
}

/**
 * Resolve a feed from its key by MATCHING WHOLE KEYS, never by parsing.
 *
 * A calendar id can contain colons (Google's are email-shaped), so a positional
 * parse of `<provider>:calendar:member:<memberId>:<calendarId>` is unsafe. The
 * provider needs this lookup anyway — it reads the row for `is_household`.
 */
export async function getCalendarFeedByKey(feedKey: string): Promise<CalendarAllowlistFeed | null> {
  const rows = await db.select().from(calendarAllowlist);
  return rows.map(toFeed).find((f) => f.feedKey === feedKey) ?? null;
}

/** The designated household calendar feed, or null when none is designated. */
export async function getHouseholdCalendar(): Promise<CalendarAllowlistFeed | null> {
  const [row] = await db.select().from(calendarAllowlist)
    .where(eq(calendarAllowlist.isHousehold, true)).limit(1);
  return row ? toFeed(row) : null;
}

/**
 * Designate one allowlisted calendar as the household calendar.
 *
 * Clearing every other flag and setting the new one happen in ONE transaction:
 * the partial unique index would reject the update otherwise, and a
 * non-transactional clear-then-set could leave the household with none.
 *
 * The affected feeds' sync tokens are cleared in the same transaction. Every
 * mirrored row's attribution (`memberId`, family vs. member) changes with the
 * flag, and only a full re-pull rewrites them — an incremental replay would
 * leave the old attribution on every event it does not happen to re-deliver.
 */
export async function setHouseholdCalendar(
  memberId: string, provider: string, calendarId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const previouslyFlagged = await tx.select().from(calendarAllowlist)
      .where(eq(calendarAllowlist.isHousehold, true));

    await tx.update(calendarAllowlist)
      .set({ isHousehold: false, updatedAt: new Date() })
      .where(eq(calendarAllowlist.isHousehold, true));
    const designated = await tx.update(calendarAllowlist)
      .set({ isHousehold: true, updatedAt: new Date() })
      .where(and(
        eq(calendarAllowlist.memberId, memberId),
        eq(calendarAllowlist.provider, provider),
        eq(calendarAllowlist.calendarId, calendarId),
      ))
      .returning({ id: calendarAllowlist.id });
    // The triple can fail to match a row (stale UI state, or the calendar was
    // de-selected between page load and submit). Without this check the clear
    // above still commits and the household is left with NO designated
    // calendar — atomic is not the same as correct. Throwing rolls the whole
    // transaction back, so the previous designation survives.
    if (designated.length === 0) {
      throw new Error(
        `Cannot designate household calendar: ${provider}:${calendarId} is not allowlisted for member ${memberId}`,
      );
    }

    const affected = [
      ...previouslyFlagged.map((r) => feedKeys.calendarList(r.provider, r.memberId, r.calendarId)),
      feedKeys.calendarList(provider, memberId, calendarId),
    ];
    for (const feedKey of affected) {
      await tx.update(integrationSyncState)
        .set({ syncToken: null, lastFullSyncAt: null, updatedAt: new Date() })
        .where(eq(integrationSyncState.feedKey, feedKey));
    }
  });
}
