import { pgTable, text, uuid, timestamp, numeric, date, integer, boolean, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';
import { accounts, envelopes, transactions } from '../schema.js';

export const IMPORT_DIRECTIONS = ['in', 'out'] as const;
export const IMPORT_STATUSES = ['pending', 'booked', 'dismissed'] as const;
export type ImportDirection = (typeof IMPORT_DIRECTIONS)[number];
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Source account -> Feoh account, maintained explicitly (ADR 0016). No
 *  auto-creation: an unknown source account never invents or guesses a Feoh
 *  account. `restrict` so a mapping cannot silently dangle. */
export const feohImportAccounts = pgTable('feoh_import_accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  sourceAccountId: text('source_account_id').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
}, (t) => [uniqueIndex('feoh_import_accounts_source_unique').on(t.sourceAccountId)]);

/** payee substring (case-insensitive) -> envelope. Evaluated in (priority, id)
 *  order, first enabled match wins. `restrict` on the envelope: a rule without
 *  an envelope would silently become a non-rule. `restrict` on the author: the
 *  rule's author is who an auto-booked transaction is attributed to, the same
 *  way `transactions.created_by` already restricts. */
export const feohImportRules = pgTable('feoh_import_rules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  pattern: text('pattern').notNull(),
  envelopeId: uuid('envelope_id').notNull().references(() => envelopes.id, { onDelete: 'restrict' }),
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
}, (t) => [
  check('feoh_import_rules_pattern_check', sql`length(${t.pattern}) > 0`),
  index('feoh_import_rules_created_by_idx').on(t.createdBy),
  index('feoh_import_rules_envelope_idx').on(t.envelopeId),
]);

/** The inbox AND the dedup register. Rows are never deleted, including after
 *  booking — that is what makes a re-import a no-op. `set null` on the
 *  transaction is a BACKSTOP only: `deleteTransaction()` moves booked rows back
 *  to `pending` BEFORE the delete, because the pair check below would otherwise
 *  fail during the referential action. */
export const feohImportedTransactions = pgTable('feoh_imported_transactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  sourceId: text('source_id').notNull(),
  sourceAccountId: text('source_account_id').notNull(),
  date: date('date').notNull(),
  payee: text('payee').notNull(),
  memo: text('memo'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  direction: text('direction').notNull(),
  status: text('status').notNull().default('pending'),
  envelopeId: uuid('envelope_id').references(() => envelopes.id, { onDelete: 'set null' }),
  transactionId: uuid('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  appliedRuleId: uuid('applied_rule_id').references(() => feohImportRules.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('feoh_imported_transactions_source_unique').on(t.sourceId),
  check('feoh_imported_transactions_amount_check', sql`${t.amount} > 0`),
  check('feoh_imported_transactions_direction_check', sql`${t.direction} IN ('in', 'out')`),
  check('feoh_imported_transactions_status_check', sql`${t.status} IN ('pending', 'booked', 'dismissed')`),
  check('feoh_imported_transactions_booked_pair_check', sql`(${t.status} = 'booked') = (${t.transactionId} IS NOT NULL)`),
  index('feoh_imported_transactions_status_idx').on(t.status),
  index('feoh_imported_transactions_transaction_idx').on(t.transactionId),
]);

/** Cursor and health per feed, mirroring integration_sync_state. `cursor` is
 *  the provider's opaque watermark and is never exposed over the API. */
export const feohImportState = pgTable('feoh_import_state', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  feedKey: text('feed_key').notNull(),
  cursor: text('cursor'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
}, (t) => [uniqueIndex('feoh_import_state_feed_key_unique').on(t.feedKey)]);

export type ImportAccountMapping = typeof feohImportAccounts.$inferSelect;
export type ImportRule = typeof feohImportRules.$inferSelect;
export type ImportedTransactionRow = typeof feohImportedTransactions.$inferSelect;
export type ImportState = typeof feohImportState.$inferSelect;
