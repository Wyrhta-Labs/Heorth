import type { TransactionSourceProvider } from './providers/types.js';

/**
 * Resolution seam for the bank-line source, following `src/modules/tasks/provider.ts`.
 * Tests install a fake (or an explicit null) through the setter; production
 * resolves from `config.feohImport` (wired in Task 7 once the Firefly provider exists).
 */
let override: TransactionSourceProvider | null | undefined;

export function setTransactionSourceProvider(p: TransactionSourceProvider | null): void {
  override = p;
}

export function resetTransactionSourceProvider(): void {
  override = undefined;
}

export function getTransactionSourceProvider(): TransactionSourceProvider | null {
  if (override !== undefined) return override;
  // Task 7 replaces this line with the config-driven Firefly default.
  return null;
}
