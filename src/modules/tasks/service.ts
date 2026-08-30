import { assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
import { listProviders } from '../../integrations/registry.js';
import { requireProviderFor } from './provider.js';
import * as store from './store.js';
import {
  TaskProviderError,
  type CreateTaskInput,
} from './providers/types.js';
import type { TaskMirrorRow, TodoListAllowlistRow } from './schema.js';
import type { TaskFeed, ListTasksQuery } from './store.js';

/**
 * Tasks module service. Reads come straight off the mirror (they work even when
 * the M365 integration is disabled — the mirror is simply empty). Writes
 * (completion, creation) and list discovery/allowlist management go through the
 * provider seam and surface a classified {@link TaskProviderError} on any
 * failure — a dead/absent connection never crashes a request and never silently
 * drops the write.
 *
 * The default provider used by `setAllowlist` is 'm365' — it acts BEFORE any
 * mirror row exists (there is no row to read a source from yet). The household
 * list (`createHouseholdTask`) is no longer defaulted to one provider: it is
 * resolved from whichever allowlist row carries `is_household` (Task 12).
 */
const DEFAULT_PROVIDER = 'm365';

export type { ListTasksQuery } from './store.js';

/** All mirrored tasks matching the filters (any member may read the household list). */
export async function listTasks(query: ListTasksQuery = {}): Promise<TaskMirrorRow[]> {
  return store.listTasks(query);
}

export interface AvailableListView {
  provider: string;   // NEW — which provider this list belongs to
  id: string;
  name: string;
  enabled: boolean;   // already allowlisted by this member
}

/**
 * Discover the lists a member can sync, across EVERY registered provider. Each
 * entry is tagged with its provider so the picker can group them and so
 * `setAllowlist` knows which provider a chosen list belongs to.
 */
export async function listAvailableLists(memberId: string): Promise<AvailableListView[]> {
  await assertNotMaintenanceAdmin(memberId);
  const out: AvailableListView[] = [];
  for (const p of listProviders()) {
    if (!p.tasks) continue;
    // One provider being unreachable must not hide another's lists: a member
    // connected to Google but not to M365 is a normal state, not an error.
    try {
      const lists = await p.tasks.listAvailableLists(memberId);
      const enabled = new Set((await store.getAllowlist(memberId, p.id)).map((a) => a.listId));
      for (const l of lists) {
        out.push({ provider: p.id, id: l.id, name: l.name, enabled: enabled.has(l.id) });
      }
    } catch (e) {
      if (p.classifyError(e) === 'no_connection') continue; // not connected: normal
      throw e;
    }
  }
  return out;
}

export async function getAllowlist(memberId: string): Promise<TodoListAllowlistRow[]> {
  return store.getAllowlist(memberId, DEFAULT_PROVIDER);
}

/**
 * Replace a member's allowlist. The submitted ids are validated against the
 * member's live lists so we can cache the correct display names and reject an id
 * the member cannot actually access.
 */
export async function setAllowlist(memberId: string, listIds: string[]): Promise<TodoListAllowlistRow[]> {
  await assertNotMaintenanceAdmin(memberId);
  const provider = requireProviderFor(DEFAULT_PROVIDER);
  const available = await provider.listAvailableLists(memberId); // throws TaskProviderError
  const byId = new Map(available.map((l) => [l.id, l.name]));
  const selected: Array<{ id: string; name: string | null }> = [];
  for (const id of listIds) {
    if (!byId.has(id)) {
      throw new TaskProviderError('unknown_list', `List not accessible for this member: ${id}`);
    }
    selected.push({ id, name: byId.get(id) ?? null });
  }
  return store.setAllowlist(memberId, DEFAULT_PROVIDER, selected);
}

/**
 * Complete / uncomplete one mirrored task. The provider is resolved from the
 * ROW's source, not from a global: with two providers connected, a
 * Google-mirrored task must be written back to Google.
 */
export async function completeTask(
  taskId: string, completed: boolean,
): Promise<TaskMirrorRow | null> {
  const row = await store.getTaskById(taskId);
  if (!row) return null;
  const provider = requireProviderFor(row.source);
  await provider.setCompleted(row.feedKey, row.externalId, completed); // throws TaskProviderError
  return store.setTaskCompletedLocal(taskId, completed);
}

/**
 * Create a task into the household task list. Resolves the DESIGNATED list
 * (`todo_list_allowlist.is_household`), then writes outward through whichever
 * member/provider owns that list and mirrors the created task locally.
 */
export async function createTask(input: CreateTaskInput, actingMemberId: string): Promise<TaskMirrorRow> {
  await assertNotMaintenanceAdmin(actingMemberId);
  return createHouseholdTask(input, actingMemberId);
}

/**
 * Create a task into the household task list without an authenticated actor.
 *
 * `_preferMemberId` is now UNUSED: the designated list is the same for every
 * member, which is the point of Task 12. The parameter is kept anyway because
 * `src/modules/weorc/engine.ts` calls this with `routine.ownerMemberId` as the
 * second argument — removing it would force an edit there for no behavioral
 * gain.
 */
export async function createHouseholdTask(
  input: CreateTaskInput,
  _preferMemberId: string | null,
): Promise<TaskMirrorRow> {
  const feed = await resolveHouseholdFeed();
  const provider = requireProviderFor(feed.provider);
  const created = await provider.createTask(feed.feedKey, input); // throws TaskProviderError
  return store.upsertMirroredTask(provider.source, feed, created);
}

/**
 * Complete / uncomplete a projected task by its stable provider key. The mirror
 * row is loaded FIRST here (it was loaded after the provider call before) —
 * without it there is no `source`, so there is no provider to call. A missing
 * row is reported as `provider_unavailable` rather than guessed at.
 */
export async function completeProjectedTask(
  feedKey: string,
  externalId: string,
  completed: boolean,
): Promise<void> {
  const row = await store.getTaskByFeedRef(feedKey, externalId);
  if (!row) {
    throw new TaskProviderError(
      'provider_unavailable',
      'No mirrored task for that feed reference — cannot resolve a provider',
    );
  }
  const provider = requireProviderFor(row.source);
  await provider.setCompleted(feedKey, externalId, completed);
  await store.setTaskCompletedLocal(row.id, completed);
}

export async function findTaskByFeedRef(feedKey: string, externalId: string): Promise<TaskMirrorRow | null> {
  return store.getTaskByFeedRef(feedKey, externalId);
}

export async function findTaskByNotesMarker(marker: string): Promise<TaskMirrorRow | null> {
  return store.getTaskByNotesMarker(marker);
}

/** Resolve the designated household task feed, or fail with a classified reason. */
async function resolveHouseholdFeed(): Promise<TaskFeed> {
  const feed = await store.getHouseholdFeed();
  if (!feed) {
    throw new TaskProviderError(
      'shared_list_unavailable',
      'No household task list is designated — an adult must pick one in the task list settings',
    );
  }
  return feed;
}

/** The designated household list, as the picker UI shows it. Null when none. */
export async function getHouseholdList(): Promise<{
  provider: string; memberId: string; listId: string; listName: string | null;
} | null> {
  const feed = await store.getHouseholdFeed();
  if (!feed) return null;
  return {
    provider: feed.provider,
    memberId: feed.memberId,
    listId: feed.listId,
    listName: feed.listName,
  };
}

/**
 * Designate one allowlisted list as the household list. The list must already be
 * allowlisted by that member — designating an unsynced list would produce a feed
 * nothing ever pulls, so this fails loudly instead.
 */
export async function setHouseholdList(
  memberId: string, provider: string, listId: string,
): Promise<void> {
  const owned = await store.getAllowlist(memberId, provider);
  if (!owned.some((r) => r.listId === listId)) {
    throw new TaskProviderError(
      'unknown_list',
      'That list is not in the member\'s allowlist — allowlist it before designating it',
    );
  }
  await store.setHouseholdList(memberId, provider, listId);
}

/** Re-export so routes/MCP can classify without importing the providers module. */
export { TaskProviderError } from './providers/types.js';
