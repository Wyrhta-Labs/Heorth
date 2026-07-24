import { pgTable, text, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Mirror of external (Microsoft To Do, later other providers) tasks. A SIBLING
 * table — the same design as `calendar_mirror_events` (Task 2.2): Heorth has NO
 * native task storage (ADR 0001 — To Do is the system of record), so this table
 * IS the task surface. Unlike the calendar mirror it is NOT read-only: completion
 * writes back through the provider and reconciles here, and Heorth-created tasks
 * land here after the outward create.
 *
 * `externalId` is the Graph task id, unique within a feed. A full re-sync (410 or
 * periodic) replaces the feed's rows atomically by `feed_key`.
 */
export const TASK_STATUSES = ['open', 'completed'] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export const taskMirror = pgTable('task_mirror', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`now()`),
  // Source discriminator (e.g. 'm365'); future providers reuse this table.
  source: text('source').notNull(),
  // Canonical sync feed key (todo:member:<id>:<listId>).
  feedKey: text('feed_key').notNull(),
  // Stable id within the feed (Graph todoTask id).
  externalId: text('external_id').notNull(),
  // Member whose delegated connection owns the feed (To Do is delegated-only).
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Source list attribution + cached display name.
  listId: text('list_id').notNull(),
  listName: text('list_name'),
  title: text('title').notNull(),
  notes: text('notes'),
  // Absolute instants (see providers/types.ts).
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // 'open' | 'completed'.
  status: text('status').notNull().default('open'),
}, (t) => [
  unique('task_mirror_feed_ext_unique').on(t.feedKey, t.externalId),
  index('task_mirror_feed_idx').on(t.feedKey),
  index('task_mirror_member_idx').on(t.memberId),
  index('task_mirror_status_idx').on(t.status),
  index('task_mirror_due_idx').on(t.dueAt),
]);

/**
 * Per-member To Do list allowlist. Nothing syncs by default; a member selects
 * which of their lists sync. Presence of a row = that list is allowlisted (its
 * feed `todo:member:<memberId>:<listId>` is enumerated by the sync runner). The
 * cached `listName` also backs shared-household-list resolution BY NAME.
 */
export const todoListAllowlist = pgTable('todo_list_allowlist', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listId: text('list_id').notNull(),
  listName: text('list_name'),
}, (t) => [
  unique('todo_allowlist_member_list_unique').on(t.memberId, t.listId),
  index('todo_allowlist_member_idx').on(t.memberId),
]);

export type TaskMirrorRow = typeof taskMirror.$inferSelect;
export type NewTaskMirrorRow = typeof taskMirror.$inferInsert;
export type TodoListAllowlistRow = typeof todoListAllowlist.$inferSelect;
