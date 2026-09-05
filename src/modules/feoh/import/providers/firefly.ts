import {
  SourceProviderError,
  type ImportedTransaction, type SourceAccount, type SourcePage, type TransactionSourceProvider,
} from './types.js';

/**
 * Firefly III as a dumb pipe (ADR 0016 §1). Two GETs with a personal access
 * token; nothing else of Firefly's model is touched. No Firefly type leaves this
 * file: everything crosses the boundary as `ImportedTransaction`.
 *
 * Cursor (opaque to callers): JSON `{ since: 'YYYY-MM-DD' | null, after: [date, groupId, journalId] | null }`.
 * `since` bounds the fetch (Firefly's `start=`); `after` is the composite
 * watermark WITHIN a sweep. Firefly pages by page number and sorts newest first,
 * so a sweep fetches the whole `since` window, sorts it into a total order, and
 * hands it out `limit` rows at a time — a date alone would let a `limit` cut
 * through same-date rows and lose the remainder forever.
 *
 * The checkpoint re-windows `since` by `overlapDays` (banks backdate; dedup on
 * source_id makes the replay free) and clears `after`.
 */

export interface FireflyOptions {
  baseUrl: string;
  pat: string;
  fetchImpl?: typeof fetch;
  overlapDays?: number;
  pageSize?: number;
}

export type LineKey = [string, number, number];
export type FireflyLine = ImportedTransaction & { key: LineKey };

interface Cursor { since: string | null; after: LineKey | null }

const DEFAULT_OVERLAP_DAYS = 7;
const DEFAULT_PAGE_SIZE = 200;

// ---------------------------------------------------------------- parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function totalPagesOf(json: Record<string, unknown>): number {
  const meta = isRecord(json['meta']) ? json['meta'] : null;
  const pag = meta && isRecord(meta['pagination']) ? meta['pagination'] : null;
  const n = pag ? Number(pag['total_pages']) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Firefly's `date` is an ISO datetime with offset; the calendar date is its first 10 chars — never `toISOString()`. */
function calendarDate(v: unknown): string {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new SourceProviderError('bad_response', 'journal without a date');
  return s.slice(0, 10);
}

export function parseTransactionsPage(json: unknown): { lines: FireflyLine[]; totalPages: number } {
  if (!isRecord(json) || !Array.isArray(json['data'])) {
    throw new SourceProviderError('bad_response', 'not a Firefly transactions page');
  }
  const lines: FireflyLine[] = [];
  for (const group of json['data']) {
    if (!isRecord(group)) throw new SourceProviderError('bad_response', 'malformed group');
    const groupId = str(group['id']);
    const attrs = isRecord(group['attributes']) ? group['attributes'] : null;
    const journals = attrs && Array.isArray(attrs['transactions']) ? attrs['transactions'] : [];
    for (const j of journals) {
      if (!isRecord(j)) throw new SourceProviderError('bad_response', 'malformed journal');
      const type = str(j['type']);
      if (type !== 'withdrawal' && type !== 'deposit') continue; // transfers etc. are out of scope
      const direction = type === 'withdrawal' ? 'out' : 'in';
      const journalId = str(j['transaction_journal_id']);
      // The identifiers ARE the dedup key and the sort key: a blank or
      // non-numeric one would poison both, so it is a bad response, not a row.
      if (!/^\d+$/.test(groupId) || !/^\d+$/.test(journalId)) {
        throw new SourceProviderError('bad_response', 'journal without numeric group/journal ids');
      }
      const sourceAccountId = str(direction === 'out' ? j['source_id'] : j['destination_id']);
      if (!sourceAccountId) throw new SourceProviderError('bad_response', 'journal without an account id');
      const currency = str(j['currency_code']).trim();
      if (!currency) throw new SourceProviderError('bad_response', 'journal without a currency');
      const counterparty = str(direction === 'out' ? j['destination_name'] : j['source_name']).trim();
      const description = str(j['description']).trim();
      const payee = counterparty || description || 'Unknown payee';
      const amountRaw = Math.abs(Number(j['amount']));
      if (!Number.isFinite(amountRaw) || amountRaw <= 0) throw new SourceProviderError('bad_response', 'journal without an amount');
      const date = calendarDate(j['date']);
      lines.push({
        sourceId: `${groupId}:${journalId}`,
        sourceAccountId,
        date,
        payee,
        memo: description && description !== payee ? description : null,
        amount: Math.round(amountRaw * 100) / 100,
        currency,
        direction,
        key: [date, Number(groupId), Number(journalId)],
      });
    }
  }
  return { lines, totalPages: totalPagesOf(json) };
}

export function parseAccounts(json: unknown): SourceAccount[] {
  if (!isRecord(json) || !Array.isArray(json['data'])) {
    throw new SourceProviderError('bad_response', 'not a Firefly accounts page');
  }
  return json['data'].map((a) => {
    if (!isRecord(a)) throw new SourceProviderError('bad_response', 'malformed account');
    const attrs = isRecord(a['attributes']) ? a['attributes'] : {};
    return { sourceAccountId: str(a['id']), name: str(attrs['name']), currency: str(attrs['currency_code']) };
  });
}

// ------------------------------------------------------------- date maths

export function minusDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! - days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function compareKey(a: LineKey, b: LineKey): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function parseCursor(cursor: string | null): Cursor {
  if (cursor === null) return { since: null, after: null };
  try {
    const c = JSON.parse(cursor) as Partial<Cursor>;
    return { since: typeof c.since === 'string' ? c.since : null, after: Array.isArray(c.after) ? (c.after as LineKey) : null };
  } catch {
    // An unreadable cursor restarts the sweep from scratch; dedup makes that safe.
    return { since: null, after: null };
  }
}

// ---------------------------------------------------------------- provider

export function createFireflyProvider(o: FireflyOptions): TransactionSourceProvider {
  const base = o.baseUrl.replace(/\/+$/, '');
  const fetchImpl = o.fetchImpl ?? fetch;
  const overlapDays = o.overlapDays ?? DEFAULT_OVERLAP_DAYS;
  const pageSize = o.pageSize ?? DEFAULT_PAGE_SIZE;

  async function getJson(path: string): Promise<unknown> {
    if (!o.pat) throw new SourceProviderError('no_credentials', 'FIREFLY_PAT is blank');
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        headers: { authorization: `Bearer ${o.pat}`, accept: 'application/json' },
      });
    } catch (e) {
      if (e instanceof TypeError) throw new SourceProviderError('network_error', 'Firefly unreachable');
      throw new SourceProviderError('error', 'Firefly request failed');
    }
    // Messages carry the status only — never the body (financial data) and never the URL (could carry a token).
    if (res.status === 401 || res.status === 403) throw new SourceProviderError('auth_failed', `Firefly answered ${res.status}`);
    if (res.status === 429) throw new SourceProviderError('rate_limited', 'Firefly answered 429');
    if (!res.ok) throw new SourceProviderError('error', `Firefly answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new SourceProviderError('bad_response', 'Firefly answered non-JSON');
    }
  }

  async function fetchAllLines(since: string | null): Promise<FireflyLine[]> {
    const lines: FireflyLine[] = [];
    const start = since ? `&start=${since}` : '';
    let page = 1;
    let totalPages = 1;
    do {
      const json = await getJson(`/api/v1/transactions?limit=${pageSize}&page=${page}${start}`);
      const parsed = parseTransactionsPage(json);
      lines.push(...parsed.lines);
      totalPages = parsed.totalPages;
      page++;
    } while (page <= totalPages);
    return lines.sort((a, b) => compareKey(a.key, b.key));
  }

  return {
    async listSince(cursor, limit): Promise<SourcePage> {
      const c = parseCursor(cursor);
      const all = await fetchAllLines(c.since);
      const rest = c.after ? all.filter((l) => compareKey(l.key, c.after!) > 0) : all;
      const items = rest.slice(0, limit).map(({ key: _key, ...line }) => line);
      // Re-window only when rows were seen; an empty Firefly must not walk
      // `since` backwards a week per sweep.
      const checkpoint = JSON.stringify({
        since: all.length > 0 ? minusDays(all[all.length - 1]!.date, overlapDays) : c.since,
        after: null,
      } satisfies Cursor);
      const nextCursor = rest.length > limit
        ? JSON.stringify({ since: c.since, after: rest[limit - 1]!.key } satisfies Cursor)
        : null;
      return { items, nextCursor, checkpoint };
    },

    async listAccounts(): Promise<SourceAccount[]> {
      const out: SourceAccount[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const json = await getJson(`/api/v1/accounts?type=asset&limit=${pageSize}&page=${page}`);
        out.push(...parseAccounts(json));
        totalPages = isRecord(json) ? totalPagesOf(json) : 1;
        page++;
      } while (page <= totalPages);
      return out;
    },
  };
}
