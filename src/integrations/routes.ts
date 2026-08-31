import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../wiring.js';
import { assertNotMaintenanceAdmin, isMaintenanceAdminId } from '../household/maintenance-admin.js';
import { getHouseholdFeed } from '../modules/tasks/store.js';
import { getHouseholdCalendar } from '../modules/calendar/allowlist-store.js';
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
 *    member's link is dead. Children stay scoped to their own `myConnections`.
 *  - an admin session may itself be a promoted household member, so it must still
 *    see and be able to disconnect its OWN connection, via `myConnections`.
 *
 * `/status`'s `myConnections` is the acting member's own connections, one per
 * provider they have linked and each tagged with its `provider` id. With two
 * providers, the old single `connection` field ("first non-null across
 * providers") would have rendered a Google connection as the M365 card's the
 * moment a member had only Google linked — so it is a tagged list instead, in
 * both role branches. `householdCalendar` reports the health of the ONE
 * connection the designated family calendar rides on: it is a delegated feed
 * on one member's connection (no Workspace service account, so it also works
 * for a consumer Gmail account), and the accepted cost is that the family feed
 * stops when that member disconnects. That cost is only acceptable if it is
 * visible, hence reporting it here rather than letting it surface as a
 * silently empty wall.
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

  // The designated family calendar is a DELEGATED feed on one member's
  // connection (no Workspace service account, so it works for consumer Gmail).
  // The accepted cost is that it stops when that member disconnects, so the
  // health of that one connection is reported here rather than left to be
  // discovered as a silently empty wall.
  const householdCalendarFeed = await getHouseholdCalendar();
  let householdCalendar: {
    provider: string; memberId: string; calendarName: string | null; connectionOk: boolean;
  } | null = null;
  if (householdCalendarFeed) {
    const owner = getProvider(householdCalendarFeed.provider);
    const conn = owner ? await owner.store.getConnection(householdCalendarFeed.memberId) : null;
    householdCalendar = {
      provider: householdCalendarFeed.provider,
      memberId: householdCalendarFeed.memberId,
      calendarName: householdCalendarFeed.calendarName,
      connectionOk: conn !== null && conn.status === 'active',
    };
  }

  // The acting member's OWN connections, one per provider they have linked.
  // Provider-tagged, and a list rather than a single row: the old "first
  // non-null across providers" would have rendered a Google connection on the
  // Microsoft card as soon as a second provider existed.
  const myConnections = (await Promise.all(providers.map(async (p) => {
    const row = await p.store.getConnection(auth.userId);
    return row ? { ...row, provider: p.id } : null;
  }))).filter((r) => r !== null);

  if (auth.role === 'admin' || auth.role === 'adult') {
    const connections = (await Promise.all(providers.map(async (p) =>
      (await p.store.listConnections()).map((row) => ({ ...row, provider: p.id })))))
      .flat();
    return ok(c, {
      myConnections, connections, feeds, householdListDesignated, householdCalendar,
      providers: providers.map((p) => p.id),
    });
  }

  // Children stay scoped to their own connections.
  return ok(c, {
    myConnections, feeds, householdListDesignated, householdCalendar,
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
  } catch (e) {
    // Upstream identity failures are NOT surfaced (they may reference tokens).
    // The one exception is an error that names its own safe code — currently
    // only GOOGLE_NO_REFRESH_TOKEN, where the generic message would send the
    // member round the consent loop again with no idea what to change.
    const named = (e as { connectErrorCode?: unknown }).connectErrorCode;
    const code = typeof named === 'string' && /^[A-Z0-9_]{1,64}$/.test(named)
      ? named
      : `${id.toUpperCase()}_EXCHANGE_FAILED`;
    return c.redirect(`/profile?connectError=${code}`, 302);
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
