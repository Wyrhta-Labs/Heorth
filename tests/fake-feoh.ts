import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { SatelliteClient } from '../src/satellites/satellite-client.js';
import { FeohClient } from '../src/satellites/feoh/client.js';
import { FeohRoster, type RosterMember } from '../src/satellites/feoh/roster.js';
import type { FeohRuntime } from '../src/satellites/feoh/runtime.js';

/**
 * An in-process fake of the Feoh satellite: a small Hono app implementing the
 * endpoints Heorth's finance proxy touches, with just enough double-entry logic
 * (record → store → summarise) for cross-module smoke assertions. It records
 * every received request in `calls` so tests can assert path/header/body
 * forwarding, `createdBy` injection, and memberId↔partyId translation.
 */

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | null;
  body: unknown;
}

interface FakeParty {
  id: string;
  kind: 'member' | 'external';
  heorthMemberId: string | null;
  displayName: string;
  kithledgerPersonId: string | null;
}

interface StoredTxn {
  transaction: { id: string; createdAt: string; updatedAt: string; date: string; payee: string; memo: string | null; amount: string; createdBy: string };
  postings: Array<{ id: string; transactionId: string; accountId: string | null; envelopeId: string | null; debit: string; credit: string }>;
  splits: Array<{ id: string; transactionId: string; partyId: string; share: string }>;
}

export interface FakeFeoh {
  app: Hono;
  calls: FakeCall[];
  partiesByMember: Map<string, FakeParty>;
  envelopes: Map<string, { id: string; name: string; monthlyBudget: string; tone: string | null }>;
  accounts: Map<string, { id: string; name: string; kind: string; openingBalance: string }>;
  transactions: StoredTxn[];
}

function okJson<T>(data: T, meta: Record<string, unknown> = {}) {
  return { data, meta };
}

export function createFakeFeoh(): FakeFeoh {
  const app = new Hono();
  const calls: FakeCall[] = [];
  const partiesByMember = new Map<string, FakeParty>();
  const envelopes = new Map<string, { id: string; name: string; monthlyBudget: string; tone: string | null }>();
  const accounts = new Map<string, { id: string; name: string; kind: string; openingBalance: string }>();
  const transactions: StoredTxn[] = [];

  // Record every request (body captured as text, parsed opportunistically).
  app.use('*', async (c, next) => {
    let body: unknown = undefined;
    if (c.req.method !== 'GET' && c.req.method !== 'DELETE') {
      const raw = await c.req.raw.clone().text();
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
    }
    calls.push({
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      query: c.req.query(),
      authorization: c.req.header('Authorization') ?? null,
      body,
    });
    await next();
  });

  // --- parties (roster) ------------------------------------------------------
  app.put('/api/v1/parties/by-heorth-member/:heorthMemberId', async (c) => {
    const heorthMemberId = c.req.param('heorthMemberId');
    const input = (await c.req.json()) as { displayName: string; kithledgerPersonId?: string | null };
    const existing = partiesByMember.get(heorthMemberId);
    const party: FakeParty = existing
      ? { ...existing, displayName: input.displayName, kithledgerPersonId: input.kithledgerPersonId ?? existing.kithledgerPersonId }
      : { id: randomUUID(), kind: 'member', heorthMemberId, displayName: input.displayName, kithledgerPersonId: input.kithledgerPersonId ?? null };
    partiesByMember.set(heorthMemberId, party);
    return c.json(okJson(party));
  });

  app.get('/api/v1/parties', (c) => c.json(okJson([...partiesByMember.values()])));

  // --- accounts --------------------------------------------------------------
  app.get('/api/v1/feoh/accounts', (c) => c.json(okJson([...accounts.values()])));
  app.post('/api/v1/feoh/accounts', async (c) => {
    const i = (await c.req.json()) as { name: string; kind: string; openingBalance?: number };
    const row = { id: randomUUID(), name: i.name, kind: i.kind, openingBalance: String(i.openingBalance ?? 0) };
    accounts.set(row.id, row);
    return c.json(okJson(row), 201);
  });

  // --- envelopes -------------------------------------------------------------
  app.get('/api/v1/feoh/envelopes', (c) => c.json(okJson([...envelopes.values()])));
  app.post('/api/v1/feoh/envelopes', async (c) => {
    const i = (await c.req.json()) as { name: string; monthlyBudget?: number; tone?: string | null };
    const row = { id: randomUUID(), name: i.name, monthlyBudget: String(i.monthlyBudget ?? 0), tone: i.tone ?? null };
    envelopes.set(row.id, row);
    return c.json(okJson(row), 201);
  });

  // --- transactions ----------------------------------------------------------
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.post('/api/v1/feoh/transactions', async (c) => {
    const i = (await c.req.json()) as {
      date: string; payee: string; memo?: string | null; amount: number; createdBy?: string;
      postings: Array<{ accountId?: string | null; envelopeId?: string | null; debit?: number; credit?: number }>;
      splits?: Array<{ partyId: string; share: number }>;
    };
    // Mirror Feoh's zod: createdBy is a required party uuid.
    if (!i.createdBy || !uuidRe.test(i.createdBy)) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 400);
    }
    const debit = i.postings.reduce((s, p) => s + (p.debit ?? 0), 0);
    const credit = i.postings.reduce((s, p) => s + (p.credit ?? 0), 0);
    if (Math.abs(debit - credit) >= 0.005) {
      return c.json({ error: { code: 'UNBALANCED', message: 'Postings do not balance' } }, 400);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const stored: StoredTxn = {
      transaction: { id, createdAt: now, updatedAt: now, date: i.date, payee: i.payee, memo: i.memo ?? null, amount: String(i.amount), createdBy: i.createdBy },
      postings: i.postings.map((p) => ({ id: randomUUID(), transactionId: id, accountId: p.accountId ?? null, envelopeId: p.envelopeId ?? null, debit: String(p.debit ?? 0), credit: String(p.credit ?? 0) })),
      splits: (i.splits ?? []).map((s) => ({ id: randomUUID(), transactionId: id, partyId: s.partyId, share: String(s.share) })),
    };
    transactions.push(stored);
    return c.json(okJson(stored), 201);
  });

  app.get('/api/v1/feoh/transactions', (c) => {
    const rows = transactions.map((t) => t.transaction);
    return c.json(okJson(rows, { total: rows.length, limit: 20, offset: 0 }));
  });

  app.get('/api/v1/feoh/transactions/:id', (c) => {
    const found = transactions.find((t) => t.transaction.id === c.req.param('id'));
    if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } }, 404);
    return c.json(okJson(found));
  });

  app.delete('/api/v1/feoh/transactions/:id', (c) => {
    const idx = transactions.findIndex((t) => t.transaction.id === c.req.param('id'));
    if (idx < 0) return c.json({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } }, 404);
    const [removed] = transactions.splice(idx, 1);
    return c.json(okJson({ id: removed!.transaction.id }));
  });

  // --- summary ---------------------------------------------------------------
  app.get('/api/v1/feoh/summary', (c) => {
    const month = c.req.query('month') ?? '';
    const spentByEnvelope = new Map<string, number>();
    for (const t of transactions) {
      if (!t.transaction.date.startsWith(month)) continue;
      for (const p of t.postings) {
        if (p.envelopeId) spentByEnvelope.set(p.envelopeId, (spentByEnvelope.get(p.envelopeId) ?? 0) + Number(p.debit));
      }
    }
    const envelopesOut = [...envelopes.values()].map((e) => {
      const budget = Number(e.monthlyBudget);
      const spent = spentByEnvelope.get(e.id) ?? 0;
      return { envelopeId: e.id, name: e.name, tone: e.tone, budget, spent, remaining: budget - spent };
    });
    const totals = envelopesOut.reduce(
      (a, e) => ({ budget: a.budget + e.budget, spent: a.spent + e.spent, remaining: a.remaining + e.remaining }),
      { budget: 0, spent: 0, remaining: 0 },
    );
    return c.json(okJson({ month, envelopes: envelopesOut, totals }));
  });

  // --- bills -----------------------------------------------------------------
  app.get('/api/v1/feoh/bills', (c) => c.json(okJson([])));

  // --- export / import -------------------------------------------------------
  app.get('/api/v1/feoh/export', (c) => {
    const format = c.req.query('format') ?? 'csv';
    if (format === 'ledger') return c.text('2026-07-05 * Market', 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return c.text('date,payee,memo,amount,envelope,account', 200, { 'Content-Type': 'text/csv; charset=utf-8' });
  });

  app.post('/api/v1/feoh/import', async (c) => {
    const createdBy = c.req.query('createdBy');
    if (!createdBy || !uuidRe.test(createdBy)) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'createdBy (party uuid) query parameter is required' } }, 400);
    }
    const text = await c.req.text();
    if (!text.trim()) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'CSV body is empty' } }, 400);
    const lines = text.trim().split('\n').slice(1).filter((l) => l.trim());
    return c.json(okJson({ imported: lines.length }), 201);
  });

  return { app, calls, partiesByMember, envelopes, accounts, transactions };
}

/** Build a FeohRuntime whose client talks to the in-process fake over its fetch. */
export function runtimeForFake(fake: FakeFeoh, listMembers: () => Promise<RosterMember[]>): FeohRuntime {
  const http = new SatelliteClient({
    baseUrl: 'http://feoh.test',
    apiKey: 'fe_test-service-key',
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => fake.app.request(input as string, init)) as typeof fetch,
  });
  const client = new FeohClient(http);
  const roster = new FeohRoster(client, listMembers);
  return { client, roster };
}
