import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { householdCore } from '../src/wiring.js';
import { setFeohRuntime, type FeohRuntime } from '../src/satellites/feoh/runtime.js';
import { SatelliteClient } from '../src/satellites/satellite-client.js';
import { FeohClient } from '../src/satellites/feoh/client.js';
import { FeohRoster, RosterMappingMissingError } from '../src/satellites/feoh/roster.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createFakeFeoh, runtimeForFake, type FakeFeoh } from './fake-feoh.js';

const app = createApp(ALL_MODULES);
const listMembers = () => householdCore.listMembers();

describe('feoh finance proxy → Feoh satellite', () => {
  let fake: FakeFeoh;

  beforeEach(() => {
    fake = createFakeFeoh();
    setFeohRuntime(runtimeForFake(fake, listMembers));
  });
  afterEach(() => setFeohRuntime(null));

  it('forwards a GET with the service API key and the same path', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/feoh/envelopes', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const call = fake.calls.find((k) => k.method === 'GET' && k.path === '/api/v1/feoh/envelopes');
    expect(call).toBeDefined();
    expect(call!.authorization).toBe('Bearer fe_test-service-key');
  });

  it('forwards create bodies and passes the 201 + envelope through', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string; name: string } };
    expect(data.name).toBe('Groceries');
  });

  it('injects createdBy (acting party) and translates split memberId → partyId, reversing them in the response', async () => {
    const { adult, child } = await seedTestHousehold();
    const envRes = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    const { data: envelope } = (await envRes.json()) as { data: { id: string } };
    const acctRes = await app.request('/api/v1/feoh/accounts', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 0 }),
    });
    const { data: account } = (await acctRes.json()) as { data: { id: string } };

    const res = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Market', amount: 50,
        postings: [{ envelopeId: envelope.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
        splits: [{ memberId: child.user.id, share: 50 }],
      }),
    });
    expect(res.status).toBe(201);

    const adultParty = fake.partiesByMember.get(adult.user.id)!;
    const childParty = fake.partiesByMember.get(child.user.id)!;

    // Inbound: what Feoh actually received uses party ids.
    const post = fake.calls.find((k) => k.method === 'POST' && k.path === '/api/v1/feoh/transactions')!;
    const sent = post.body as { createdBy: string; splits: Array<{ partyId: string; share: number }> };
    expect(sent.createdBy).toBe(adultParty.id);
    expect(sent.splits[0]!.partyId).toBe(childParty.id);
    expect((sent.splits[0] as Record<string, unknown>)['memberId']).toBeUndefined();

    // Outbound: the UI sees member ids again (byte-identical to the old module).
    const { data } = (await res.json()) as { data: { transaction: { createdBy: string }; splits: Array<{ memberId: string; partyId?: string }> } };
    expect(data.transaction.createdBy).toBe(adult.user.id);
    expect(data.splits[0]!.memberId).toBe(child.user.id);
    expect(data.splits[0]!.partyId).toBeUndefined();
  });

  it('reverses createdBy on the transaction list', async () => {
    const { adult } = await seedTestHousehold();
    const envRes = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'E', monthlyBudget: 10 }),
    });
    const { data: envelope } = (await envRes.json()) as { data: { id: string } };
    const acctRes = await app.request('/api/v1/feoh/accounts', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'A', kind: 'asset' }),
    });
    const { data: account } = (await acctRes.json()) as { data: { id: string } };
    await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-07-05', payee: 'X', amount: 5, postings: [{ envelopeId: envelope.id, debit: 5, credit: 0 }, { accountId: account.id, debit: 0, credit: 5 }] }),
    });

    const res = await app.request('/api/v1/feoh/transactions', { headers: authHeaders(adult.jwt) });
    const { data } = (await res.json()) as { data: Array<{ createdBy: string }> };
    expect(data[0]!.createdBy).toBe(adult.user.id);
  });

  it('passes a Feoh 4xx (UNBALANCED) straight through with its code', async () => {
    const { adult } = await seedTestHousehold();
    const envRes = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'E', monthlyBudget: 10 }),
    });
    const { data: envelope } = (await envRes.json()) as { data: { id: string } };
    const acctRes = await app.request('/api/v1/feoh/accounts', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'A', kind: 'asset' }),
    });
    const { data: account } = (await acctRes.json()) as { data: { id: string } };

    const res = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-07-05', payee: 'X', amount: 5, postings: [{ envelopeId: envelope.id, debit: 5, credit: 0 }, { accountId: account.id, debit: 0, credit: 4 }] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNBALANCED');
  });

  it('passes CSV export text through with its content-type', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/feoh/export?format=csv', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await res.text()).toContain('date,payee');
  });

  it('injects createdBy as a query param on CSV import', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/feoh/import', {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'text/csv' },
      body: 'date,payee,amount,envelope\n2026-07-05,Market,50,Groceries',
    });
    expect(res.status).toBe(201);
    const adultParty = fake.partiesByMember.get(adult.user.id)!;
    const call = fake.calls.find((k) => k.method === 'POST' && k.path === '/api/v1/feoh/import')!;
    expect(call.query['createdBy']).toBe(adultParty.id);
  });

  it('blocks a child from finance writes on the Heorth side (never reaches Feoh)', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'Toys', monthlyBudget: 5 }),
    });
    expect(res.status).toBe(403);
    expect(fake.calls.some((k) => k.method === 'POST' && k.path === '/api/v1/feoh/envelopes')).toBe(false);
  });

  it('maps a roster mapping miss (still unmapped after a successful re-sync) to a classified 500', async () => {
    const { adult } = await seedTestHousehold();
    // listMembers returns no members at all, so even a full re-sync leaves
    // the acting member unmapped — Feoh itself is reachable throughout, so
    // this must NOT be classified as a 503.
    setFeohRuntime(runtimeForFake(fake, () => Promise.resolve([])));

    const res = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Market', amount: 50,
        postings: [{ accountId: 'ignored', debit: 50, credit: 0 }, { accountId: 'ignored2', debit: 0, credit: 50 }],
      }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ROSTER_MAPPING_MISSING');
  });

  describe('maintenance admin quarantine', () => {
    it('refuses a finance write by the admin', async () => {
      const { admin } = await seedTestHousehold();
      const res = await app.request('/api/v1/feoh/envelopes', {
        method: 'POST', headers: authHeaders(admin.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('ADMIN_NOT_A_MEMBER');
    });

    it('refuses the admin as a split participant', async () => {
      const { admin, adult } = await seedTestHousehold();
      const envRes = await app.request('/api/v1/feoh/envelopes', {
        method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
      });
      const { data: envelope } = (await envRes.json()) as { data: { id: string } };
      const acctRes = await app.request('/api/v1/feoh/accounts', {
        method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 0 }),
      });
      const { data: account } = (await acctRes.json()) as { data: { id: string } };

      const res = await app.request('/api/v1/feoh/transactions', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({
          date: '2026-07-05', payee: 'Shared', amount: 10,
          postings: [{ envelopeId: envelope.id, debit: 10, credit: 0 }, { accountId: account.id, debit: 0, credit: 10 }],
          splits: [{ memberId: admin.user.id, share: 1 }],
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('ADMIN_NOT_A_MEMBER');
    });

    it('still allows an adult to write', async () => {
      const { adult } = await seedTestHousehold();
      const envRes = await app.request('/api/v1/feoh/envelopes', {
        method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
      });
      const { data: envelope } = (await envRes.json()) as { data: { id: string } };
      const acctRes = await app.request('/api/v1/feoh/accounts', {
        method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 0 }),
      });
      const { data: account } = (await acctRes.json()) as { data: { id: string } };

      const res = await app.request('/api/v1/feoh/transactions', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({
          date: '2026-07-05', payee: 'Groceries', amount: 10,
          postings: [{ envelopeId: envelope.id, debit: 10, credit: 0 }, { accountId: account.id, debit: 0, credit: 10 }],
        }),
      });
      expect(res.status).toBeLessThan(400);
    });
  });

  it('maps an unreachable Feoh to a 503 in Heorth’s envelope', async () => {
    const { adult } = await seedTestHousehold();
    const down: FeohRuntime = (() => {
      const http = new SatelliteClient({
        baseUrl: 'http://feoh.test', apiKey: 'fe_test-service-key',
        fetch: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
      });
      const client = new FeohClient(http);
      return { client, roster: new FeohRoster(client, listMembers) };
    })();
    setFeohRuntime(down);

    const res = await app.request('/api/v1/feoh/envelopes', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('feoh roster re-upsert on displayName change (finding G)', () => {
  afterEach(() => setFeohRuntime(null));

  it('best-effort re-upserts the Feoh party right after a member PATCHes their displayName', async () => {
    const { adult } = await seedTestHousehold();
    const fake = createFakeFeoh();
    const runtime = runtimeForFake(fake, listMembers);
    setFeohRuntime(runtime);
    await runtime.roster.sync(); // establish the initial mapping, like startup does

    const res = await app.request(`/api/v1/members/${adult.user.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ displayName: 'Renamed Adult' }),
    });
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(fake.partiesByMember.get(adult.user.id)!.displayName).toBe('Renamed Adult');
    });
  });
});

describe('feoh roster sync', () => {
  afterEach(() => setFeohRuntime(null));

  it('upserts every member idempotently and caches both mapping directions, skipping the maintenance admin', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    const fake = createFakeFeoh();
    const runtime = runtimeForFake(fake, listMembers);

    await runtime.roster.sync();
    const firstAdultParty = fake.partiesByMember.get(adult.user.id)!.id;
    // The maintenance admin is not a finance actor — the sync mirrors only the
    // adult and the child, never the admin (see roster.ts's isMaintenanceAdmin guard).
    expect(fake.partiesByMember.size).toBe(2);
    expect(fake.partiesByMember.has(admin.user.id)).toBe(false);

    // Second sync must not create duplicates and must keep ids stable.
    await runtime.roster.sync();
    expect(fake.partiesByMember.size).toBe(2);
    expect(fake.partiesByMember.get(adult.user.id)!.id).toBe(firstAdultParty);

    // Forward + reverse mapping resolve for each non-admin member.
    for (const m of [adult, child]) {
      const partyId = await runtime.roster.partyIdFor(m.user.id);
      expect(runtime.roster.memberIdFor(partyId)).toBe(m.user.id);
    }

    // The admin can never resolve a Feoh party — no party was ever created for it.
    await expect(runtime.roster.partyIdFor(admin.user.id)).rejects.toThrow(RosterMappingMissingError);
  });

  it('lazily syncs on a mapping miss (no explicit startup sync)', async () => {
    const { adult } = await seedTestHousehold();
    const fake = createFakeFeoh();
    const runtime = runtimeForFake(fake, listMembers);
    // No sync() called first — partyIdFor must self-heal.
    const partyId = await runtime.roster.partyIdFor(adult.user.id);
    expect(fake.partiesByMember.get(adult.user.id)!.id).toBe(partyId);
  });

  it('shares one in-flight sync across concurrent mapping misses (finding F)', async () => {
    const { adult, child } = await seedTestHousehold();
    const fake = createFakeFeoh();
    let listMembersCalls = 0;
    const runtime = runtimeForFake(fake, async () => {
      listMembersCalls += 1;
      return listMembers();
    });

    // Both are cache misses at the same tick — should collapse to one sync.
    const [adultPartyId, childPartyId] = await Promise.all([
      runtime.roster.partyIdFor(adult.user.id),
      runtime.roster.partyIdFor(child.user.id),
    ]);

    expect(listMembersCalls).toBe(1);
    expect(adultPartyId).toBe(fake.partiesByMember.get(adult.user.id)!.id);
    expect(childPartyId).toBe(fake.partiesByMember.get(child.user.id)!.id);
  });
});
