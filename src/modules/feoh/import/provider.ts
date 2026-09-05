import { config } from '../../../config/env.js';
import { createFireflyProvider } from './providers/firefly.js';
import type { TransactionSourceProvider } from './providers/types.js';

let override: TransactionSourceProvider | null | undefined;
let defaultProvider: TransactionSourceProvider | null | undefined;

export function setTransactionSourceProvider(p: TransactionSourceProvider | null): void {
  override = p;
}

export function resetTransactionSourceProvider(): void {
  override = undefined;
}

/** Tests install a fake (or an explicit null); production resolves Firefly from `config.feohImport`. */
export function getTransactionSourceProvider(): TransactionSourceProvider | null {
  if (override !== undefined) return override;
  if (defaultProvider === undefined) {
    defaultProvider = config.feohImport ? createFireflyProvider(config.feohImport) : null;
  }
  return defaultProvider;
}
