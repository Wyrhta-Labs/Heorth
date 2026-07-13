import { z } from 'zod';
import { MEDIA_TYPES, ITEM_STATUSES, STANDARD_LISTS, PROVIDERS } from './schema.js';

export const createLibraryThingSchema = z.object({
  userid: z.string().min(1),
  key: z.string().min(1),
});

export const pollDeviceSchema = z.object({ device_code: z.string().min(1) });

export const listItemsQuerySchema = z.object({
  mediaType: z.enum(MEDIA_TYPES).optional(),
  memberId: z.string().uuid().optional(),
  provider: z.enum(PROVIDERS).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  list: z.enum(STANDARD_LISTS).optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export type CreateLibraryThingInput = z.infer<typeof createLibraryThingSchema>;
