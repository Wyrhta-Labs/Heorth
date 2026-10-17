import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as auth from './auth';
import * as calendarAllowlist from './calendar-allowlist';
import * as calendar from './calendar';
import * as ethel from './ethel';
import * as features from './features';
import * as feoh from './feoh';
import * as feohImport from './feoh-import';
import * as gewrit from './gewrit';
import * as google from './google';
import * as household from './household';
import * as kith from './kith';
import * as library from './library';
import * as m365 from './m365';
import * as meals from './meals';
import * as tasks from './tasks';
import * as weorc from './weorc';

// Every other web test mocks the api modules wholesale, so nothing used to
// check the one thing they own: the URL. Between the backend's inventory→ethel
// rename and the web's, every asset request 404'd behind a green suite
// (Heorth#8). Here a real request goes through client.ts to a stubbed fetch,
// and the method and path are asserted — at least one call per module, so a
// whole module pointed at a wrong prefix fails. Each path was checked against
// the server's route table when written; keep them in step with it.

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

/** Method, URL and parsed JSON body of the one request the call made. */
async function sent(call: () => Promise<unknown>) {
  fetchSpy.mockClear();
  await call();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
  return {
    method: init?.method ?? 'GET',
    url,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
  };
}

describe('api module paths', () => {
  it.each([
    ['auth', 'GET', '/api/v1/auth/whoami', () => auth.whoami()],
    ['calendar-allowlist', 'GET', '/api/v1/calendar/calendars', () => calendarAllowlist.listCalendars()],
    ['calendar', 'GET', '/api/v1/events', () => calendar.listEvents()],
    ['ethel assets', 'GET', '/api/v1/ethel/assets?status=active', () => ethel.listAssets({ status: 'active' })],
    ['ethel places', 'GET', '/api/v1/ethel/places', () => ethel.listPlaces()],
    ['features', 'GET', '/api/v1/features', () => features.getFeatures()],
    ['gewrit', 'GET', '/api/v1/gewrit/assets/a1/documents', () => gewrit.listDocuments({ assetId: 'a1' })],
    ['google', 'GET', '/api/v1/integrations/google/connect-url', () => google.getGoogleConnectUrl()],
    ['household', 'GET', '/api/v1/household', () => household.getHousehold()],
    ['kith', 'GET', '/api/v1/kith/reminders?from=2026-10-01&to=2026-10-31', () => kith.listKithReminders({ from: '2026-10-01', to: '2026-10-31' })],
    ['library', 'GET', '/api/v1/library/items', () => library.listItems()],
    ['m365', 'GET', '/api/v1/integrations/status', () => m365.getIntegrationsStatus()],
    ['meals', 'GET', '/api/v1/recipes', () => meals.listRecipes()],
    ['tasks', 'GET', '/api/v1/tasks', () => tasks.listTasks()],
    ['weorc', 'GET', '/api/v1/weorc/routines', () => weorc.listRoutines()],
  ] as const)('%s calls %s %s', async (_name, method, url, call) => {
    expect(await sent(call)).toMatchObject({ method, url });
  });
});

describe('feoh paths and payloads', () => {
  const ref = { billId: 'b1', dueDate: '2026-10-01' };

  it.each([
    ['list bills', 'GET', '/api/v1/feoh/bills', () => feoh.listBills()],
    ['list occurrences', 'GET', '/api/v1/feoh/occurrences?from=2026-10-01', () => feoh.listOccurrences({ from: '2026-10-01' })],
    ['link', 'POST', '/api/v1/feoh/occurrences/link', () => feoh.linkOccurrence({ ...ref, transactionId: 't1' })],
    ['skip', 'POST', '/api/v1/feoh/occurrences/skip', () => feoh.skipOccurrence(ref)],
    ['unlink', 'POST', '/api/v1/feoh/occurrences/unlink', () => feoh.unlinkOccurrence(ref)],
    ['unskip', 'POST', '/api/v1/feoh/occurrences/unskip', () => feoh.unskipOccurrence(ref)],
    ['import status', 'GET', '/api/v1/feoh/ingestion/status', () => feohImport.getImportStatus()],
    ['update import rule', 'PATCH', '/api/v1/feoh/ingestion/rules/k1', () => feohImport.updateRule('k1', { enabled: false })],
    ['override', 'PATCH', '/api/v1/feoh/occurrences/override', () => feoh.overrideOccurrence({ ...ref, amount: 12 })],
    ['item costs', 'GET', '/api/v1/feoh/item-costs/a1', () => feoh.getItemCosts('a1')],
  ] as const)('%s calls %s %s', async (_name, method, url, call) => {
    expect(await sent(call)).toMatchObject({ method, url });
  });

  // The server's Zod schema strips unknown keys, so a bill sent with a renamed
  // field (it was `inventoryItemId`) saves with no asset link and no error.
  it('sends a bill\'s asset link as ethelAssetId', async () => {
    const req = await sent(() => feoh.createBill({
      payee: 'Insurer', amount: 40, cadence: 'monthly', nextDue: '2026-11-01', ethelAssetId: 'a1',
    }));
    expect(req).toMatchObject({ method: 'POST', url: '/api/v1/feoh/bills' });
    expect(req.body).toMatchObject({ ethelAssetId: 'a1' });
  });
});
