// REST surface for the Task 8 occurrence state machine (src/modules/feoh/occurrences.ts).
// Dates are computed relative to the real `new Date()` at run time (the REST
// listing has no `today` override) so status expectations (overdue/planned)
// hold regardless of which day this suite runs on.
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC month offset from "now", pinned to the 1st so it lands cleanly on the
 *  bill's monthly cadence (nextDue day-of-month). */
function monthsFromNow(offset: number): string {
  const now = new Date();
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
}

interface JsonBody { data?: unknown; error?: { code: string; message: string } }
async function json(res: Response): Promise<JsonBody> {
  return (await res.json()) as JsonBody;
}

describe('feoh occurrence routes', () => {
  it('exercises the full occurrence lifecycle over HTTP', async () => {
    const { adult, child } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });

    // nextDue two months in the past -> guaranteed 'overdue' occurrence at that date.
    const pastDue = monthsFromNow(-2);
    const bill = await service.createBill({
      payee: 'Power Co', amount: 85, cadence: 'monthly', nextDue: pastDue, envelopeId: envelope.id,
    });
    const { transaction: txn } = await service.recordTransaction({
      date: pastDue, payee: 'Power Co', memo: null, amount: 85,
      postings: [
        { envelopeId: envelope.id, accountId: null, debit: 85, credit: 0 },
        { accountId: account.id, envelopeId: null, debit: 0, credit: 85 },
      ],
      splits: [],
    }, adult.user.id);

    // GET lists entries, is allowed for any auth role (child included).
    const listRes = await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(child.jwt) });
    expect(listRes.status).toBe(200);
    const listBody = await json(listRes) as { data: Array<{ dueDate: string; status: string }> };
    const overdueEntry = listBody.data.find((e) => e.dueDate === pastDue);
    expect(overdueEntry?.status).toBe('overdue');

    // link -> GET shows paid.
    const linkRes = await app.request('/api/v1/feoh/occurrences/link', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: pastDue, transactionId: txn.id }),
    });
    expect(linkRes.status).toBe(200);
    const afterLink = await json(await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(adult.jwt) })) as {
      data: Array<{ dueDate: string; status: string; transactionId: string | null }>;
    };
    const paidEntry = afterLink.data.find((e) => e.dueDate === pastDue);
    expect(paidEntry?.status).toBe('paid');
    expect(paidEntry?.transactionId).toBe(txn.id);

    // link again -> 409 ALREADY_PAID.
    const relinkRes = await app.request('/api/v1/feoh/occurrences/link', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: pastDue, transactionId: txn.id }),
    });
    expect(relinkRes.status).toBe(409);
    const relinkBody = await json(relinkRes);
    expect(relinkBody.error?.code).toBe('ALREADY_PAID');

    // link an off-cadence date -> 400 NOT_AN_OCCURRENCE.
    const offCadenceDate = pastDue.slice(0, 8) + '15'; // day 15, cadence is anchored to day 1
    const offCadenceRes = await app.request('/api/v1/feoh/occurrences/link', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: offCadenceDate, transactionId: txn.id }),
    });
    expect(offCadenceRes.status).toBe(400);
    const offCadenceBody = await json(offCadenceRes);
    expect(offCadenceBody.error?.code).toBe('NOT_AN_OCCURRENCE');

    // skip/unskip round-trip on a future occurrence.
    const futureDue = monthsFromNow(2);
    const skipRes = await app.request('/api/v1/feoh/occurrences/skip', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: futureDue }),
    });
    expect(skipRes.status).toBe(200);
    const afterSkip = await json(await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(adult.jwt) })) as {
      data: Array<{ dueDate: string; status: string }>;
    };
    expect(afterSkip.data.find((e) => e.dueDate === futureDue)?.status).toBe('skipped');

    const unskipRes = await app.request('/api/v1/feoh/occurrences/unskip', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: futureDue }),
    });
    expect(unskipRes.status).toBe(200);
    const afterUnskip = await json(await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(adult.jwt) })) as {
      data: Array<{ dueDate: string; status: string }>;
    };
    expect(afterUnskip.data.find((e) => e.dueDate === futureDue)?.status).toBe('planned');

    // override PATCH, then null clears it.
    const overrideDue = monthsFromNow(3);
    const overrideRes = await app.request('/api/v1/feoh/occurrences/override', {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: overrideDue, amount: 120 }),
    });
    expect(overrideRes.status).toBe(200);
    const afterOverride = await json(await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(adult.jwt) })) as {
      data: Array<{ dueDate: string; overrideAmount: number | null; expectedAmount: number }>;
    };
    const overriddenEntry = afterOverride.data.find((e) => e.dueDate === overrideDue);
    expect(overriddenEntry?.overrideAmount).toBe(120);
    expect(overriddenEntry?.expectedAmount).toBe(120);

    const clearOverrideRes = await app.request('/api/v1/feoh/occurrences/override', {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: overrideDue, amount: null }),
    });
    expect(clearOverrideRes.status).toBe(200);
    const afterClear = await json(await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(adult.jwt) })) as {
      data: Array<{ dueDate: string; overrideAmount: number | null }>;
    };
    expect(afterClear.data.find((e) => e.dueDate === overrideDue)?.overrideAmount).toBeNull();

    // unlink round-trip (also covered here since routes.ts wires it identically).
    const unlinkRes = await app.request('/api/v1/feoh/occurrences/unlink', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ billId: bill.id, dueDate: pastDue }),
    });
    expect(unlinkRes.status).toBe(200);
    const afterUnlink = await json(await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(adult.jwt) })) as {
      data: Array<{ dueDate: string; status: string; transactionId: string | null }>;
    };
    const unlinkedEntry = afterUnlink.data.find((e) => e.dueDate === pastDue);
    expect(unlinkedEntry?.status).toBe('overdue');
    expect(unlinkedEntry?.transactionId).toBeNull();
  });

  it('rejects mutation routes for a child role with 403', async () => {
    const { adult, child } = await seedTestHousehold();
    const bill = await service.createBill({
      payee: 'Water Co', amount: 40, cadence: 'monthly', nextDue: monthsFromNow(-1),
    });

    for (const [path, method, body] of [
      ['/api/v1/feoh/occurrences/link', 'POST', { billId: bill.id, dueDate: monthsFromNow(-1), transactionId: adult.user.id }],
      ['/api/v1/feoh/occurrences/skip', 'POST', { billId: bill.id, dueDate: monthsFromNow(-1) }],
      ['/api/v1/feoh/occurrences/unlink', 'POST', { billId: bill.id, dueDate: monthsFromNow(-1) }],
      ['/api/v1/feoh/occurrences/unskip', 'POST', { billId: bill.id, dueDate: monthsFromNow(-1) }],
      ['/api/v1/feoh/occurrences/override', 'PATCH', { billId: bill.id, dueDate: monthsFromNow(-1), amount: 10 }],
    ] as const) {
      const res = await app.request(path, { method, headers: authHeaders(child.jwt), body: JSON.stringify(body) });
      expect(res.status).toBe(403);
    }

    // GET remains allowed for the child role.
    const getRes = await app.request(`/api/v1/feoh/occurrences?billId=${bill.id}`, { headers: authHeaders(child.jwt) });
    expect(getRes.status).toBe(200);
  });
});
