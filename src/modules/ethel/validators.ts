import { z } from 'zod';
import { placeKinds } from './schema.js';

export const decommissionReasons = ['broken', 'sold', 'given_away', 'worn_out', 'lost', 'other'] as const;
export type DecommissionReason = (typeof decommissionReasons)[number];

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseAsset = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  placeId: z.string().uuid().optional().nullable(),
  locationNote: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  warrantyUntil: dateStr.optional().nullable(),
  purchasePrice: z.number().nonnegative().optional().nullable(),
  purchaseDate: dateStr.optional().nullable(),
});

/** Create rejects all lifecycle state — only decommission sets it. */
export const createAssetSchema = baseAsset;

/** Patch additionally accepts the lifecycle trio ONLY as explicit null for
 *  all three at once (reactivation). Partial lifecycle edits are rejected. */
export const updateAssetSchema = baseAsset.partial().extend({
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

export const listAssetsQuerySchema = z.object({
  status: z.enum(['active', 'decommissioned']).optional(),
  category: z.string().optional(),
  q: z.string().optional(),
  placeId: z.string().uuid().optional(),
  // Only meaningful WITH placeId - a bare includeDescendants has no root.
  // Spelled as an enum, not z.coerce.boolean(): Boolean('false') is true, so
  // coercion would make includeDescendants=false mean the opposite.
  includeDescendants: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type DecommissionInput = z.infer<typeof decommissionSchema>;

const basePlace = z.object({
  name: z.string().min(1),
  kind: z.enum(placeKinds),
  parentId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const createPlaceSchema = basePlace;
export const updatePlaceSchema = basePlace.partial();

export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;
export type UpdatePlaceInput = z.infer<typeof updatePlaceSchema>;

export const vehicleSchema = z.object({
  registration: z.string().min(1).optional().nullable(),
  vin: z.string().min(1).optional().nullable(),
  firstRegisteredOn: dateStr.optional().nullable(),
  odometer: z.number().int().nonnegative().optional().nullable(),
  odometerReadAt: dateStr.optional().nullable(),
  serviceIntervalMonths: z.number().int().positive().optional().nullable(),
}).superRefine((v, ctx) => {
  // Mirror the CHECK so the 400 explains itself instead of arriving as a 500
  // from a constraint violation.
  if ((v.odometer == null) !== (v.odometerReadAt == null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'odometer and odometerReadAt must be set together' });
  }
});

export type VehicleInput = z.infer<typeof vehicleSchema>;
