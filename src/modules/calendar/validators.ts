import { z } from 'zod';
import { isPositiveDuration } from '../../lib/duration.js';

/**
 * `recurrence` is an ISO 8601 DURATION (P1W, P1M, PT1H) — the interval the
 * expander advances by — and never an RRULE.
 *
 * It is validated here rather than left to the expander because the failure was
 * asymmetric: the write succeeded, and the cost landed later on every reader.
 * `GET /events?from&to` expands every event in the window, so one unparseable
 * row made the range view 500 for the whole household until someone deleted it.
 * A 400 naming the field is the cheap end of that trade.
 */
const recurrence = z
  .string()
  .refine(isPositiveDuration, 'recurrence must be an ISO 8601 duration that advances, e.g. P1W, P1M, PT1H — not an RRULE');

export const createEventSchema = z.object({
  title: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean().optional().default(false),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  recurrence: recurrence.optional().nullable(),
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
  recurrence: recurrence.optional().nullable(),
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
