import { z } from 'zod';

export const decommissionReasons = ['broken', 'sold', 'given_away', 'worn_out', 'lost', 'other'] as const;
export type DecommissionReason = (typeof decommissionReasons)[number];

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseItem = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  warrantyUntil: dateStr.optional().nullable(),
  purchasePrice: z.number().nonnegative().optional().nullable(),
  purchaseDate: dateStr.optional().nullable(),
});

/** Create rejects all lifecycle state — only decommission sets it. */
export const createItemSchema = baseItem;

/** Patch additionally accepts the lifecycle trio ONLY as explicit null for
 *  all three at once (reactivation). Partial lifecycle edits are rejected. */
export const updateItemSchema = baseItem.partial().extend({
  decommissionedAt: z.null().optional(),
  decommissionReason: z.null().optional(),
  disposalProceeds: z.null().optional(),
}).superRefine((v, ctx) => {
  const trio = ['decommissionedAt', 'decommissionReason', 'disposalProceeds'] as const;
  const present = trio.filter((k) => k in v);
  if (present.length > 0 && present.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reactivation must null all three lifecycle fields together' });
  }
});

export const decommissionSchema = z.object({
  date: dateStr,
  reason: z.enum(decommissionReasons),
  proceeds: z.number().nonnegative().optional(),
});

export const listItemsQuerySchema = z.object({
  status: z.enum(['active', 'decommissioned']).optional(),
  category: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type DecommissionInput = z.infer<typeof decommissionSchema>;
