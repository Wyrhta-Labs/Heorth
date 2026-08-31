import { pgTable, text, uuid, timestamp, integer, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Connection status for the "wife-debuggable" wall badge:
 *  - `active`        — last refresh succeeded.
 *  - `needs_reauth`  — refresh token rejected; the member must reconnect on their
 *                      phone. The wall greys out that feed rather than re-authing.
 *  - `error`         — a transient failure (network/upstream 5xx); retried on poll.
 */
export const INTEGRATION_CONNECTION_STATUSES = ['active', 'needs_reauth', 'error'] as const;
export type IntegrationConnectionStatus = (typeof INTEGRATION_CONNECTION_STATUSES)[number];

/**
 * Per-member delegated connection to ONE external provider. A member may hold
 * one connection per provider (`unique(provider, member_id)`) — that is what
 * makes M365 and Google usable side by side, and it is why this table is no
 * longer `m365_connections`.
 *
 * The refresh token is stored ENCRYPTED AT REST (`src/integrations/crypto.ts`);
 * it is never returned over the API — see the store's public projection.
 */
export const integrationConnections = pgTable('integration_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  // Provider discriminator: 'm365' | 'google'. Matches the `source` column on
  // the two mirror tables.
  provider: text('provider').notNull().default('m365'),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Human-readable account identity for display. M365 stores the userPrincipalName;
  // Google stores the account email. Deliberately NOT `account_upn` — that name
  // only made sense while Microsoft was the only provider.
  accountLabel: text('account_label').notNull(),
  // AES-256-GCM ciphertext of the OAuth refresh token (iv:tag:ct base64).
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  // Space-delimited granted scopes as returned by the token endpoint.
  scopes: text('scopes').notNull().default(''),
  status: text('status').notNull().default('active'),
  lastRefreshSuccessAt: timestamp('last_refresh_success_at', { withTimezone: true }),
  lastRefreshError: text('last_refresh_error'),
}, (t) => [
  // One connection per member PER PROVIDER.
  unique('integration_conn_provider_member_unique').on(t.provider, t.memberId),
  index('integration_conn_member_idx').on(t.memberId),
]);

/**
 * Generic per-feed sync state, shared by every provider and both surfaces
 * (calendar + tasks). `feedKey` is the discriminator and carries a provider
 * segment — see `src/integrations/feed-keys.ts`.
 */
export const integrationSyncState = pgTable('integration_sync_state', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  feedKey: text('feed_key').notNull(),
  // Opaque incremental-sync token, whatever the provider's flavour: a Graph
  // delta URL, a Google syncToken. Never exposed over the API — a Graph delta
  // URL embeds the mailbox.
  syncToken: text('sync_token'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  // When the feed last did a FULL (freshly-windowed) sync — the initial pull, a
  // token-invalidation recovery, or a deterministic periodic re-window.
  // Incremental replay ticks do NOT update this. Null means "never" (forces a
  // full sync on the next tick).
  lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
}, (t) => [
  unique('integration_sync_feed_unique').on(t.feedKey),
]);

export type IntegrationConnectionRow = typeof integrationConnections.$inferSelect;
export type IntegrationSyncStateRow = typeof integrationSyncState.$inferSelect;
