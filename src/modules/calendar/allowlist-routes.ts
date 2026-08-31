import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
import * as service from './service.js';
import { setCalendarAllowlistSchema, setHouseholdCalendarSchema } from './validators.js';

/**
 * Calendar discovery + allowlist, the sibling of `/api/v1/tasks/lists` and
 * `/api/v1/tasks/allowlist`.
 *
 * A SEPARATE router from `calendarRouter`, because that one is mounted at
 * `/api/v1/events` (see `index.ts`) — putting these on it would produce
 * `/api/v1/events/calendars`. Being separate also means there is no `/:id`
 * route here for `/calendars` to be swallowed by.
 */
export const calendarAllowlistRouter = new Hono();
calendarAllowlistRouter.use('*', requireAuth);

calendarAllowlistRouter.get('/calendars', async (c) => {
  try {
    return ok(c, await service.listAvailableCalendars(c.get('auth').userId));
  } catch (e) {
    if (e instanceof service.UnknownCalendarError) return err(c, 'UNKNOWN_CALENDAR', e.message, 409);
    throw e;
  }
});

calendarAllowlistRouter.put('/allowlist', async (c) => {
  const body = setCalendarAllowlistSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await service.setCalendarAllowlistFor(c.get('auth').userId, body.data.calendars));
  } catch (e) {
    if (e instanceof service.UnknownCalendarError) return err(c, 'UNKNOWN_CALENDAR', e.message, 409);
    throw e;
  }
});

/** Designate the shared family calendar (admin or adult — a household-wide setting). */
calendarAllowlistRouter.put('/household-calendar', async (c) => {
  const auth = c.get('auth');
  if (auth.role !== 'admin' && auth.role !== 'adult') {
    return err(c, 'FORBIDDEN', 'Only an adult can set the household calendar', 403);
  }
  const body = setHouseholdCalendarSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    await service.designateHouseholdCalendar(auth.userId, body.data.provider, body.data.calendarId);
    return ok(c, await service.getHouseholdCalendarView());
  } catch (e) {
    if (e instanceof service.UnknownCalendarError) return err(c, 'UNKNOWN_CALENDAR', e.message, 409);
    throw e;
  }
});
