import { z } from 'zod';

/**
 * Mirror of the server's query contract for GET /api/v1/inventory/items —
 * `listItemsQuerySchema` in `src/modules/inventory/validators.ts`.
 *
 * web/ and the backend are independent dependency trees (separate
 * package-locks; the web image stage and the CI web job see neither backend
 * source nor backend node_modules), so the contract cannot be imported across
 * that boundary. It is stated on both sides instead, and pinned on both: the
 * backend route tests pin the server half (cap boundary, paging, q), and
 * `web/src/pages/inventory.contract.test.tsx` validates the page's real
 * requests against this mirror. Change one side, change both.
 */
export const listItemsQuerySchema = z.object({
  status: z.enum(['active', 'decommissioned']).optional(),
  category: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});