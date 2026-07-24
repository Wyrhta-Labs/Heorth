import { and, eq, gte, lte, inArray, asc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { feedKeys } from '../../m365/feed-keys.js';
import { taskMirror, todoListAllowlist, type TaskMirrorRow, type TodoListAllowlistRow } from './schema.js';
import type { MirroredTask, TaskPullResult, TaskStatus } from './providers/types.js';

/**
 * Persistence for the To Do mirror and the per-member list allowlist.
 * Provider-agnostic: the sync runner (`src/m365/task-sync.ts`) hands normalized
 * {@link TaskPullResult}s here and this module writes them, with no knowledge of
 * Graph. The feed carries the list attribution (`listId` / `listName`) because
 * the delta payload itself does not repeat the list name on every task.
 */

/** A feed = one allowlisted To Do list of one member. */
export interface TaskFeed {
  feedKey: string;
  memberId: string;
  listId: string;
  listName: string | null;
}

function toRow(source: string, feed: TaskFeed, t: MirroredTask) {
  return {
    source,
    feedKey: feed.feedKey,
    externalId: t.externalId,
    memberId: t.memberId,
    listId: feed.listId,
    listName: feed.listName,
    title: t.title,
    notes: t.notes,
    dueAt: t.dueAt ? new Date(t.dueAt) : null,
    completedAt: t.completedAt ? new Date(t.completedAt) : null,
    status: t.status,
  };
}

/**
 * Apply one feed's pull to the mirror.
 *  - `fullResync`: replace ALL of the feed's rows with `upserts` (410 / periodic).
 *  - otherwise: upsert `upserts` (by feed + externalId) and delete `deletions`.
 */
export async function applyTaskPull(
  source: string,
  feed: TaskFeed,
  result: TaskPullResult,
): Promise<{ upserted: number; deleted: number }> {
  return db.transaction(async (tx) => {
    if (result.fullResync) {
      await tx.delete(taskMirror).where(eq(taskMirror.feedKey, feed.feedKey));
    }

    let upserted = 0;
    for (const t of result.upserts) {
      await tx.insert(taskMirror).values(toRow(source, feed, t)).onConflictDoUpdate({
        target: [taskMirror.feedKey, taskMirror.externalId],
        set: {
          memberId: t.memberId,
          listId: feed.listId,
          listName: feed.listName,
          title: t.title,
          notes: t.notes,
          dueAt: t.dueAt ? new Date(t.dueAt) : null,
          completedAt: t.completedAt ? new Date(t.completedAt) : null,
          status: t.status,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      upserted += 1;
    }

    let deleted = 0;
    if (!result.fullResync && result.deletions.length > 0) {
      const rows = await tx
        .delete(taskMirror)
        .where(and(
          eq(taskMirror.feedKey, feed.feedKey),
          inArray(taskMirror.externalId, result.deletions),
        ))
        .returning({ id: taskMirror.id });
      deleted = rows.length;
    }

    return { upserted, deleted };
  });
}

/** Remove every mirrored task for a feed (e.g. a list removed from the allowlist). */
export async function clearTaskFeed(feedKey: string): Promise<void> {
  await db.delete(taskMirror).where(eq(taskMirror.feedKey, feedKey));
}

export interface ListTasksQuery {
  status?: TaskStatus;
  memberId?: string;
  listId?: string;
  dueFrom?: string;
  dueTo?: string;
}

/** Mirrored tasks matching the filters, ordered by due date then title. */
export async function listTasks(query: ListTasksQuery = {}): Promise<TaskMirrorRow[]> {
  const conds = [];
  if (query.status) conds.push(eq(taskMirror.status, query.status));
  if (query.memberId) conds.push(eq(taskMirror.memberId, query.memberId));
  if (query.listId) conds.push(eq(taskMirror.listId, query.listId));
  if (query.dueFrom) conds.push(gte(taskMirror.dueAt, new Date(query.dueFrom)));
  if (query.dueTo) conds.push(lte(taskMirror.dueAt, new Date(query.dueTo)));
  const rows = conds.length
    ? await db.select().from(taskMirror).where(and(...conds))
    : await db.select().from(taskMirror);
  return rows.sort((a, b) => {
    const da = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
    const dbb = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
    return da - dbb || a.title.localeCompare(b.title);
  });
}

export async function getTaskById(id: string): Promise<TaskMirrorRow | null> {
  const [row] = await db.select().from(taskMirror).where(eq(taskMirror.id, id)).limit(1);
  return row ?? null;
}

/** Optimistic local completion update (write-back reconciles on the next sync). */
export async function setTaskCompletedLocal(id: string, completed: boolean): Promise<TaskMirrorRow | null> {
  const [row] = await db.update(taskMirror).set({
    status: completed ? 'completed' : 'open',
    completedAt: completed ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(taskMirror.id, id)).returning();
  return row ?? null;
}

/** Insert (or update) a single mirrored task — used to reflect an outward create locally. */
export async function upsertMirroredTask(source: string, feed: TaskFeed, t: MirroredTask): Promise<TaskMirrorRow> {
  const [row] = await db.insert(taskMirror).values(toRow(source, feed, t)).onConflictDoUpdate({
    target: [taskMirror.feedKey, taskMirror.externalId],
    set: {
      title: t.title, notes: t.notes,
      dueAt: t.dueAt ? new Date(t.dueAt) : null,
      completedAt: t.completedAt ? new Date(t.completedAt) : null,
      status: t.status, syncedAt: new Date(), updatedAt: new Date(),
    },
  }).returning();
  return row!;
}

// --- allowlist --------------------------------------------------------------

export async function getAllowlist(memberId: string): Promise<TodoListAllowlistRow[]> {
  return db.select().from(todoListAllowlist)
    .where(eq(todoListAllowlist.memberId, memberId))
    .orderBy(asc(todoListAllowlist.listName));
}

/**
 * Replace a member's allowlist with the given lists. Rows for lists removed from
 * the selection are deleted and their mirrored tasks cleared, so a de-selected
 * list stops syncing and disappears immediately.
 */
export async function setAllowlist(
  memberId: string, lists: Array<{ id: string; name: string | null }>,
): Promise<TodoListAllowlistRow[]> {
  const keepIds = new Set(lists.map((l) => l.id));
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(todoListAllowlist)
      .where(eq(todoListAllowlist.memberId, memberId));

    // Remove de-selected lists + their mirrored tasks.
    for (const row of existing) {
      if (!keepIds.has(row.listId)) {
        await tx.delete(todoListAllowlist).where(eq(todoListAllowlist.id, row.id));
        await tx.delete(taskMirror).where(eq(taskMirror.feedKey, feedKeys.todoMember(memberId, row.listId)));
      }
    }

    // Upsert the selected lists (refresh cached names).
    for (const l of lists) {
      await tx.insert(todoListAllowlist).values({ memberId, listId: l.id, listName: l.name })
        .onConflictDoUpdate({
          target: [todoListAllowlist.memberId, todoListAllowlist.listId],
          set: { listName: l.name, updatedAt: new Date() },
        });
    }

    return tx.select().from(todoListAllowlist)
      .where(eq(todoListAllowlist.memberId, memberId))
      .orderBy(asc(todoListAllowlist.listName));
  });
}

/** All allowlisted lists across every member, as sync feeds. */
export async function listAllowlistedFeeds(): Promise<TaskFeed[]> {
  const rows = await db.select().from(todoListAllowlist);
  return rows.map((r) => ({
    feedKey: feedKeys.todoMember(r.memberId, r.listId),
    memberId: r.memberId,
    listId: r.listId,
    listName: r.listName,
  }));
}

/** Allowlist entries (any member) for a list with the given display name. */
export async function findAllowlistByName(name: string): Promise<TodoListAllowlistRow[]> {
  return db.select().from(todoListAllowlist).where(eq(todoListAllowlist.listName, name));
}
