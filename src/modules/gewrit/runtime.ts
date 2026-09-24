import { config } from '../../config/env.js';
import type { DocumentProvider } from './providers/types.js';
import { createPaperlessProvider } from './providers/paperless.js';
import { createDemoProvider } from './providers/demo.js';

/**
 * The live document provider route handlers resolve per request — the same
 * get*Runtime / set*Runtime seam as src/modules/kith/runtime.ts. Tests install
 * an in-memory fake through the setter and never touch the network.
 */
export function isGewritEnabled(): boolean {
  return config.gewrit !== null;
}

let runtime: DocumentProvider | null = null;

/** Lazily-built singleton. Only valid when Gewrit is enabled; the mounted
 *  routes sit behind that gate. */
export function getGewritRuntime(): DocumentProvider {
  if (!runtime) {
    const cfg = config.gewrit;
    if (!cfg) throw new Error('Gewrit is disabled (GEWRIT_PROVIDER blank) — getGewritRuntime must not be called');
    runtime = cfg.provider === 'paperless' ? createPaperlessProvider(cfg) : createDemoProvider();
  }
  return runtime;
}

/** Test seam: install a fake provider (or null to rebuild from config). */
export function setGewritRuntime(next: DocumentProvider | null): void {
  runtime = next;
}
