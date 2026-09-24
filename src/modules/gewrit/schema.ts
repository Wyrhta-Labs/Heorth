import { pgTable, text, uuid, timestamp, date, check, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ethelAssets, ethelPlaces } from '../ethel/schema.js';

export const DOCUMENT_SOURCES = ['paperless', 'fake'] as const;
export const DOCUMENT_STATUSES = ['available', 'missing'] as const;
/** The fixed display order of the panel's groups, too. */
export const LINK_ROLES = ['manual', 'warranty', 'invoice', 'contract', 'certificate', 'other'] as const;

export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type LinkRole = (typeof LINK_ROLES)[number];

/** One row per provider document Heorth knows about (ADR 0017). The snapshot
 *  columns are a copy for display and resilience, never the truth — Paperless
 *  is the system of record. Files are never stored here. */
export const gewritDocuments = pgTable('gewrit_documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  // Also the orphan sweep's age guard: linking touches it (service.ts).
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  documentType: text('document_type'),
  correspondent: text('correspondent'),
  createdOn: date('created_on'),
  status: text('status').notNull().default('available'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
}, (t) => [
  unique('gewrit_documents_source_external_unique').on(t.source, t.externalId),
  check('gewrit_documents_source_check', sql`${t.source} IN ('paperless', 'fake')`),
  check('gewrit_documents_status_check', sql`${t.status} IN ('available', 'missing')`),
]);

/** One document attached to one Ethel element in one role. Exactly one of
 *  asset_id / place_id is set. One nullable column per element type (Weorc's
 *  anchor pattern) keeps real foreign keys and cascades; a later element type is
 *  one more column and a wider CHECK. */
export const gewritLinks = pgTable('gewrit_links', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  documentId: uuid('document_id').notNull().references(() => gewritDocuments.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').references(() => ethelAssets.id, { onDelete: 'cascade' }),
  placeId: uuid('place_id').references(() => ethelPlaces.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  note: text('note'),
}, (t) => [
  check('gewrit_links_element_check', sql`(${t.assetId} IS NULL) <> (${t.placeId} IS NULL)`),
  check('gewrit_links_role_check', sql`${t.role} IN ('manual', 'warranty', 'invoice', 'contract', 'certificate', 'other')`),
  check('gewrit_links_note_check', sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`),
  // NULLS NOT DISTINCT: without it (doc, asset, NULL, role) could repeat,
  // because every NULL is distinct from every other. Plain columns only, so
  // unique() expresses it — unlike ethel_places_parent_name_unique.
  unique('gewrit_links_unique').on(t.documentId, t.assetId, t.placeId, t.role).nullsNotDistinct(),
  index('gewrit_links_document_idx').on(t.documentId),
  index('gewrit_links_asset_idx').on(t.assetId),
  index('gewrit_links_place_idx').on(t.placeId),
]);

export type GewritDocument = typeof gewritDocuments.$inferSelect;
export type GewritLink = typeof gewritLinks.$inferSelect;
