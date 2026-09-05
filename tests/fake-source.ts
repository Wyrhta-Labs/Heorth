import type {
  ImportedTransaction, SourceAccount, SourcePage, TransactionSourceProvider,
} from '../src/modules/feoh/import/providers/types.js';
import { SourceProviderError } from '../src/modules/feoh/import/providers/types.js';

export function fakeLine(over: Partial<ImportedTransaction> = {}): ImportedTransaction {
  return {
    sourceId: '101:1', sourceAccountId: '7', date: '2026-09-01', payee: 'Rewe',
    memo: null, amount: 42.1, currency: 'EUR', direction: 'out', ...over,
  };
}

function key(l: ImportedTransaction): string {
  return `${l.date}|${l.sourceId}`;
}

/**
 * In-memory source. Cursor = index offset into the sorted rows; checkpoint is
 * always '0', which models the overlap window: every sweep replays everything
 * and dedup on source_id has to make that free.
 */
export class FakeSource implements TransactionSourceProvider {
  rows: ImportedTransaction[] = [];
  accounts: SourceAccount[] = [];
  failWith: SourceProviderError | null = null;
  calls = 0;

  async listSince(cursor: string | null, limit: number): Promise<SourcePage> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    const sorted = [...this.rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const start = cursor ? Number(cursor) : 0;
    const items = sorted.slice(start, start + limit);
    const next = start + items.length;
    return { items, nextCursor: next < sorted.length ? String(next) : null, checkpoint: '0' };
  }

  async listAccounts(): Promise<SourceAccount[]> {
    if (this.failWith) throw this.failWith;
    return this.accounts;
  }
}
