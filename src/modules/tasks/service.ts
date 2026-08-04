import { assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
import { feedKeys } from '../../m365/feed-keys.js';
import { getTaskProvider, getSharedListName } from './provider.js';
import * as store from './store.js';
import {
  TaskProviderError,
  type CreateTaskInput, type TaskProvider,
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
 */

/** The provider, or a classified `provider_unavailable` when the integration is off. */
function requireProvider(): TaskProvider {
  const provider = getTaskProvider();
  if (!provider) {
    throw new TaskProviderError('provider_unavailable', 'Microsoft 365 integration is not enabled');
  }
  return provider;
}

export type { ListTasksQuery } from './store.js';

/** All mirrored tasks matching the filters (any member may read the household list). */
export async function listTasks(query: ListTasksQuery = {}): Promise<TaskMirrorRow[]> {
  return store.listTasks(query);
}

export interface AvailableListView {
  id: string;
  name: string;
  enabled: boolean;
}

/** A member's To Do lists, each flagged with whether it is currently allowlisted. */
export async function listAvailableLists(memberId: string): Promise<AvailableListView[]> {
  await assertNotMaintenanceAdmin(memberId);
  const provider = requireProvider();
  const lists = await provider.listAvailableLists(memberId); // throws TaskProviderError
  const enabled = new Set((await store.getAllowlist(memberId)).map((a) => a.listId));
  return lists.map((l) => ({ id: l.id, name: l.name, enabled: enabled.has(l.id) }));
}

export async function getAllowlist(memberId: string): Promise<TodoListAllowlistRow[]> {
  return store.getAllowlist(memberId);
}

/**
 * Replace a member's allowlist. The submitted ids are validated against the
 * member's live lists so we can cache the correct display names and reject an id
 * the member cannot actually access.
 */
export async function setAllowlist(memberId: string, listIds: string[]): Promise<TodoListAllowlistRow[]> {
  await assertNotMaintenanceAdmin(memberId);
  const provider = requireProvider();
  const available = await provider.listAvailableLists(memberId); // throws TaskProviderError
  const byId = new Map(available.map((l) => [l.id, l.name]));
  const selected: Array<{ id: string; name: string | null }> = [];
  for (const id of listIds) {
    if (!byId.has(id)) {
      throw new TaskProviderError('unknown_list', `List not accessible for this member: ${id}`);
    }
    selected.push({ id, name: byId.get(id) ?? null });
  }
  return store.setAllowlist(memberId, selected);
}

/**
 * Complete / uncomplete a task: write back through the provider FIRST (the feed's
 * owning member's connection must be healthy — a classified error otherwise),
 * then optimistically update the local mirror. Returns null if the id is unknown.
 */
export async function completeTask(taskId: string, completed: boolean): Promise<TaskMirrorRow | null> {
  const provider = requireProvider();
  const row = await store.getTaskById(taskId);
  if (!row) return null;
  await provider.setCompleted(row.feedKey, row.externalId, completed); // throws TaskProviderError
  return store.setTaskCompletedLocal(taskId, completed);
}

/**
 * Create a task into the shared household list. Resolves the shared list BY NAME
 * (env `M365_SHARED_TODO_LIST`) through a connected member who has allowlisted it
 * — preferring the acting member, else any connected member that has it. Writes
 * outward through that member's connection, then mirrors the created task locally.
 */
export async function createTask(input: CreateTaskInput, actingMemberId: string): Promise<TaskMirrorRow> {
  await assertNotMaintenanceAdmin(actingMemberId);
  const provider = requireProvider();
  const feed = await resolveSharedFeed(actingMemberId);
  const created = await provider.createTask(feed.feedKey, input); // throws TaskProviderError
  return store.upsertMirroredTask(provider.source, feed, created);
}

/** Resolve the shared-household-list feed by display name via the allowlist store. */
async function resolveSharedFeed(actingMemberId: string): Promise<TaskFeed> {
  const name = getSharedListName();
  if (!name) {
    throw new TaskProviderError('shared_list_unavailable', 'No shared To Do list is configured');
  }
  const entries = await store.findAllowlistByName(name);
  if (entries.length === 0) {
    throw new TaskProviderError(
      'shared_list_unavailable',
      `No connected member has allowlisted a list named "${name}"`,
    );
  }
  // Prefer the acting member if they have the shared list; else any member that does.
  const chosen = entries.find((e) => e.memberId === actingMemberId) ?? entries[0]!;
  return {
    feedKey: feedKeys.todoMember(chosen.memberId, chosen.listId),
    memberId: chosen.memberId,
    listId: chosen.listId,
    listName: chosen.listName,
  };
}

/** Re-export so routes/MCP can classify without importing the providers module. */
export { TaskProviderError } from './providers/types.js';
