import { z } from 'zod';
import { IMPORT_DIRECTIONS, IMPORT_STATUSES } from './schema.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const upsertAccountMappingSchema = z.object({
  sourceAccountId: z.string().min(1).max(200),
  accountId: z.string().uuid(),
});

export const createRuleSchema = z.object({
  pattern: z.string().min(1).max(200),
  envelopeId: z.string().uuid(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
});
export const updateRuleSchema = createRuleSchema.partial();

export const listInboxQuerySchema = z.object({
  status: z.enum(IMPORT_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const confirmInboxSchema = z.object({
  envelopeId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
});

/** A hand-typed statement line. `sourceId` is optional and gets the `manual:` prefix server-side. */
export const manualLineSchema = z.object({
  sourceId: z.string().min(1).max(200).optional(),
  sourceAccountId: z.string().min(1).max(200),
  date: isoDate,
  payee: z.string().min(1).max(500),
  memo: z.string().max(2000).optional().nullable(),
  amount: z.number().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  direction: z.enum(IMPORT_DIRECTIONS),
});
