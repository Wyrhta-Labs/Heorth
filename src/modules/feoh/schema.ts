import { pgTable, text, uuid, timestamp, numeric, date, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  openingBalance: numeric('opening_balance', { precision: 14, scale: 2 }).notNull().default('0'),
}, (t) => [check('account_kind_check', sql`${t.kind} IN ('asset', 'liability')`)]);

export const envelopes = pgTable('envelopes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  monthlyBudget: numeric('monthly_budget', { precision: 14, scale: 2 }).notNull().default('0'),
  tone: text('tone'),
});

// `createdBy` references Heorth's `users` table directly (whichever household
// member recorded the transaction) — the parties boundary Feoh introduced for
// its standalone deployment is removed now that finance is a built-in Heorth
// module again (ADR 0007). No `onDelete` action (defaults to RESTRICT) — a
// member referenced by a transaction cannot be hard-deleted.
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  date: date('date').notNull(),
  payee: text('payee').notNull(),
  memo: text('memo'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
}, (t) => [index('transactions_created_by_idx').on(t.createdBy)]);

export const postings = pgTable('postings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  envelopeId: uuid('envelope_id').references(() => envelopes.id, { onDelete: 'set null' }),
  debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0'),
  credit: numeric('credit', { precision: 14, scale: 2 }).notNull().default('0'),
}, (t) => [
  index('postings_transaction_id_idx').on(t.transactionId),
  index('postings_account_id_idx').on(t.accountId),
  index('postings_envelope_id_idx').on(t.envelopeId),
]);

export const recurringBills = pgTable('recurring_bills', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  payee: text('payee').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  cadence: text('cadence').notNull(),
  nextDue: date('next_due').notNull(),
  envelopeId: uuid('envelope_id').references(() => envelopes.id, { onDelete: 'set null' }),
}, (t) => [index('recurring_bills_envelope_id_idx').on(t.envelopeId)]);

// `memberId` references Heorth's `users` table directly — the parties
// boundary Feoh introduced for its standalone deployment is removed now that
// finance is a built-in Heorth module again (ADR 0007). No `onDelete` action
// (defaults to RESTRICT) — a member referenced by an expense split cannot be
// hard-deleted.
export const expenseSplits = pgTable('expense_splits', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => users.id),
  share: numeric('share', { precision: 14, scale: 2 }).notNull(),
}, (t) => [
  index('expense_splits_transaction_id_idx').on(t.transactionId),
  index('expense_splits_member_id_idx').on(t.memberId),
]);

export type Account = typeof accounts.$inferSelect;
export type Envelope = typeof envelopes.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Posting = typeof postings.$inferSelect;
export type RecurringBill = typeof recurringBills.$inferSelect;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
