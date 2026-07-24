import { getM365Runtime, type M365Runtime } from './runtime.js';
import { GraphTaskProvider } from './task-provider.js';
import { syncOneFeed, type FeedSyncResult } from './sync-runner.js';
import { listAllowlistedFeeds, applyTaskPull } from '../modules/tasks/store.js';
import type { TaskProvider } from '../modules/tasks/providers/types.js';

/**
 * To Do sync runner. Enumerates feeds from the per-member list allowlist (nothing
 * syncs by default — a feed exists only for a list a member chose), then pulls
 * each through the provider-agnostic {@link TaskProvider} and applies it to the
 * mirror. All machinery AROUND the pull (connection short-circuit, periodic full
 * re-sync, error isolation + classification, sync-state recording) is the shared
 * {@link syncOneFeed}, identical to the calendar runner.
 */
export async function runTaskSync(
  rt: M365Runtime = getM365Runtime(),
  provider: TaskProvider = new GraphTaskProvider(rt),
): Promise<FeedSyncResult[]> {
  const feeds = await listAllowlistedFeeds();
  const results: FeedSyncResult[] = [];
  for (const feed of feeds) {
    results.push(await syncOneFeed(rt, feed, async (syncToken, forceFullResync) => {
      const result = await provider.pullChanges(feed.feedKey, syncToken, forceFullResync);
      const { upserted, deleted } = await applyTaskPull(provider.source, feed, result);
      return { nextToken: result.nextToken, fullResync: result.fullResync, upserted, deleted };
    }));
  }
  return results;
}
