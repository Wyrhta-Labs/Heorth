import { getM365Runtime, type M365Runtime } from './runtime.js';
import { GraphCalendarProvider } from './calendar-provider.js';
import type { CalendarFeed, CalendarProvider } from '../modules/calendar/providers/types.js';
import { applyMirrorPull } from '../modules/calendar/mirror-store.js';
import { syncOneFeed, type FeedSyncResult } from './sync-runner.js';

/**
 * Calendar sync runner. Pulls each feed's delta through the (provider-agnostic)
 * {@link CalendarProvider}, applies it to the read-only mirror, and records
 * per-feed state in `m365_sync_state`. All of the machinery AROUND the pull —
 * connection short-circuit, periodic re-window, error isolation + classification
 * — lives in the shared {@link syncOneFeed} (see `sync-runner.ts`), so the
 * calendar and To Do runners behave identically.
 */

// Re-exported so existing importers (`index.ts`) keep their path unchanged.
export type { FeedSyncResult } from './sync-runner.js';

/** Sync one calendar feed via the shared runner. */
async function syncFeed(
  provider: CalendarProvider,
  feed: CalendarFeed,
  rt: M365Runtime,
): Promise<FeedSyncResult> {
  return syncOneFeed(rt, feed, async (syncToken, forceFullResync) => {
    const result = await provider.pullChanges(feed.feedKey, syncToken, forceFullResync);
    const { upserted, deleted } = await applyMirrorPull(provider.source, feed.feedKey, result);
    return { nextToken: result.nextToken, fullResync: result.fullResync, upserted, deleted };
  });
}

/**
 * Run all calendar feeds sequentially. Returns a per-feed result summary. Safe
 * to call from the scheduler tick or the manual `POST /api/v1/m365/sync` route.
 * Never rejects for a per-feed failure; only a total inability to enumerate
 * feeds (e.g. app-only token failure surfaced by listFeeds) would propagate.
 */
export async function runCalendarSync(
  rt: M365Runtime = getM365Runtime(),
  provider: CalendarProvider = new GraphCalendarProvider(rt),
): Promise<FeedSyncResult[]> {
  const feeds = await provider.listFeeds();
  const results: FeedSyncResult[] = [];
  for (const feed of feeds) {
    results.push(await syncFeed(provider, feed, rt));
  }
  return results;
}
