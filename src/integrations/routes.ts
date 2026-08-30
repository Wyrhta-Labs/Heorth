import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../wiring.js';
import { assertNotMaintenanceAdmin, isMaintenanceAdminId } from '../household/maintenance-admin.js';
import { getHouseholdFeed } from '../modules/tasks/store.js';
import { signConnectState, verifyConnectState } from './state.js';
import { getProvider, listProviders } from './registry.js';
import type { IntegrationSyncStateRow } from './schema.js';

/**
 * Public projection of per-feed sync state for the health surface and the Hearth
 * View staleness badges. NEVER exposes the sync token — a Graph delta token is
 * an opaque URL that embeds the mailbox.
 */
function toPublicFeed(row: IntegrationSyncStateRow) {
  return {
    feedKey: row.feedKey,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    updatedAt: row.updatedAt,
  };
}

/**
 * Provider-scoped connection routes, mounted at `/api/v1/integrations`.
 * Replaces `/api/v1/m365/*`, which could only ever describe one provider.
 *
 * Role rules are carried over verbatim from the M365 routes:
 *  - `feeds[]` is household-visible to ANY authenticated session. It carries no
 *    secrets, and the Hearth View composes every member's events — so a non-admin
 *    kiosk session must see staleness for feeds it does not own, otherwise the
 *    wall can look current while another member's feed is silently dead.
 *  - the household-wide `connections` list is admin AND adult: it carries no
 *    token material, and an adult co-parent must be able to see that another
 *    member's link is dead. Children stay scoped to their own connection.
 *  - an admin session may itself be a promoted household member, so it must still
 *    see and be able to disconnect its OWN connection.
 */
export const integrationsRouter = new Hono();

// --- literal routes first, so they do not collide with /:provider/… ---------

integrationsRouter.get('/status', requireAuth, async (c) => {
  const auth = c.get('auth');
  const providers = listProviders();
  // Sync state is not provider-scoped: one call returns every feed the household
  // has, which is exactly what the wall needs.
  const feeds = providers.length > 0
    ? (await providers[0]!.store.listSyncState()).map(toPublicFeed)
    : [];

  const householdListDesignated = (await getHouseholdFeed()) !== null;

  if (auth.role === 'admin' || auth.role === 'adult') {
    const perProvider = await Promise.all(providers.map(async (p) => ({
      connection: await p.store.getConnection(auth.userId),
      connections: (await p.store.listConnections()).map((row) => ({ ...row, provider: p.id })),
    })));
    return ok(c, {
      connection: perProvider.map((r) => r.connection).find((r) => r !== null) ?? null,
      connections: perProvider.flatMap((r) => r.connections),
      feeds,
      householdListDesignated,
      providers: providers.map((p) => p.id),
    });
  }

  const own = await Promise.all(providers.map((p) => p.store.getConnection(auth.userId)));
  return ok(c, {
    connection: own.find((r) => r !== null) ?? null,
    feeds,
    providers: providers.map((p) => p.id),
  });
});

/**
 * Manual sync trigger (admin only) — runs every registered provider's calendar
 * feeds then its task feeds once, and returns the combined per-feed summary.
 * Used by dev and tests to drive sync deterministically without the scheduler.
 */
integrationsRouter.post('/sync', requireAuth, requireRole('admin'), async (c) => {
  const results = [];
  for (const p of listProviders()) {
    results.push(...await p.runCalendarSync());
    results.push(...await p.runTaskSync());
  }
  return ok(c, { results });
});

// --- provider-scoped --------------------------------------------------------

integrationsRouter.get('/:provider/connect', requireAuth, async (c) => {
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return err(c, 'NOT_FOUND', 'Unknown or disabled provider', 404);
  const state = await signConnectState(c.get('auth').userId);
  return c.redirect(provider.authorizeUrl(state), 302);
});

/**
 * JSON twin of `/connect`. The web client authenticates with a Bearer token from
 * localStorage, which a top-level browser navigation cannot carry — so the UI
 * fetches the consent URL here and assigns `window.location.href` itself.
 */
integrationsRouter.get('/:provider/connect-url', requireAuth, async (c) => {
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return err(c, 'NOT_FOUND', 'Unknown or disabled provider', 404);
  const memberId = c.get('auth').userId;
  await assertNotMaintenanceAdmin(memberId);
  const state = await signConnectState(memberId);
  return ok(c, { url: provider.authorizeUrl(state) });
});

integrationsRouter.get('/:provider/callback', async (c) => {
  const id = c.req.param('provider');
  const provider = getProvider(id);
  if (!provider) return c.redirect('/profile?connectError=UNKNOWN_PROVIDER', 302);

  if (c.req.query('error')) {
    return c.redirect(`/profile?connectError=${id.toUpperCase()}_CONSENT_DENIED`, 302);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.redirect(`/profile?connectError=${id.toUpperCase()}_CALLBACK_INVALID`, 302);
  }

  const memberId = await verifyConnectState(state);
  if (!memberId) return c.redirect(`/profile?connectError=${id.toUpperCase()}_STATE_INVALID`, 302);

  // Redirect (not throw) here: unlike /connect-url this is a browser navigation,
  // so a thrown MaintenanceAdminError would render a raw JSON 403 in the user's
  // tab — exactly the failure mode the quarantine work eliminated.
  if (await isMaintenanceAdminId(memberId)) {
    return c.redirect('/profile?connectError=ADMIN_NOT_A_MEMBER', 302);
  }

  try {
    const { accountLabel, refreshToken, scopes } = await provider.completeConnect(code);
    await provider.store.upsertConnection({ memberId, accountLabel, refreshToken, scopes });
  } catch {
    // Upstream identity failure or unexpected error. Details are not surfaced
    // (they may reference tokens); the member simply retries the connect.
    return c.redirect(`/profile?connectError=${id.toUpperCase()}_EXCHANGE_FAILED`, 302);
  }
  return c.redirect(`/profile?connected=${id}`, 302);
});

integrationsRouter.delete('/:provider/connection', requireAuth, async (c) => {
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return err(c, 'NOT_FOUND', 'Unknown or disabled provider', 404);
  const deleted = await provider.store.deleteConnection(c.get('auth').userId);
  if (!deleted) return err(c, 'NOT_FOUND', 'No connection to disconnect', 404);
  return ok(c, { disconnected: true });
});
