import { assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
import { feedKeys } from '../../integrations/feed-keys.js';
import { listProviders } from '../../integrations/registry.js';
import { requireProviderFor, getSharedListName } from './provider.js';
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
 * The default provider used by `setAllowlist` / `createHouseholdTask` is 'm365'
 * — those two are not migrated to per-row resolution in this task (they act
 * BEFORE any mirror row exists, so there is no row to read a source from yet);
 * `resolveSharedFeed` still hardcodes 'm365' for the same reason, unchanged
 * from before this task. Task 12 revisits the household list as a multi-
 * provider concern.
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
 * Create a task into the shared household list. Resolves the shared list BY NAME
 * (env `M365_SHARED_TODO_LIST`) through a connected member who has allowlisted it
 * — preferring the acting member, else any connected member that has it. Writes
 * outward through that member's connection, then mirrors the created task locally.
 */
export async function createTask(input: CreateTaskInput, actingMemberId: string): Promise<TaskMirrorRow> {
  await assertNotMaintenanceAdmin(actingMemberId);
  return createHouseholdTask(input, actingMemberId);
}

/**
 * Create a task into the shared household list without an authenticated actor.
 * `preferMemberId` only influences which allowlisted member feed is chosen.
 */
export async function createHouseholdTask(
  input: CreateTaskInput,
  preferMemberId: string | null,
): Promise<TaskMirrorRow> {
  // Provider checked BEFORE resolving the shared feed — same order as before
  // this task's migration (`requireProvider()` ran first there too), so
  // "the integration is disabled" still reports `provider_unavailable` rather
  // than being masked by a `shared_list_unavailable` from the feed lookup.
  const provider = requireProviderFor(DEFAULT_PROVIDER);
  const feed = await resolveSharedFeed(preferMemberId);
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

/** Resolve the shared-household-list feed by display name via the allowlist store. */
async function resolveSharedFeed(preferMemberId: string | null): Promise<TaskFeed> {
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
  const chosen = entries.find((e) => e.memberId === preferMemberId) ?? entries[0]!;
  return {
    provider: DEFAULT_PROVIDER,
    feedKey: feedKeys.todoMember(DEFAULT_PROVIDER, chosen.memberId, chosen.listId),
    memberId: chosen.memberId,
    listId: chosen.listId,
    listName: chosen.listName,
  };
}

/** Re-export so routes/MCP can classify without importing the providers module. */
export { TaskProviderError } from './providers/types.js';
