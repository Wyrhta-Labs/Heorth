import { pgTable, text, uuid, timestamp, numeric, date, check } from 'drizzle-orm/pg-core';
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

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  date: date('date').notNull(),
  payee: text('payee').notNull(),
  memo: text('memo'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
});

export const postings = pgTable('postings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  envelopeId: uuid('envelope_id').references(() => envelopes.id, { onDelete: 'set null' }),
  debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0'),
  credit: numeric('credit', { precision: 14, scale: 2 }).notNull().default('0'),
});

export const recurringBills = pgTable('recurring_bills', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  payee: text('payee').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  cadence: text('cadence').notNull(),
  nextDue: date('next_due').notNull(),
  envelopeId: uuid('envelope_id').references(() => envelopes.id, { onDelete: 'set null' }),
});

export const expenseSplits = pgTable('expense_splits', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  share: numeric('share', { precision: 14, scale: 2 }).notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type Envelope = typeof envelopes.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Posting = typeof postings.$inferSelect;
export type RecurringBill = typeof recurringBills.$inferSelect;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
