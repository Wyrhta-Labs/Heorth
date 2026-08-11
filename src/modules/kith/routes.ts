import { Hono } from 'hono';
import { z } from 'zod';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
import { getKithRuntime } from './runtime.js';
import { KithUnreachableError, type KithReminder } from './client.js';

/**
 * KithLedger REST surface, mounted at `/api/v1/kith` (only when the KITH_*
 * env group is configured — see `index.ts`). A stateless live proxy: no
 * mirror table, every request hits KithLedger through the runtime's client.
 */
export const kithRouter = new Hono();
kithRouter.use('*', requireAuth);

const remindersQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

/** A snoozed reminder is effectively due when the snooze ends, if recorded. */
function effectiveDueAt(r: KithReminder): string {
  return r.status === 'snoozed' && r.snoozedUntil ? r.snoozedUntil : r.dueAt;
}

/**
 * Upcoming reminders in the `[from, to]` window (both ISO datetimes,
 * inclusive), effective-due ascending. KithLedger's API has an upper-bound
 * filter (`due_before`) but no lower bound, so `from` is applied here; the
 * window compares against the effective due (`snoozedUntil` when snoozed),
 * which `due_before` cannot see either. Reminder fields pass through
 * unchanged. Upstream unreachable/broken → 502 KITH_UNAVAILABLE.
 */
kithRouter.get('/reminders', async (c) => {
  const q = remindersQuerySchema.safeParse(c.req.query());
  if (!q.success) {
    return err(c, 'VALIDATION_ERROR', 'from and to must be ISO datetimes', 400);
  }
  const from = Date.parse(q.data.from);
  const to = Date.parse(q.data.to);
  if (from > to) return err(c, 'VALIDATION_ERROR', 'from must not be after to', 400);

  try {
    // due_before bounds dueAt only; snoozed reminders whose original dueAt is
    // inside the bound but whose snooze pushes them past `to` are dropped by
    // the effective-window filter below.
    const upstream = await getKithRuntime().client.listAllReminders({
      statuses: 'pending,snoozed',
      dueBefore: q.data.to,
    });
    const windowed = upstream
      .filter((r) => {
        const due = Date.parse(effectiveDueAt(r));
        return due >= from && due <= to;
      })
      .sort((a, b) => Date.parse(effectiveDueAt(a)) - Date.parse(effectiveDueAt(b)));
    return ok(c, windowed);
  } catch (e) {
    if (e instanceof KithUnreachableError) {
      // `err` from core caps at 500; upstream failure is a 502 like the
      // library/tasks precedents. Never include the API key or the cause.
      return c.json(
        { error: { code: 'KITH_UNAVAILABLE', message: 'KithLedger is unavailable' } }, 502,
      );
    }
    throw e;
  }
});
