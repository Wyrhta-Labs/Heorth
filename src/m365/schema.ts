import { pgTable, text, uuid, timestamp, integer, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Connection status for the "wife-debuggable" wall badge (see the M365 plan):
 *  - `active`        — last refresh succeeded.
 *  - `needs_reauth`  — refresh token rejected; the member must reconnect on their
 *                      phone. The wall greys out that feed rather than re-authing.
 *  - `error`         — a transient failure (network/Graph 5xx); retried on poll.
 */
export const M365_CONNECTION_STATUSES = ['active', 'needs_reauth', 'error'] as const;
export type M365ConnectionStatus = (typeof M365_CONNECTION_STATUSES)[number];

/**
 * Per-member delegated connection. One row per member (the account they connected
 * with the auth-code flow). The refresh token is stored ENCRYPTED AT REST
 * (`src/m365/crypto.ts`); it is never returned over the API — see the store's
 * public projection.
 */
export const m365Connections = pgTable('m365_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // The Microsoft account UPN (userPrincipalName) the member connected with.
  accountUpn: text('account_upn').notNull(),
  // AES-256-GCM ciphertext of the OAuth refresh token (iv:tag:ct base64).
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  // Space-delimited granted scopes as returned by the token endpoint.
  scopes: text('scopes').notNull().default(''),
  status: text('status').notNull().default('active'),
  lastRefreshSuccessAt: timestamp('last_refresh_success_at', { withTimezone: true }),
  lastRefreshError: text('last_refresh_error'),
}, (t) => [
  // One connection per member.
  unique('m365_conn_member_unique').on(t.memberId),
  index('m365_conn_member_idx').on(t.memberId),
]);

/**
 * Generic per-feed sync state. Deliberately schema-agnostic so Tasks 2.2/2.3
 * (calendar + To Do providers) can share it. `feedKey` is the discriminator —
 * see `src/m365/feed-keys.ts` for the canonical key convention, e.g.
 * `calendar:member:<id>`, `calendar:family`, `todo:member:<id>:<listId>`.
 */
export const m365SyncState = pgTable('m365_sync_state', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  feedKey: text('feed_key').notNull(),
  // Graph delta/skip token for incremental sync (whichever the feed uses).
  deltaToken: text('delta_token'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
}, (t) => [
  unique('m365_sync_feed_unique').on(t.feedKey),
]);

export type M365ConnectionRow = typeof m365Connections.$inferSelect;
export type M365SyncStateRow = typeof m365SyncState.$inferSelect;
