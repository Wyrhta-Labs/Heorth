import { pgTable, text, uuid, timestamp, integer, numeric, jsonb, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

export const PROVIDERS = ['trakt', 'librarything'] as const;
export const CONNECTION_STATUSES = ['active', 'needs_reauth', 'error'] as const;
export const MEDIA_TYPES = ['book', 'ebook', 'movie', 'series'] as const;
export const ITEM_STATUSES = ['unread', 'reading', 'read', 'watching', 'watched'] as const;
export const STANDARD_LISTS = ['later', 'favorites'] as const;

export type Provider = (typeof PROVIDERS)[number];
export type MediaType = (typeof MEDIA_TYPES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type StandardList = (typeof STANDARD_LISTS)[number];

export const libraryConnections = pgTable('library_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  externalRef: text('external_ref').notNull(),
  credentials: text('credentials'),
  status: text('status').notNull().default('active'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastSyncError: text('last_sync_error'),
  itemCount: integer('item_count').notNull().default(0),
}, (t) => [
  unique('library_conn_unique').on(t.provider, t.externalRef, t.memberId),
  index('library_conn_member_idx').on(t.memberId),
]);

export const libraryItems = pgTable('library_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`now()`),
  connectionId: uuid('connection_id').notNull().references(() => libraryConnections.id, { onDelete: 'cascade' }),
  mediaType: text('media_type').notNull(),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  sortTitle: text('sort_title').notNull(),
  creators: text('creators').array().notNull().default(sql`'{}'`),
  year: integer('year'),
  coverUrl: text('cover_url'),
  status: text('status'),
  lists: text('lists').array().notNull().default(sql`'{}'`),
  rating: numeric('rating'),
  tags: text('tags').array().notNull().default(sql`'{}'`),
  sourceUrl: text('source_url'),
  raw: jsonb('raw').notNull().default(sql`'{}'::jsonb`),
}, (t) => [
  unique('library_item_unique').on(t.connectionId, t.mediaType, t.externalId),
  index('library_item_conn_idx').on(t.connectionId),
  index('library_item_media_idx').on(t.mediaType),
]);

export type LibraryConnectionRow = typeof libraryConnections.$inferSelect;
export type LibraryItemRow = typeof libraryItems.$inferSelect;
