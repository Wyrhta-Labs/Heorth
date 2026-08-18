import { Hono } from 'hono';
import { z } from 'zod';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
import { logEvent } from '@wyrhta/core/lib';
import { getKithRuntime } from './runtime.js';
import { KithCredentialError, KithUnreachableError, type KithReminder } from './client.js';

/**
 * KithLedger REST surface, mounted at `/api/v1/kith` (only when the KITH_*
 * env group is configured — see `index.ts`). A stateless live proxy: no
 * mirror table, every request hits KithLedger through the runtime's client.
 *
 * **Whose data this is (ADR 0004 §2, task B8).** `requireAuth` authenticates
 * the Heorth caller, but that identity is never forwarded upstream and this
 * proxy is deliberately not member-scoped: it backs the always-on hearth wall,
 * which in the general case has nobody logged in. Upstream it therefore
 * presents the **household dashboard key**, and every member sees the same
 * thing — the `household`-visible slice. Nothing here writes; the only client
 * method used is a GET.
 *
 * A member-scoped read would need a member JWT from
 * `POST /api/v1/auth/satellite-token` (ADR 0009) instead of the runtime's key.
 * No route here does that, so no token path exists — see `client.ts`.
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
 * unchanged. Upstream unreachable/broken → 502 KITH_UNAVAILABLE; credential
 * refused → 502 KITH_CREDENTIAL_REJECTED.
 *
 * An EMPTY window is an ordinary `200` with `[]`, and always has been — which
 * is what makes the B8 narrowing a non-event for callers. Since the feed reads
 * with the household key it can no longer see anyone's `private` or
 * `shared`-subset reminders, so a household that kept reminders private will
 * legitimately see fewer entries (or none) where it used to see all of them.
 * That is the same shape as "nothing due this week", which the wall already
 * renders as a day column without a reminder chip — no error, no empty-state
 * banner, nothing that reads as broken.
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
    if (e instanceof KithCredentialError) {
      // A configuration fault, not an outage: the key in KITH_API_KEY is not a
      // usable household dashboard key (unknown/revoked, or an `ops` key with
      // no data path). Logged once per request so it is findable in the audit
      // trail — never with the key itself — and given its own code so the
      // operator is not sent looking for a downed KithLedger.
      logEvent({
        event: 'kith.credential.rejected',
        success: false,
        upstream_status: e.status,
        request_id: c.get('requestId'),
      });
      return c.json(
        {
          error: {
            code: 'KITH_CREDENTIAL_REJECTED',
            message: 'KithLedger refused Heorth\'s credential',
          },
        },
        502,
      );
    }
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
