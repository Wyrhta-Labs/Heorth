import { z } from 'zod';

export const createAccountSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['asset', 'liability']),
  openingBalance: z.number().default(0),
});
export const updateAccountSchema = createAccountSchema.partial();

export const createEnvelopeSchema = z.object({
  name: z.string().min(1),
  monthlyBudget: z.number().nonnegative().default(0),
  tone: z.string().optional().nullable(),
});
export const updateEnvelopeSchema = createEnvelopeSchema.partial();

const postingInput = z.object({
  accountId: z.string().uuid().optional().nullable(),
  envelopeId: z.string().uuid().optional().nullable(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
}).refine((p) => p.accountId || p.envelopeId, { message: 'posting must reference an account or envelope' });

// `createdBy` is not part of the input schema — the acting household member
// is derived from the request's auth principal by the route/service caller
// (see service.ts's `recordTransaction`), same as pre-Feoh-extraction
// semantics (ADR 0007).
export const recordTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee: z.string().min(1),
  memo: z.string().optional().nullable(),
  amount: z.number(),
  postings: z.array(postingInput).min(2, 'a transaction needs at least two postings'),
  splits: z.array(z.object({ memberId: z.string().uuid(), share: z.number() })).optional().default([]),
});

export const listTransactionsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export const createBillSchema = z.object({
  payee: z.string().min(1),
  amount: z.number(),
  cadence: z.string().min(1),
  nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  envelopeId: z.string().uuid().optional().nullable(),
});
export const updateBillSchema = createBillSchema.partial();

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type CreateEnvelopeInput = z.infer<typeof createEnvelopeSchema>;
export type RecordTransactionInput = z.infer<typeof recordTransactionSchema>;
export type CreateBillInput = z.infer<typeof createBillSchema>;
