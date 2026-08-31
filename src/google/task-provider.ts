import type { GoogleRuntime } from './runtime.js';
import { GOOGLE_TASKS_BASE } from './api.js';
import { classify } from './sync-runner.js';
import { localDateOf, zonedMidnightUtc } from '../lib/local-date.js';
import { getHouseholdTimeZone } from '../household/timezone.js';
import { getTaskFeedByKey } from '../modules/tasks/store.js';
import {
  TaskProviderError,
  type AvailableList, type CreateTaskInput, type MirroredTask,
  type TaskProvider, type TaskPullResult,
} from '../modules/tasks/providers/types.js';

/**
 * The Google Tasks provider — SNAPSHOT-BASED, deliberately.
 *
 * Google Tasks has no delta API. Imitating one with `updatedMin` +
 * `showDeleted` was the original design and it was wrong: deletions surface
 * only while Google retains the tombstone, so past retention a task deleted on
 * a phone stays mirrored forever.
 *
 * So every pull fetches the COMPLETE list and reports `fullResync: true`, and
 * `applyTaskPull` reconciles: everything present is upserted, everything absent
 * is deleted. A deletion is detected structurally, with no tombstone required.
 * Lists are small (tens of items, pages of 100), so a full pull is 1-2 calls per
 * feed — far below the default project quota even at a 5-minute tick.
 *
 * Consequences worth stating: `syncToken` is ignored entirely, there is no
 * 410-equivalent recovery path, and `lastFullSyncAt` is stamped every tick,
 * which is simply true for this provider.
 */

const MAX_PAGES = 50;
const PAGE_SIZE = 100;

interface GoogleTask {
  id: string;
  title?: string | null;
  notes?: string | null;
  /** RFC3339, but date-only in effect: Google stores UTC midnight. */
  due?: string | null;
  status?: string; // needsAction | completed
  /** RFC3339 — a REAL instant, unlike To Do's date-only completion stamp. */
  completed?: string | null;
  deleted?: boolean;
  hidden?: boolean;
}

interface TasksListResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

interface TaskListsResponse {
  items?: Array<{ id: string; title?: string | null }>;
  nextPageToken?: string;
}

export class GoogleTaskProvider implements TaskProvider {
  readonly source = 'google';

  constructor(
    private readonly rt: GoogleRuntime,
    private readonly resolveTimeZone: () => Promise<string> = getHouseholdTimeZone,
  ) {}

  async listAvailableLists(memberId: string): Promise<AvailableList[]> {
    try {
      const token = await this.rt.oauth.getAccessToken(memberId);
      const out: AvailableList[] = [];
      let url = `${GOOGLE_TASKS_BASE}/users/@me/lists?maxResults=${PAGE_SIZE}`;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await this.rt.googleFetch<TaskListsResponse>(token, url);
        for (const l of res.items ?? []) {
          out.push({ id: l.id, name: l.title?.trim() || '(untitled list)' });
        }
        if (!res.nextPageToken) break;
        url = `${GOOGLE_TASKS_BASE}/users/@me/lists?maxResults=${PAGE_SIZE}&pageToken=${encodeURIComponent(res.nextPageToken)}`;
      }
      return out;
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  /**
   * Pull the WHOLE list. `syncToken` and `forceFullResync` are both ignored —
   * every pull is already a full pull. Throws the raw error so the sync runner
   * classifies it (the write paths below wrap instead).
   */
  async pullChanges(feedKey: string, _syncToken: string | null): Promise<TaskPullResult> {
    const feed = await this.requireFeed(feedKey);
    const zone = await this.resolveTimeZone();
    const token = await this.rt.oauth.getAccessToken(feed.memberId);

    const upserts: MirroredTask[] = [];
    // BOTH flags are required. `showCompleted` defaults to true, but a
    // completed task is also marked HIDDEN, and hidden items are omitted unless
    // `showHidden=true` — so without both, a completion reads to the reconciler
    // as a deletion and the task vanishes from the mirror.
    const base = `${GOOGLE_TASKS_BASE}/lists/${encodeURIComponent(feed.listId)}/tasks`
      + `?showCompleted=true&showHidden=true&maxResults=${PAGE_SIZE}`;
    let url = base;
    let exhausted = true;

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.rt.googleFetch<TasksListResponse>(token, url);
      for (const t of res.items ?? []) {
        // A tombstone still in Google's retention window. The reconcile already
        // removes it by absence; mirroring it would resurrect a deleted task.
        if (t.deleted) continue;
        upserts.push(this.toMirrored(t, feed.memberId, feed.listId, feed.listName, zone));
      }
      if (!res.nextPageToken) { exhausted = false; break; }
      url = `${base}&pageToken=${encodeURIComponent(res.nextPageToken)}`;
    }

    // Falling out of the loop with the page cap exhausted means this snapshot
    // is PARTIAL, but `fullResync: true` tells the store the snapshot IS the
    // whole feed, so it deletes every mirrored task not present — an exhausted
    // cap would then delete everything past it rather than merely re-syncing
    // later. A partial snapshot with fullResync: true is indistinguishable
    // from a genuine emptying, so throw instead: the sync runner classifies
    // the error and records it against the feed without touching the mirror.
    if (exhausted) {
      throw new Error(`Google Tasks pull for ${feedKey} exceeded ${MAX_PAGES} pages without completing`);
    }

    // `deletions` stays empty and `fullResync` is always true: the snapshot IS
    // the feed, and the store reconciles against it.
    return { upserts, deletions: [], nextToken: null, fullResync: true };
  }

  async setCompleted(feedKey: string, externalId: string, completed: boolean): Promise<void> {
    try {
      const feed = await this.requireFeed(feedKey);
      const token = await this.rt.oauth.getAccessToken(feed.memberId);
      // Google Tasks takes a real instant here, so no date coarsening is needed
      // and none should be applied.
      const body = completed
        ? { status: 'completed', completed: new Date().toISOString() }
        : { status: 'needsAction', completed: null };
      await this.rt.googleFetch<GoogleTask>(
        token,
        `${GOOGLE_TASKS_BASE}/lists/${encodeURIComponent(feed.listId)}/tasks/${encodeURIComponent(externalId)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  async createTask(feedKey: string, input: CreateTaskInput): Promise<MirroredTask> {
    try {
      const feed = await this.requireFeed(feedKey);
      const zone = await this.resolveTimeZone();
      const token = await this.rt.oauth.getAccessToken(feed.memberId);
      const body: Record<string, unknown> = { title: input.title };
      if (input.notes) body['notes'] = input.notes;
      if (input.dueAt) {
        // `due` is date-only in effect: Google keeps the date part and drops the
        // time. Send UTC midnight of the HOUSEHOLD-local date so the intended
        // day survives the truncation.
        body['due'] = `${localDateOf(input.dueAt, zone)}T00:00:00.000Z`;
      }
      const created = await this.rt.googleFetch<GoogleTask>(
        token,
        `${GOOGLE_TASKS_BASE}/lists/${encodeURIComponent(feed.listId)}/tasks`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      return this.toMirrored(created, feed.memberId, feed.listId, feed.listName, zone);
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  /**
   * Resolve the feed from its allowlist row. NEVER parses the key: a Google
   * list id is opaque and the row carries the cached list name anyway.
   */
  private async requireFeed(feedKey: string) {
    const feed = await getTaskFeedByKey(feedKey);
    if (!feed) throw new Error(`Unknown Google task feed: ${feedKey}`);
    return feed;
  }

  private toMirrored(
    t: GoogleTask, memberId: string, listId: string, listName: string | null, zone: string,
  ): MirroredTask {
    const completed = t.status === 'completed';
    return {
      externalId: t.id,
      title: t.title?.trim() || '(untitled)',
      notes: t.notes?.trim() || null,
      dueAt: this.toLocalMidnightIso(t.due, zone),
      // A real instant — kept exactly, no coarsening. The fallback covers a
      // completed task Google returned without a stamp.
      completedAt: completed ? (t.completed ? new Date(t.completed).toISOString() : new Date().toISOString()) : null,
      status: completed ? 'completed' : 'open',
      listId,
      listName,
      memberId,
    };
  }

  /**
   * `due` is a CALENDAR DATE wearing an instant's clothes: Google stores UTC
   * midnight and ignores the time part. Take the date part verbatim and anchor
   * it to household-local midnight, so local-day bucketing lands on the
   * intended day.
   */
  private toLocalMidnightIso(due: string | null | undefined, zone: string): string | null {
    if (!due) return null;
    return zonedMidnightUtc(due.slice(0, 10), zone).toISOString();
  }
}
