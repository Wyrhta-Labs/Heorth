import { z } from 'zod';

/**
 * Mirror of the server's query contract for GET /api/v1/ethel/assets —
 * `listAssetsQuerySchema` in `src/modules/ethel/validators.ts`.
 *
 * web/ and the backend are independent dependency trees (separate
 * package-locks; the web image stage and the CI web job see neither backend
 * source nor backend node_modules), so the contract cannot be imported across
 * that boundary. It is stated on both sides instead, and pinned on both: the
 * backend route tests pin the server half (cap boundary, paging, q, the place
 * and facility filters), and `web/src/pages/ethel.contract.test.tsx` validates
 * the page's real requests against this mirror. Change one side, change both.
 */
export const listAssetsQuerySchema = z.object({
  status: z.enum(['active', 'decommissioned']).optional(),
  category: z.string().optional(),
  q: z.string().optional(),
  placeId: z.string().uuid().optional(),
  // Only meaningful WITH placeId - a bare includeDescendants has no root.
  // Spelled as an enum, not z.coerce.boolean(): Boolean('false') is true, so
  // coercion would make includeDescendants=false mean the opposite.
  includeDescendants: z.enum(['true', 'false']).optional(),
  hasFacility: z.enum(['true', 'false']).optional(),
  servesPlaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
