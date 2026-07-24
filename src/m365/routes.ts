import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../wiring.js';
import { getM365Runtime } from './runtime.js';
import { signConnectState, verifyConnectState } from './state.js';

/**
 * M365 connection routes. Mounted at `/api/v1/m365` ONLY when the integration is
 * enabled (see `index.ts`); when disabled the paths fall through to the app's
 * catch-all 404 — the documented disabled-mode behaviour.
 *
 *  GET    /connect     (auth)  → 302 to Microsoft consent (state binds the member)
 *  GET    /callback            → exchange code, store encrypted refresh token
 *  GET    /status      (auth)  → acting member's connection (admin sees all)
 *  DELETE /connection  (auth)  → acting member disconnects (row deleted)
 */
export const m365Router = new Hono();

m365Router.get('/connect', requireAuth, async (c) => {
  const memberId = c.get('auth').userId;
  const state = await signConnectState(memberId);
  const url = getM365Runtime().delegated.authorizeUrl(state);
  return c.redirect(url, 302);
});

m365Router.get('/callback', async (c) => {
  const rt = getM365Runtime();
  const error = c.req.query('error');
  if (error) {
    return err(c, 'M365_CONSENT_DENIED', c.req.query('error_description') ?? error, 400);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return err(c, 'M365_CALLBACK_INVALID', 'Missing code or state', 400);

  const memberId = await verifyConnectState(state);
  if (!memberId) return err(c, 'M365_STATE_INVALID', 'State validation failed', 400);

  try {
    const { refreshToken, accessToken, scopes } = await rt.delegated.exchangeCode(code);
    const me = await rt.delegated.getMe(accessToken);
    await rt.store.upsertConnection({
      memberId, accountUpn: me.userPrincipalName, refreshToken, scopes,
    });
  } catch {
    // Upstream identity/Graph failure or unexpected error. Details are not
    // surfaced (may reference tokens); the member simply retries the connect.
    return err(c, 'M365_EXCHANGE_FAILED', 'Failed to complete M365 connection', 500);
  }
  return c.redirect('/?m365=connected', 302);
});

m365Router.get('/status', requireAuth, async (c) => {
  const rt = getM365Runtime();
  const auth = c.get('auth');
  if (auth.role === 'admin') {
    return ok(c, { connections: await rt.store.listConnections() });
  }
  const conn = await rt.store.getConnection(auth.userId);
  return ok(c, { connection: conn });
});

m365Router.delete('/connection', requireAuth, async (c) => {
  const deleted = await getM365Runtime().store.deleteConnection(c.get('auth').userId);
  if (!deleted) return err(c, 'NOT_FOUND', 'No M365 connection to disconnect', 404);
  return ok(c, { disconnected: true });
});
