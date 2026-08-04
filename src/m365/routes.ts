import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../wiring.js';
import { assertNotMaintenanceAdmin } from '../household/maintenance-admin.js';
import { getM365Runtime } from './runtime.js';
import { signConnectState, verifyConnectState } from './state.js';
import { runCalendarSync } from './calendar-sync.js';
import { runTaskSync } from './task-sync.js';
import type { M365SyncStateRow } from './schema.js';

/**
 * Public projection of per-feed sync state for the health surface / Hearth View
 * staleness badges (Task 2.5). Never exposes the delta token (an opaque Graph
 * URL that embeds the mailbox) — only the classified last error and counters.
 */
function toPublicFeed(row: M365SyncStateRow) {
  return {
    feedKey: row.feedKey,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    updatedAt: row.updatedAt,
  };
}

/**
 * M365 connection routes. Mounted at `/api/v1/m365` ONLY when the integration is
 * enabled (see `index.ts`); when disabled the paths fall through to the app's
 * catch-all 404 — the documented disabled-mode behaviour.
 *
 *  GET    /connect     (auth)  → 302 to Microsoft consent (state binds the member)
 *  GET    /connect-url (auth)  → 200 JSON { url } twin of /connect (Task 8; see below)
 *  GET    /callback            → exchange code, store encrypted refresh token
 *  GET    /status      (auth)  → acting member's connection (admin sees all
 *                                connections); `feeds[]` is EVERY feed's sync
 *                                status regardless of role — no secrets in it,
 *                                and the Hearth View needs household-wide
 *                                staleness even for a non-admin kiosk session.
 *  DELETE /connection  (auth)  → acting member disconnects (row deleted)
 */
export const m365Router = new Hono();

m365Router.get('/connect', requireAuth, async (c) => {
  const memberId = c.get('auth').userId;
  const state = await signConnectState(memberId);
  const url = getM365Runtime().delegated.authorizeUrl(state);
  return c.redirect(url, 302);
});

/**
 * JSON twin of `/connect`. The web client authenticates with a Bearer token from
 * localStorage, which a top-level browser navigation cannot carry — so the UI
 * fetches the consent URL here and assigns `window.location.href` itself.
 */
m365Router.get('/connect-url', requireAuth, async (c) => {
  const memberId = c.get('auth').userId;
  await assertNotMaintenanceAdmin(memberId);
  const state = await signConnectState(memberId);
  return ok(c, { url: getM365Runtime().delegated.authorizeUrl(state) });
});

m365Router.get('/callback', async (c) => {
  const rt = getM365Runtime();
  const error = c.req.query('error');
  if (error) {
    return c.redirect('/profile?connectError=M365_CONSENT_DENIED', 302);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.redirect('/profile?connectError=M365_CALLBACK_INVALID', 302);

  const memberId = await verifyConnectState(state);
  if (!memberId) return c.redirect('/profile?connectError=M365_STATE_INVALID', 302);

  await assertNotMaintenanceAdmin(memberId);

  try {
    const { refreshToken, accessToken, scopes } = await rt.delegated.exchangeCode(code);
    const me = await rt.delegated.getMe(accessToken);
    await rt.store.upsertConnection({
      memberId, accountUpn: me.userPrincipalName, refreshToken, scopes,
    });
  } catch {
    // Upstream identity/Graph failure or unexpected error. Details are not
    // surfaced (may reference tokens); the member simply retries the connect.
    return c.redirect('/profile?connectError=M365_EXCHANGE_FAILED', 302);
  }
  return c.redirect('/profile?connected=m365', 302);
});

m365Router.get('/status', requireAuth, async (c) => {
  const rt = getM365Runtime();
  const auth = c.get('auth');
  // feeds[] is household-visible to ANY authenticated session (Phase 2 review,
  // Finding 2): a feed status carries no secrets (feedKey, lastSuccessAt, a
  // classified lastError, consecutiveFailures, updatedAt — see toPublicFeed),
  // and the Hearth View composes every member's events, so a non-admin kiosk
  // session must be able to see staleness for feeds it doesn't own — otherwise
  // the wall can look current while another member's feed is silently dead.
  // Connection details (account UPN etc.) stay member-scoped for non-admins.
  const feeds = (await rt.store.listSyncState()).map(toPublicFeed);
  if (auth.role === 'admin') {
    return ok(c, { connections: await rt.store.listConnections(), feeds });
  }
  const conn = await rt.store.getConnection(auth.userId);
  return ok(c, { connection: conn, feeds });
});

/**
 * Manual sync trigger (admin only) — runs all calendar feeds then all To Do
 * feeds once and returns the combined per-feed result summary. Used by dev +
 * tests to drive sync deterministically without waiting for the scheduler tick.
 */
m365Router.post('/sync', requireAuth, requireRole('admin'), async (c) => {
  const rt = getM365Runtime();
  const calendar = await runCalendarSync(rt);
  const tasks = await runTaskSync(rt);
  return ok(c, { results: [...calendar, ...tasks] });
});

m365Router.delete('/connection', requireAuth, async (c) => {
  const deleted = await getM365Runtime().store.deleteConnection(c.get('auth').userId);
  if (!deleted) return err(c, 'NOT_FOUND', 'No M365 connection to disconnect', 404);
  return ok(c, { disconnected: true });
});
