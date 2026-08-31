import { pgTable, text, uuid, timestamp, boolean, unique, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Per-member calendar allowlist — the exact sibling of `todo_list_allowlist`.
 * Nothing syncs by default: a member selects which of their calendars mirror,
 * and the presence of a row IS the feed
 * (`<provider>:calendar:member:<memberId>:<calendarId>`).
 *
 * `is_household` designates THE shared family calendar. At most one row
 * household-wide carries it (partial unique index below). It controls
 * ATTRIBUTION only — the provider emits `kind: 'family'` and `memberId: null`
 * for that feed's events, so they render as shared rather than as the
 * designating member's. The feed key stays member-scoped and stable either way,
 * so toggling the flag never orphans sync state.
 *
 * Why a designated member's calendar rather than a service account: it must
 * work for a consumer Gmail account, where there is no Workspace domain-wide
 * delegation to grant. The accepted cost is that the family feed stops if that
 * member disconnects, which `/api/v1/integrations/status` surfaces.
 */
export const calendarAllowlist = pgTable('calendar_allowlist', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  // Which provider this calendar belongs to ('m365' | 'google'). No default:
  // unlike todo_list_allowlist there are no pre-existing rows to backfill.
  provider: text('provider').notNull(),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  calendarId: text('calendar_id').notNull(),
  calendarName: text('calendar_name'),
  isHousehold: boolean('is_household').notNull().default(false),
}, (t) => [
  unique('calendar_allowlist_provider_member_cal_unique').on(t.provider, t.memberId, t.calendarId),
  index('calendar_allowlist_member_idx').on(t.memberId),
  uniqueIndex('calendar_allowlist_single_household')
    .on(t.isHousehold).where(sql`${t.isHousehold}`),
]);

export type CalendarAllowlistRow = typeof calendarAllowlist.$inferSelect;
