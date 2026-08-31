import { getGoogleRuntime, type GoogleRuntime } from './runtime.js';
import { GoogleCalendarProvider } from './calendar-provider.js';
import { classify, googleFullResyncIntervalMs } from './sync-runner.js';
import { syncOneFeed, type FeedSyncResult } from '../integrations/sync-runner.js';
import { applyMirrorPull } from '../modules/calendar/mirror-store.js';
import type { CalendarProvider } from '../modules/calendar/providers/types.js';

/**
 * Google calendar sync runner — the sibling of `src/m365/calendar-sync.ts`.
 * Everything AROUND the pull (connection short-circuit, periodic re-window,
 * error isolation and classification, sync-state recording) is the shared
 * `syncOneFeed`; this file only enumerates feeds and wires the pull to the
 * mirror write.
 */
export async function runGoogleCalendarSync(
  rt: GoogleRuntime = getGoogleRuntime(),
  provider: CalendarProvider = new GoogleCalendarProvider(rt),
): Promise<FeedSyncResult[]> {
  const feeds = await provider.listFeeds();
  const results: FeedSyncResult[] = [];
  for (const feed of feeds) {
    results.push(await syncOneFeed(
      { store: rt.store, classifyError: classify, fullResyncIntervalMs: googleFullResyncIntervalMs() },
      feed,
      async (syncToken, forceFullResync) => {
        const result = await provider.pullChanges(feed.feedKey, syncToken, forceFullResync);
        const { upserted, deleted } = await applyMirrorPull(provider.source, feed.feedKey, result);
        return { nextToken: result.nextToken, fullResync: result.fullResync, upserted, deleted };
      },
    ));
  }
  return results;
}
