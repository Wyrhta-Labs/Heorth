import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { feohModule } from '../src/modules/feoh/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import { db } from '../src/db/index.js';
import { postings } from '../src/modules/feoh/schema.js';

const app = createApp([householdModule, feohModule]);

async function setup() {
  const seeded = await seedTestHousehold();
  const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
  const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
  return { ...seeded, account, envelope };
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

  it('forbids a child from recording a transaction', async () => {
    const { child, account, envelope } = await setup();
    const res = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(child.jwt),
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Market', amount: 10,
        postings: [{ envelopeId: envelope.id, debit: 10, credit: 0 }, { accountId: account.id, debit: 0, credit: 10 }],
      }),
    });
    expect(res.status).toBe(403);
  });
});
