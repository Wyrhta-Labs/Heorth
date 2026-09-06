import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createFireflyProvider, parseTransactionsPage, parseAccounts, minusDays, todayUtcPlus,
} from '../src/modules/feoh/import/providers/firefly.js';
import { SourceProviderError } from '../src/modules/feoh/import/providers/types.js';

const transactionsFixture = JSON.parse(readFileSync(new URL('./fixtures/firefly-transactions.json', import.meta.url), 'utf8')) as unknown;
const accountsFixture = JSON.parse(readFileSync(new URL('./fixtures/firefly-accounts.json', import.meta.url), 'utf8')) as unknown;

/** A fetch that serves the fixtures and records every request. */
function fakeFetch(opts: { status?: number; body?: unknown; throwNetwork?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (opts.throwNetwork) throw new TypeError('fetch failed');
    const status = opts.status ?? 200;
    const body = opts.body ?? (url.includes('/api/v1/accounts') ? accountsFixture : transactionsFixture);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('parseTransactionsPage (fixture contract)', () => {
  it('emits one line per withdrawal/deposit journal, skips transfers, keeps split lines distinct', () => {
    const { lines, totalPages } = parseTransactionsPage(transactionsFixture);
    expect(totalPages).toBe(1);
    expect(lines.map((l) => l.sourceId)).toEqual(['101:1001', '102:1002', '102:1003', '102:1004', '103:1005']);
    const rewe = lines[0]!;
    expect(rewe).toMatchObject({ direction: 'out', sourceAccountId: '7', date: '2026-09-01', payee: 'REWE', memo: 'REWE SAGT DANKE 4711', amount: 42.1, currency: 'EUR' });
    const salary = lines[4]!;
    expect(salary).toMatchObject({ direction: 'in', sourceAccountId: '7', payee: 'ACME GmbH', memo: 'SALARY 09/2026', amount: 3850 });
    expect(lines[3]!.currency).toBe('USD');
  });

  it('falls back to the description when the counterparty name is blank, and nulls a memo equal to the payee', () => {
    const { lines } = parseTransactionsPage({
      data: [{ id: '5', attributes: { transactions: [
        { transaction_journal_id: '9', type: 'withdrawal', date: '2026-09-01T00:00:00+02:00', amount: '1.00', currency_code: 'EUR', description: 'Kiosk', source_id: '7', source_name: 'Joint', destination_id: '2', destination_name: '' },
      ] } }],
      meta: { pagination: { total_pages: 1 } },
    });
    expect(lines[0]).toMatchObject({ payee: 'Kiosk', memo: null });
  });

  it('rejects a body that is not a Firefly page, or a journal without ids/currency, with bad_response', () => {
    expect(() => parseTransactionsPage({ hello: 'world' })).toThrow(SourceProviderError);
    try { parseTransactionsPage('<html>'); } catch (e) { expect((e as SourceProviderError).reason).toBe('bad_response'); }
    const journal = { type: 'withdrawal', date: '2026-09-01T00:00:00+02:00', amount: '1.00', currency_code: 'EUR', description: 'x', source_id: '7', destination_id: '2' };
    const page = (id: unknown, j: Record<string, unknown>) => ({ data: [{ id, attributes: { transactions: [j] } }], meta: { pagination: { total_pages: 1 } } });
    expect(() => parseTransactionsPage(page('', { ...journal, transaction_journal_id: '9' }))).toThrow(/ids/);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseTransactionsPage(page('5', { ...journal, transaction_journal_id: 'abc' }))).toThrow(/ids/);
    expect(spy.mock.calls.some((c) => String(c[0]).includes('group 5 journal abc'))).toBe(true);
    spy.mockRestore();
    expect(() => parseTransactionsPage(page('5', { ...journal, transaction_journal_id: '9', currency_code: '' }))).toThrow(/currency/);
    expect(() => parseTransactionsPage(page('5', { ...journal, transaction_journal_id: '9', source_id: '' }))).toThrow(/account id/);
  });
});

describe('parseAccounts', () => {
  it('maps id, name and currency', () => {
    expect(parseAccounts(accountsFixture)).toEqual([
      { sourceAccountId: '7', name: 'Joint current account', currency: 'EUR' },
      { sourceAccountId: '8', name: 'Savings', currency: 'EUR' },
    ]);
  });
});

describe('minusDays', () => {
  it('does calendar arithmetic without timezone drift', () => {
    expect(minusDays('2026-09-01', 7)).toBe('2026-08-25');
    expect(minusDays('2026-03-01', 1)).toBe('2026-02-28');
    expect(minusDays('2026-01-01', 1)).toBe('2025-12-31');
  });
});

describe('todayUtcPlus', () => {
  it('returns a YYYY-MM-DD date consistent with minusDays', () => {
    expect(todayUtcPlus(1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(minusDays(todayUtcPlus(2), 1)).toBe(todayUtcPlus(1));
  });
});

describe('createFireflyProvider', () => {
  it('sends the bearer token, sorts by (date, group, journal), and pages with a composite watermark', async () => {
    const f = fakeFetch();
    const p = createFireflyProvider({ baseUrl: 'https://firefly.invalid/', pat: 'PAT-1', fetchImpl: f.impl, overlapDays: 7 });
    const page1 = await p.listSince(null, 2);
    expect(f.calls[0]!.url).toBe('https://firefly.invalid/api/v1/transactions?limit=200&page=1');
    expect(f.calls[0]!.headers['authorization']).toBe('Bearer PAT-1');
    expect(page1.items.map((i) => i.sourceId)).toEqual(['101:1001', '102:1002']);
    expect(page1.nextCursor).not.toBeNull();
    // the limit cut through four same-date rows; the remainder must not be lost
    const page2 = await p.listSince(page1.nextCursor, 2);
    expect(page2.items.map((i) => i.sourceId)).toEqual(['102:1003', '102:1004']);
    const page3 = await p.listSince(page2.nextCursor, 2);
    expect(page3.items.map((i) => i.sourceId)).toEqual(['103:1005']);
    expect(page3.nextCursor).toBeNull();
    // checkpoint = last seen date minus the overlap, with no `after`
    expect(JSON.parse(page3.checkpoint)).toEqual({ since: '2026-08-27', after: null });
    // one fetch for the whole sweep (three listSince calls), not one per page
    expect(f.calls).toHaveLength(1);
    await p.listSince(null, 2);
    expect(f.calls).toHaveLength(2);
  });

  it('a later sweep starts from the checkpoint date (start= and end= are sent) and re-emits the overlap', async () => {
    const f = fakeFetch();
    const p = createFireflyProvider({ baseUrl: 'https://firefly.invalid', pat: 'x', fetchImpl: f.impl });
    const page = await p.listSince(JSON.stringify({ since: '2026-08-27', after: null }), 100);
    expect(f.calls[0]!.url).toBe(`https://firefly.invalid/api/v1/transactions?limit=200&page=1&start=2026-08-27&end=${todayUtcPlus(1)}`);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it('an empty Firefly keeps the previous since', async () => {
    const f = fakeFetch({ body: { data: [], meta: { pagination: { total_pages: 1 } } } });
    const p = createFireflyProvider({ baseUrl: 'https://firefly.invalid', pat: 'x', fetchImpl: f.impl });
    const page = await p.listSince(JSON.stringify({ since: '2026-08-01', after: null }), 100);
    expect(page.items).toEqual([]);
    expect(JSON.parse(page.checkpoint)).toEqual({ since: '2026-08-01', after: null });
  });

  it('lists asset accounts', async () => {
    const f = fakeFetch();
    const p = createFireflyProvider({ baseUrl: 'https://firefly.invalid', pat: 'x', fetchImpl: f.impl });
    expect(await p.listAccounts()).toHaveLength(2);
    expect(f.calls[0]!.url).toBe('https://firefly.invalid/api/v1/accounts?type=asset&limit=200&page=1');
  });

  it('classifies failures and never leaks the body or the token into the message', async () => {
    for (const [status, reason] of [[401, 'auth_failed'], [403, 'auth_failed'], [429, 'rate_limited'], [500, 'error']] as const) {
      const f = fakeFetch({ status, body: 'SECRET-BODY' });
      const p = createFireflyProvider({ baseUrl: 'https://firefly.invalid', pat: 'TOKEN-XYZ', fetchImpl: f.impl });
      const e = await p.listSince(null, 10).catch((x: unknown) => x) as SourceProviderError;
      expect(e).toBeInstanceOf(SourceProviderError);
      expect(e.reason).toBe(reason);
      expect(e.message).not.toContain('SECRET-BODY');
      expect(e.message).not.toContain('TOKEN-XYZ');
    }
    const net = fakeFetch({ throwNetwork: true });
    const p = createFireflyProvider({ baseUrl: 'https://firefly.invalid', pat: 'x', fetchImpl: net.impl });
    await expect(p.listSince(null, 10)).rejects.toMatchObject({ reason: 'network_error' });
    const html = fakeFetch({ body: '<html>login</html>' });
    const q = createFireflyProvider({ baseUrl: 'https://firefly.invalid', pat: 'x', fetchImpl: html.impl });
    await expect(q.listSince(null, 10)).rejects.toMatchObject({ reason: 'bad_response' });
  });

  it('refuses to run without a token', async () => {
    const f = fakeFetch();
    const p = createFireflyProvider({ baseUrl: 'https://firefly.invalid', pat: '', fetchImpl: f.impl });
    await expect(p.listSince(null, 10)).rejects.toMatchObject({ reason: 'no_credentials' });
    expect(f.calls).toHaveLength(0);
  });
});
