import { z } from 'zod';
import { LINK_ROLES } from './schema.js';

/** A Paperless document id — validated before any provider call, which keeps
 *  path injection out of provider URLs. */
export const externalIdSchema = z.string().regex(/^[1-9][0-9]{0,9}$/);
export const uuidSchema = z.string().uuid();
export const linkRoleSchema = z.enum(LINK_ROLES);

/** Trimmed, at most 500 chars; blank becomes null. */
const noteSchema = z.string().trim().max(500).transform((s) => (s === '' ? null : s)).nullable().optional();

export const createLinkSchema = z.object({
  externalId: externalIdSchema,
  assetId: uuidSchema.optional(),
  placeId: uuidSchema.optional(),
  role: linkRoleSchema,
  note: noteSchema,
}).refine((v) => (v.assetId === undefined) !== (v.placeId === undefined), {
  message: 'Set exactly one of assetId and placeId',
});

export const updateLinkSchema = z.object({
  role: linkRoleSchema.optional(),
  note: noteSchema,
}).refine((v) => v.role !== undefined || v.note !== undefined, { message: 'Nothing to update' });

export const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(200) });
