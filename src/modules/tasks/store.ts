import { and, eq, gte, lte, inArray, notInArray, asc, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { feedKeys } from '../../integrations/feed-keys.js';
import { taskMirror, todoListAllowlist, type TaskMirrorRow, type TodoListAllowlistRow } from './schema.js';
import { TaskProviderError, type MirroredTask, type TaskPullResult, type TaskStatus } from './providers/types.js';

/**
 * Persistence for the To Do mirror and the per-member list allowlist.
 * Provider-agnostic: the sync runner (`src/m365/task-sync.ts`) hands normalized
 * {@link TaskPullResult}s here and this module writes them, with no knowledge of
 * Graph. The feed carries the list attribution (`listId` / `listName`) because
 * the delta payload itself does not repeat the list name on every task.
 */

/** A feed = one allowlisted task list of one member, at one provider. */
export interface TaskFeed {
  provider: string;
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
 *  - `fullResync`: `upserts` IS the complete current contents of the feed.
 *    Rows are RECONCILED, not replaced: everything present is upserted, then
 *    everything absent is deleted. This is what keeps `task_mirror.id` stable
 *    for a task that survives the resync — the previous implementation deleted
 *    the whole feed and re-inserted it, changing every uuid. `GET /api/v1/tasks`
 *    hands those ids to the web, which then calls `/:id/complete` with one, so
 *    churning them turns into an intermittent 404.
 *  - otherwise: upsert `upserts` (by feed + externalId) and delete `deletions`.
 *
 * A provider with no delta API (Google Tasks) sets `fullResync` on EVERY pull;
 * the reconcile is what detects a deletion structurally, with no tombstone.
 */
export async function applyTaskPull(
  source: string,
  feed: TaskFeed,
  result: TaskPullResult,
): Promise<{ upserted: number; deleted: number }> {
  return db.transaction(async (tx) => {
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
    if (result.fullResync) {
      // Reconcile: anything in the feed that this snapshot did not carry is gone
      // at the source. An EMPTY snapshot legitimately empties the feed, so the
      // seen-list being empty must delete everything rather than short-circuit.
      const seen = result.upserts.map((t) => t.externalId);
      const rows = await tx
        .delete(taskMirror)
        .where(seen.length > 0
          ? and(eq(taskMirror.feedKey, feed.feedKey), notInArray(taskMirror.externalId, seen))
          : eq(taskMirror.feedKey, feed.feedKey))
        .returning({ id: taskMirror.id });
      deleted = rows.length;
    } else if (result.deletions.length > 0) {
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

/**
 * One mirrored task by the stable feed reference. A full resync now reconciles
 * `task_mirror` rows in place rather than recreating ids; `(feedKey,
 * externalId)` is the table's unique provider key regardless.
 */
export async function getTaskByFeedRef(feedKey: string, externalId: string): Promise<TaskMirrorRow | null> {
  const [row] = await db.select().from(taskMirror)
    .where(and(eq(taskMirror.feedKey, feedKey), eq(taskMirror.externalId, externalId)))
    .limit(1);
  return row ?? null;
}

/** One mirrored task whose notes contain the marker stamped by the projector. */
export async function getTaskByNotesMarker(marker: string): Promise<TaskMirrorRow | null> {
  const [row] = await db.select().from(taskMirror)
    .where(sql`${taskMirror.notes} LIKE ${`%${marker}%`}`)
    .limit(1);
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

/**
 * A member's allowlisted lists. `provider` narrows to one provider; omitted, it
 * returns every provider's rows — which is what the picker and the settings
 * surface need now that a member may hold lists at both.
 */
export async function getAllowlist(memberId: string, provider?: string): Promise<TodoListAllowlistRow[]> {
  const where = provider
    ? and(eq(todoListAllowlist.memberId, memberId), eq(todoListAllowlist.provider, provider))
    : eq(todoListAllowlist.memberId, memberId);
  return db.select().from(todoListAllowlist).where(where).orderBy(asc(todoListAllowlist.listName));
}

/**
 * Replace a member's allowlist for one provider with the given lists. Rows for
 * lists removed from the selection are deleted and their mirrored tasks cleared,
 * so a de-selected list stops syncing and disappears immediately. Only this
 * provider's rows for the member are touched — an allowlist from the other
 * provider is untouched.
 */
export async function setAllowlist(
  memberId: string, provider: string, lists: Array<{ id: string; name: string | null }>,
): Promise<TodoListAllowlistRow[]> {
  const keepIds = new Set(lists.map((l) => l.id));
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(todoListAllowlist)
      .where(and(eq(todoListAllowlist.memberId, memberId), eq(todoListAllowlist.provider, provider)));

    // Remove de-selected lists + their mirrored tasks.
    for (const row of existing) {
      if (!keepIds.has(row.listId)) {
        // Un-designating the household list this way is silent and needs only
        // list ownership, not admin/adult — refuse it. This is the same class
        // of hole the calendar allowlist has for its household calendar; losing
        // this row breaks `createHouseholdTask` and Weorc's projected
        // maintenance tasks with it.
        if (row.isHousehold) {
          throw new TaskProviderError(
            'household_list_in_use',
            `Cannot de-select ${provider}:${row.listId}: it is the designated household list. `
            + 'Designate a different household list first.',
          );
        }
        await tx.delete(todoListAllowlist).where(eq(todoListAllowlist.id, row.id));
        await tx.delete(taskMirror).where(eq(taskMirror.feedKey, feedKeys.todoMember(provider, memberId, row.listId)));
      }
    }

    // Upsert the selected lists (refresh cached names).
    for (const l of lists) {
      await tx.insert(todoListAllowlist).values({ memberId, provider, listId: l.id, listName: l.name })
        .onConflictDoUpdate({
          target: [todoListAllowlist.provider, todoListAllowlist.memberId, todoListAllowlist.listId],
          set: { listName: l.name, updatedAt: new Date() },
        });
    }

    return tx.select().from(todoListAllowlist)
      .where(and(eq(todoListAllowlist.memberId, memberId), eq(todoListAllowlist.provider, provider)))
      .orderBy(asc(todoListAllowlist.listName));
  });
}

/** All allowlisted lists across every member and provider, as sync feeds. */
export async function listAllowlistedFeeds(provider?: string): Promise<TaskFeed[]> {
  const rows = provider
    ? await db.select().from(todoListAllowlist).where(eq(todoListAllowlist.provider, provider))
    : await db.select().from(todoListAllowlist);
  return rows.map((r) => ({
    provider: r.provider,
    feedKey: feedKeys.todoMember(r.provider, r.memberId, r.listId),
    memberId: r.memberId,
    listId: r.listId,
    listName: r.listName,
  }));
}

/**
 * Resolve one task feed from its key by MATCHING WHOLE KEYS, never by parsing.
 *
 * The Graph provider parses its keys with a regex; a Google list id must not be
 * parsed that way, and the Google provider needs the row anyway (for the cached
 * list name). Building every candidate key and comparing whole is exact
 * regardless of what characters an id contains.
 */
export async function getTaskFeedByKey(feedKey: string): Promise<TaskFeed | null> {
  const feeds = await listAllowlistedFeeds();
  return feeds.find((f) => f.feedKey === feedKey) ?? null;
}

/**
 * The designated household task feed, or null when none is designated.
 *
 * Replaces resolution by display name (`findAllowlistByName`), which matched
 * `M365_SHARED_TODO_LIST` against every member's allowlist and tie-broke with
 * "prefer the acting member, else the first row". That broke silently when a
 * member renamed the list at the source, and with two providers the tie-break
 * could route a task to either one.
 */
export async function getHouseholdFeed(): Promise<TaskFeed | null> {
  const [row] = await db.select().from(todoListAllowlist)
    .where(eq(todoListAllowlist.isHousehold, true)).limit(1);
  if (!row) return null;
  return {
    provider: row.provider,
    feedKey: feedKeys.todoMember(row.provider, row.memberId, row.listId),
    memberId: row.memberId,
    listId: row.listId,
    listName: row.listName,
  };
}

/**
 * Designate one allowlisted list as the household list. Clearing every other
 * flag and setting the new one happen in ONE transaction — the partial unique
 * index would otherwise reject the update, and a non-transactional clear-then-set
 * could leave the household with no list at all if the second statement failed.
 */
export async function setHouseholdList(
  memberId: string, provider: string, listId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(todoListAllowlist)
      .set({ isHousehold: false, updatedAt: new Date() })
      .where(eq(todoListAllowlist.isHousehold, true));
    await tx.update(todoListAllowlist)
      .set({ isHousehold: true, updatedAt: new Date() })
      .where(and(
        eq(todoListAllowlist.memberId, memberId),
        eq(todoListAllowlist.provider, provider),
        eq(todoListAllowlist.listId, listId),
      ));
  });
}
