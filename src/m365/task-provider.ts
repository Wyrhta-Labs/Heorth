import type { M365Runtime } from './runtime.js';
import { GraphError } from './graph.js';
import { feedKeys } from './feed-keys.js';
import { classify } from './sync-runner.js';
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

/** Treat a Graph dateTime (UTC via timeZone) as an absolute instant. */
function toUtcIso(dt: GraphDateTimeTimeZone | null | undefined): string | null {
  if (!dt?.dateTime) return null;
  const raw = dt.dateTime;
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(raw);
  // To Do returns a naive local-to-the-stated-zone string; when we asked for and
  // stored UTC we treat a zoneless value as UTC.
  return new Date(hasZone ? raw : `${raw}Z`).toISOString();
}

interface ParsedFeed { memberId: string; listId: string; }

export class GraphTaskProvider implements TaskProvider {
  readonly source = 'm365';

  constructor(private readonly rt: M365Runtime) {}

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
          upserts.push(this.toMirrored(t, memberId, listId));
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
      const token = await this.rt.delegated.getAccessToken(memberId);
      await this.rt.graphFetch<GraphTodoTask>(
        token,
        `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(externalId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: completed ? 'completed' : 'notStarted' }),
        },
      );
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  async createTask(feedKey: string, input: CreateTaskInput): Promise<MirroredTask> {
    const { memberId, listId } = this.parseFeed(feedKey);
    try {
      const token = await this.rt.delegated.getAccessToken(memberId);
      const body: Record<string, unknown> = { title: input.title };
      if (input.notes) body['body'] = { content: input.notes, contentType: 'text' };
      if (input.dueAt) {
        body['dueDateTime'] = { dateTime: new Date(input.dueAt).toISOString(), timeZone: 'UTC' };
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
      return this.toMirrored(created, memberId, listId);
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  private toMirrored(t: GraphTodoTask, memberId: string, listId: string): MirroredTask {
    const completed = t.status === 'completed';
    return {
      externalId: t.id,
      title: t.title?.trim() || '(untitled)',
      notes: t.body?.content?.trim() || null,
      dueAt: toUtcIso(t.dueDateTime),
      completedAt: completed ? (toUtcIso(t.completedDateTime) ?? new Date().toISOString()) : null,
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
