/**
 * Provider-agnostic contract for a bank-line source (ADR 0016 §2). One-way and
 * semantics-free: two read methods, no create/update/delete, no Firefly type
 * crosses this boundary. A CSV or other aggregator implements the same two
 * methods, which is what makes the sidecar replaceable rather than "abstracted".
 */

export interface SourceAccount {
  sourceAccountId: string;
  name: string;
  currency: string;
}

export interface ImportedTransaction {
  /** Stable per LINE, not per group (a Firefly split yields one row per journal line). */
  sourceId: string;
  sourceAccountId: string;
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  payee: string;
  memo: string | null;
  /** Always positive. */
  amount: number;
  /** ISO 4217, as delivered. */
  currency: string;
  direction: 'in' | 'out';
}

export interface SourcePage {
  items: ImportedTransaction[];
  /** Opaque watermark for the next call WITHIN this sweep. Null means the sweep is complete. */
  nextCursor: string | null;
  /**
   * Opaque watermark to persist once the sweep completes — where the NEXT sweep
   * starts. The provider re-windows it by its own overlap (banks backdate), so
   * the caller never does date arithmetic on a cursor.
   */
  checkpoint: string;
}

export interface TransactionSourceProvider {
  /**
   * The provider owes a total, stable sort over the rows it emits, and a
   * `nextCursor` that never sits in the middle of rows sharing a sort key.
   */
  listSince(cursor: string | null, limit: number): Promise<SourcePage>;
  listAccounts(): Promise<SourceAccount[]>;
}

/** The ONLY tokens that may reach `feoh_import_state.last_error` or a log line. */
export type SourceErrorReason =
  | 'no_credentials' | 'auth_failed' | 'network_error' | 'rate_limited' | 'bad_response' | 'error';

export class SourceProviderError extends Error {
  constructor(public readonly reason: SourceErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'SourceProviderError';
  }
}
