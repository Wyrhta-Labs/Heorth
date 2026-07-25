import type { M365Runtime } from './runtime.js';
import { GraphError } from './graph.js';
import { feedKeys } from './feed-keys.js';
import { classify } from './sync-runner.js';
import { localDateOf, zonedMidnightUtc } from '../lib/local-date.js';
import { getHouseholdTimeZone } from '../household/timezone.js';
import {
  TaskProviderError,
  type TaskProvider, type MirroredTask, type TaskPullResult,
  type AvailableList, type CreateTaskInput,
} from '../modules/tasks/providers/types.js';

/**
 * The Microsoft Graph To Do provider — the ONLY place Graph To Do types/URLs
 * live. Implements the provider-agnostic {@link TaskProvider} contract on the
 * Task 2.1 foundation. To Do is delegated-only (ADR / brief), so every feed runs
 * on a member connection; there is no app-only task feed.
 *
 *  - discovery:   GET /me/todo/lists
 *  - sync:        GET /me/todo/lists/{listId}/tasks/delta  (+ @odata.nextLink / deltaLink)
 *  - completion:  PATCH /me/todo/lists/{listId}/tasks/{taskId}
 *  - creation:    POST  /me/todo/lists/{listId}/tasks
 *
 * `pullChanges` throws the raw {@link GraphError} so the sync runner classifies
 * it. The write paths (`setCompleted`, `createTask`) are called from the tasks
 * module, which must not see a Graph type, so they wrap failures in a classified
 * {@link TaskProviderError}.
 */

const MAX_PAGES = 50; // defensive cap on a runaway nextLink chain

interface GraphDateTimeTimeZone {
  dateTime: string;
  timeZone?: string;
}

interface GraphTodoTask {
  id: string;
  title?: string | null;
  status?: string; // notStarted | inProgress | completed | waitingOnOthers | deferred
  body?: { content?: string | null; contentType?: string } | null;
  dueDateTime?: GraphDateTimeTimeZone | null;
  completedDateTime?: GraphDateTimeTimeZone | null;
  '@removed'?: { reason?: string };
}

interface GraphTodoList {
  id: string;
  displayName?: string | null;
}

interface DeltaResponse {
  value: GraphTodoTask[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/**
 * To Do's `dueDateTime`/`completedDateTime` are CALENDAR DATES, not instants:
 * Graph truncates writes to midnight in the author's zone and returns the
 * equivalent UTC instant (zoneless string + timeZone 'UTC'). Interpreting them
 * as instants shifts tasks a day in any household away from UTC — so we
 * recover the intended calendar date and store it as the UTC instant of
 * household-local midnight (which the web's local-day bucketing lands right).
 *
 * Date recovery: convert the UTC instant into the household zone and take the
 * date part — EXCEPT when the raw value is exactly midnight UTC with a
 * different zone-converted date. A midnight-UTC value is a date-only stamp
 * whose date part IS the intended date (e.g. Graph's own completion stamp,
 * a Microsoft-acknowledged known issue that stamps midnight of the current
 * UTC date), so its raw date part wins.
 */
function toLocalMidnightIso(dt: GraphDateTimeTimeZone | null | undefined, zone: string): string | null {
  if (!dt?.dateTime) return null;
  const raw = dt.dateTime;
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(raw);
  // A zoneless value is local to the stated timeZone; To Do returns UTC.
  const instant = new Date(hasZone ? raw : `${raw}Z`);
  const zoneDate = localDateOf(instant, zone);
  const rawDatePart = raw.slice(0, 10);
  const isMidnight = /T00:00(:00(\.0+)?)?Z?$/.test(raw);
  const date = isMidnight && rawDatePart !== zoneDate ? rawDatePart : zoneDate;
  return zonedMidnightUtc(date, zone).toISOString();
}

interface ParsedFeed { memberId: string; listId: string; }

export class GraphTaskProvider implements TaskProvider {
  readonly source = 'm365';

  /**
   * `resolveTimeZone` supplies the household IANA zone used for the calendar-
   * date conversions (see {@link toLocalMidnightIso}); defaults to the live
   * household row, tests inject a fixed zone. Resolved once per public call.
   */
  constructor(
    private readonly rt: M365Runtime,
    private readonly resolveTimeZone: () => Promise<string> = getHouseholdTimeZone,
  ) {}

  async listAvailableLists(memberId: string): Promise<AvailableList[]> {
    try {
      const token = await this.rt.delegated.getAccessToken(memberId);
      const res = await this.rt.graphFetch<{ value: GraphTodoList[] }>(token, '/me/todo/lists');
      return (res.value ?? []).map((l) => ({ id: l.id, name: l.displayName?.trim() || '(untitled list)' }));
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  async pullChanges(
    feedKey: string, syncToken: string | null, forceFullResync = false,
  ): Promise<TaskPullResult> {
    const { memberId, listId } = this.parseFeed(feedKey);
    const zone = await this.resolveTimeZone();
    const token = await this.rt.delegated.getAccessToken(memberId);
    const basePath = `/me/todo/lists/${encodeURIComponent(listId)}/tasks/delta`;

    let fullResync = false;
    let path: string;
    if (syncToken && !forceFullResync) {
      path = syncToken; // opaque absolute deltaLink URL
    } else {
      // No prior token, OR a periodic full re-sync is due → fresh full snapshot.
      path = basePath;
      fullResync = true;
    }

    const upserts: MirroredTask[] = [];
    const deletions: string[] = [];
    let nextToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let res: DeltaResponse;
      try {
        res = await this.rt.graphFetch<DeltaResponse>(token, path);
      } catch (e) {
        // Expired/invalid delta token → 410 Gone. Drop the token and re-pull the
        // whole list fresh (deletions can't be trusted across the gap).
        if (e instanceof GraphError && e.status === 410 && syncToken) {
          return this.pullChanges(feedKey, null);
        }
        throw e;
      }

      for (const t of res.value ?? []) {
        if (t['@removed']) {
          deletions.push(t.id);
        } else {
          upserts.push(this.toMirrored(t, memberId, listId, zone));
        }
      }

      const next = res['@odata.nextLink'];
      const delta = res['@odata.deltaLink'];
      if (next) {
        path = next;
        continue;
      }
      nextToken = delta ?? null;
      break;
    }

    return { upserts, deletions, nextToken, fullResync };
  }

  async setCompleted(feedKey: string, externalId: string, completed: boolean): Promise<void> {
    const { memberId, listId } = this.parseFeed(feedKey);
    try {
      const zone = await this.resolveTimeZone();
      const token = await this.rt.delegated.getAccessToken(memberId);
      // Completing WITHOUT an explicit completedDateTime makes the service
      // stamp midnight of the current UTC date (Microsoft-acknowledged known
      // issue) — wrong local day for any household east of UTC after local
      // midnight. So always send today's household-local date explicitly
      // (completedDateTime is a calendar date; Graph truncates to midnight).
      const body = completed
        ? {
            status: 'completed',
            completedDateTime: { dateTime: `${localDateOf(new Date(), zone)}T00:00:00`, timeZone: zone },
          }
        : { status: 'notStarted', completedDateTime: null };
      await this.rt.graphFetch<GraphTodoTask>(
        token,
        `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(externalId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  async createTask(feedKey: string, input: CreateTaskInput): Promise<MirroredTask> {
    const { memberId, listId } = this.parseFeed(feedKey);
    try {
      const zone = await this.resolveTimeZone();
      const token = await this.rt.delegated.getAccessToken(memberId);
      const body: Record<string, unknown> = { title: input.title };
      if (input.notes) body['body'] = { content: input.notes, contentType: 'text' };
      if (input.dueAt) {
        // dueDateTime is a calendar date: send the household-local date of the
        // intended instant at midnight IN the household zone, so Graph's
        // truncate-to-midnight normalization keeps the intended day.
        body['dueDateTime'] = { dateTime: `${localDateOf(input.dueAt, zone)}T00:00:00`, timeZone: zone };
      }
      const created = await this.rt.graphFetch<GraphTodoTask>(
        token,
        `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      return this.toMirrored(created, memberId, listId, zone);
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  private toMirrored(t: GraphTodoTask, memberId: string, listId: string, zone: string): MirroredTask {
    const completed = t.status === 'completed';
    return {
      externalId: t.id,
      title: t.title?.trim() || '(untitled)',
      notes: t.body?.content?.trim() || null,
      dueAt: toLocalMidnightIso(t.dueDateTime, zone),
      completedAt: completed ? (toLocalMidnightIso(t.completedDateTime, zone) ?? new Date().toISOString()) : null,
      status: completed ? 'completed' : 'open',
      listId,
      listName: null, // resolved from the allowlist store; the delta payload omits it
      memberId,
    };
  }

  private parseFeed(feedKey: string): ParsedFeed {
    const m = /^todo:member:([^:]+):(.+)$/.exec(feedKey);
    if (!m) throw new Error(`Unsupported task feed key: ${feedKey}`);
    return { memberId: m[1]!, listId: m[2]! };
  }
}

/** Convenience: the canonical feed key for a member's list (re-export of the shared helper). */
export function taskFeedKey(memberId: string, listId: string): string {
  return feedKeys.todoMember(memberId, listId);
}
