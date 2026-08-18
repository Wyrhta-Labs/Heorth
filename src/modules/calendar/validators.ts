import { z } from 'zod';

export const createEventSchema = z.object({
  title: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean().optional().default(false),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  recurrence: z.string().optional().nullable(),
  attendeeIds: z.array(z.string().uuid()).optional().default([]),
}).refine((v) => new Date(v.endAt) >= new Date(v.startAt), {
  message: 'endAt must be on or after startAt', path: ['endAt'],
});

export const updateEventSchema = z.object({
  title: z.string().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  recurrence: z.string().optional().nullable(),
  attendeeIds: z.array(z.string().uuid()).optional(),
});

export const moveEventSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
});

/**
 * Query for `GET /api/v1/events`. All parameters are optional.
 *  - `from`/`to` (both required together) switch to the range view, where
 *    recurring events are expanded into occurrences and read-only mirrored
 *    external events are merged in.
 *  - `member_id` restricts to events that member created or attends (mirrored
 *    events are matched on their attributed member).
 *  - `limit`/`offset` page the result. In the range view they bound the
 *    EXPANDED OCCURRENCES, not the underlying event rows; without a range they
 *    page the raw event rows. Together with `from`/`to` + `member_id` this makes
 *    "the next N upcoming occurrences, optionally for one member" a single
 *    bounded REST query.
 */
export const listEventsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  member_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type MoveEventInput = z.infer<typeof moveEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
