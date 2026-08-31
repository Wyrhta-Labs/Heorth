import { getGoogleRuntime, type GoogleRuntime } from './runtime.js';
import { GoogleTaskProvider } from './task-provider.js';
import { classify, googleFullResyncIntervalMs } from './sync-runner.js';
import { syncOneFeed, type FeedSyncResult } from '../integrations/sync-runner.js';
import { listAllowlistedFeeds, applyTaskPull } from '../modules/tasks/store.js';
import type { TaskProvider } from '../modules/tasks/providers/types.js';

/**
 * Google Tasks sync runner — the sibling of `src/m365/task-sync.ts`. Feeds come
 * from the per-member list allowlist SCOPED TO 'google', so an M365 list is
 * never pulled through this runner.
 *
 * The provider reports `fullResync: true` on every pull, so `applyTaskPull`
 * reconciles every tick. That is the point of the design, not an accident.
 */
export async function runGoogleTaskSync(
  rt: GoogleRuntime = getGoogleRuntime(),
  provider: TaskProvider = new GoogleTaskProvider(rt),
): Promise<FeedSyncResult[]> {
  const feeds = await listAllowlistedFeeds('google');
  const results: FeedSyncResult[] = [];
  for (const feed of feeds) {
    results.push(await syncOneFeed(
      { store: rt.store, classifyError: classify, fullResyncIntervalMs: googleFullResyncIntervalMs() },
      feed,
      async (syncToken, forceFullResync) => {
        const result = await provider.pullChanges(feed.feedKey, syncToken, forceFullResync);
        const { upserted, deleted } = await applyTaskPull(provider.source, feed, result);
        return { nextToken: result.nextToken, fullResync: result.fullResync, upserted, deleted };
      },
    ));
  }
  return results;
}
