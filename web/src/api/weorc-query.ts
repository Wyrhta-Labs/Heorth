import { z } from 'zod';

/**
 * Mirror of the server's query contract for GET /api/v1/weorc/routines and
 * GET /api/v1/weorc/occurrences - `listRoutinesQuerySchema` /
 * `listOccurrencesQuerySchema` in `src/modules/weorc/validators.ts`.
 *
 * web/ and the backend are independent dependency trees (separate
 * package-locks; the web image stage and the CI web job see neither backend
 * source nor backend node_modules), so the contract cannot be imported across
 * that boundary. It is stated on both sides instead, and pinned on both: the
 * backend route tests pin the server half, and the Weorc page's contract test
 * validates the page's real requests against this mirror. Change one side,
 * change both.
 */
export const listRoutinesQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  anchor_asset_id: z.string().uuid().optional(),
  anchor_place_id: z.string().uuid().optional(),
  owner_member_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const listOccurrencesQuerySchema = z.object({
  status: z.enum(['due', 'completed', 'skipped']).optional(),
  routine_id: z.string().uuid().optional(),
  due_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
