/**
 * Provider-agnostic contract for a household task source. Lives WITH the tasks
 * module (not `src/m365/`) so the abstraction has zero Microsoft Graph coupling
 * and a future provider (Google Tasks, CalDAV VTODO, …) slots in beside the
 * Graph one. The Graph implementation (`src/m365/task-provider.ts`) depends on
 * this file; never the reverse.
 *
 * Microsoft To Do is the system of record (ADR 0001). Unlike the read-only
 * calendar mirror, tasks are interactive: completion writes back through the
 * provider and Heorth can create tasks outward into the shared household list.
 */

export type TaskStatus = 'open' | 'completed';

/** One task as normalized from the source, ready for the mirror. */
export interface MirroredTask {
  externalId: string;
  title: string;
  notes: string | null;
  /** Absolute UTC instant of the due date, or null. */
  dueAt: string | null;
  /** Absolute UTC instant the task was completed, or null when still open. */
  completedAt: string | null;
  status: TaskStatus;
  /** Source list id this task belongs to (list attribution). */
  listId: string;
  /** Cached display name of the source list (may be null if unknown). */
  listName: string | null;
  /** Household member whose delegated connection owns the feed (attribution). */
  memberId: string;
}

/** One To Do list a member can choose to sync (from list discovery). */
export interface AvailableList {
  id: string;
  name: string;
}

/** Fields Heorth sends when creating a task outward. */
export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  /** Absolute UTC instant, or null/omitted for no due date. */
  dueAt?: string | null;
}

/**
 * The result of pulling one feed's changes. Mirrors the calendar `PullResult`:
 * `fullResync` signals "this is a fresh full snapshot, REPLACE the feed" so the
 * store never trusts stale `deletions` across a gap (410 recovery or a periodic
 * full re-sync).
 */
export interface TaskPullResult {
  upserts: MirroredTask[];
  deletions: string[];
  nextToken: string | null;
  fullResync: boolean;
}

/**
 * A classified, Graph-free error the write paths throw so the tasks module can
 * translate a failure to an HTTP status / MCP message WITHOUT importing any Graph
 * type. `reason` is a short token (`needs_reauth`, `no_connection`, `graph_<n>`,
 * `network_error`, `error`, `shared_list_unavailable`, `provider_unavailable`).
 */
export class TaskProviderError extends Error {
  constructor(public readonly reason: string, message?: string) {
    super(message ?? reason);
    this.name = 'TaskProviderError';
  }
}

/**
 * Provider-agnostic task source. All methods key on the canonical feed key
 * (`todo:member:<memberId>:<listId>`); the provider resolves auth + the list
 * from it internally.
 */
export interface TaskProvider {
  readonly source: string; // 'm365'

  /** Discover the To Do lists a member can choose to sync (delegated). */
  listAvailableLists(memberId: string): Promise<AvailableList[]>;

  /**
   * Pull incremental (or, when `forceFullResync` / on token expiry, full)
   * changes for one feed. Throws the raw provider error on failure; the sync
   * runner classifies it.
   */
  pullChanges(
    feedKey: string, syncToken: string | null, forceFullResync?: boolean,
  ): Promise<TaskPullResult>;

  /**
   * Write back a completion state change for one task. Throws
   * {@link TaskProviderError} (classified) on failure — never a raw Graph error.
   */
  setCompleted(feedKey: string, externalId: string, completed: boolean): Promise<void>;

  /**
   * Create a task in the feed's list and return the created task. Throws
   * {@link TaskProviderError} (classified) on failure.
   */
  createTask(feedKey: string, input: CreateTaskInput): Promise<MirroredTask>;
}
