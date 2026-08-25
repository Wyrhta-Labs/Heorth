import { z } from 'zod';
import { INTERVAL_UNITS, OCCURRENCE_STATUSES, ROUTINE_MODES } from './schema.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseRoutine = z.object({
  name: z.string().min(1),
  notes: z.string().optional().nullable(),
  mode: z.enum(ROUTINE_MODES),
  intervalUnit: z.enum(INTERVAL_UNITS),
  intervalCount: z.number().int().positive(),
  anchorDate: dateStr,
  leadDays: z.number().int().min(0).optional(),
  ownerMemberId: z.string().uuid().optional().nullable(),
  anchorAssetId: z.string().uuid().optional().nullable(),
  anchorPlaceId: z.string().uuid().optional().nullable(),
});

export const createRoutineSchema = baseRoutine;
export const updateRoutineSchema = baseRoutine.partial().extend({
  active: z.boolean().optional(),
});

export const listRoutinesQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  anchor_asset_id: z.string().uuid().optional(),
  anchor_place_id: z.string().uuid().optional(),
  owner_member_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const listOccurrencesQuerySchema = z.object({
  status: z.enum(OCCURRENCE_STATUSES).optional(),
  routine_id: z.string().uuid().optional(),
  due_to: dateStr.optional(),
});

export const completeSchema = z.object({
  completedAt: z.string().datetime().optional(),
  note: z.string().optional().nullable(),
});

export const skipSchema = z.object({
  note: z.string().optional().nullable(),
});

export type CreateRoutineInput = z.infer<typeof createRoutineSchema>;
export type UpdateRoutineInput = z.infer<typeof updateRoutineSchema>;
