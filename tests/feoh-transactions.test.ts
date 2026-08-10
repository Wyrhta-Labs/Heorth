// TODO(Task 5): unskip when the feoh module mounts. Ported from Feoh's
// tests/feoh-transactions.test.ts, adapted to Heorth's member semantics:
// no `parties` boundary — `createdBy` is the acting household member's id
// (auth-derived by the route, not part of the request body) and expense
// splits carry `memberId` instead of `partyId`. The Feoh copy's "parties
// boundary: referential integrity" describe block and its "rejects a
// createdBy that does not reference an existing party" case are dropped:
// there is no parties table to test against, and the member-FK-restrict
// invariant it exercised is already covered by feoh-schema.test.ts's
// "restricts deleting a member referenced by a transaction" test (Task 3).
// FEOH_ENABLED is set before the dynamic import of src/app.js so
// config.feohEnabled is true when the module registers — mirrors the M365
// suite's env-gated-config precedent (see integration-smoke.test.ts).
import { describe, it, expect, afterAll, vi } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import { db } from '../src/db/index.js';
import { postings } from '../src/modules/feoh/schema.js';

process.env['FEOH_ENABLED'] = 'true';
// helpers.js's own static import chain already loaded src/config/env.js (with
// FEOH_ENABLED unset) before the assignment above ran — vi.resetModules()
// forces the dynamic imports below to re-evaluate it against the current env.
vi.resetModules();
const { createApp } = await import('../src/app.js');
const { ALL_MODULES } = await import('../src/modules/index.js');

const app = createApp(ALL_MODULES);

// singleFork shares process.env across test files — restore the ambient
// default (unset/disabled) so later files aren't affected by this one.
afterAll(() => { delete process.env['FEOH_ENABLED']; });

async function setup() {
  const { adult, child } = await seedTestHousehold();
  const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
  const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
  return { adult, child, account, envelope };
}

describe('feoh double-entry transactions', () => {
  it('records a balanced transaction atomically', async () => {
    const { adult, account, envelope } = await setup();
    const res = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Market', amount: 50,
        postings: [
          { envelopeId: envelope.id, debit: 50, credit: 0 },
          { accountId: account.id, debit: 0, credit: 50 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: { postings: unknown[] } };
    expect(data.postings.length).toBe(2);
  });

  it('rejects an unbalanced transaction with 400 UNBALANCED and writes nothing', async () => {
    const { adult, account, envelope } = await setup();
    const res = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Market', amount: 50,
        postings: [
          { envelopeId: envelope.id, debit: 50, credit: 0 },
          { accountId: account.id, debit: 0, credit: 40 },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNBALANCED');
    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0); // atomic rollback: nothing persisted
  });

  it('rolls back the transaction and postings when a later insert fails inside db.transaction', async () => {
    const { adult, account, envelope } = await setup();
    await expect(service.recordTransaction({
      date: '2026-07-07', payee: 'Rollback Test', amount: 30, memo: null,
      postings: [
        { envelopeId: envelope.id, debit: 30, credit: 0 },
        { accountId: account.id, debit: 0, credit: 30 },
      ],
      // Balanced postings pass the pre-check and enter db.transaction; this split's
      // memberId is a syntactically-valid but non-existent UUID, so the FK to users.id
      // fails AFTER the transactions/postings inserts, forcing a rollback.
      splits: [{ memberId: '00000000-0000-0000-0000-000000000000', share: 30 }],
    }, adult.user.id)).rejects.toThrow();

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0); // atomic rollback: transaction row not persisted

    const remainingPostings = await db.select().from(postings);
    expect(remainingPostings.length).toBe(0); // atomic rollback: postings not persisted
  });

  it('records expense splits with the transaction', async () => {
    const { adult, child, account, envelope } = await setup();
    const result = await service.recordTransaction({
      date: '2026-07-06', payee: 'Zoo', amount: 30, memo: null,
      postings: [
        { envelopeId: envelope.id, debit: 30, credit: 0 },
        { accountId: account.id, debit: 0, credit: 30 },
      ],
      splits: [{ memberId: adult.user.id, share: 20 }, { memberId: child.user.id, share: 10 }],
    }, adult.user.id);
    expect(result.splits.length).toBe(2);
  });

  it('rejects a transaction request without auth', async () => {
    const { account, envelope } = await setup();
    const res = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Market', amount: 10,
        postings: [{ envelopeId: envelope.id, debit: 10, credit: 0 }, { accountId: account.id, debit: 0, credit: 10 }],
      }),
    });
    expect(res.status).toBe(401);
  });
});
