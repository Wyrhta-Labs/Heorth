import { eq, sql } from 'drizzle-orm';
import { logError } from '@wyrhta/core/lib';
import { db } from '../../../db/index.js';
import { feohImportState, feohImportedTransactions, type ImportState } from './schema.js';
import { getTransactionSourceProvider } from './provider.js';
import { SourceProviderError, type TransactionSourceProvider } from './providers/types.js';
import { ingest } from './service.js';
import { config } from '../../../config/env.js';

export const FEED_KEY = 'firefly:transactions';
export const PAGE_LIMIT = 100;
/** Hard stop against a provider whose nextCursor never reaches null. */
const MAX_PAGES_PER_TICK = 1000;

export interface ImportTickResult {
  ok: boolean;
  pages: number;
  inserted: number;
  booked: number;
  skipped: number;
  error?: string;
}

/** Only ever a short, safe token — never a response body, URL or token material. */
export function classifySourceError(e: unknown): string {
  if (e instanceof SourceProviderError) return e.reason;
  if (e instanceof TypeError) return 'network_error';
  return 'error';
}

async function getOrCreateState(feedKey: string): Promise<ImportState> {
  const [existing] = await db.select().from(feohImportState).where(eq(feohImportState.feedKey, feedKey)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(feohImportState).values({ feedKey })
    .onConflictDoNothing({ target: feohImportState.feedKey }).returning();
  if (created) return created;
  const [raced] = await db.select().from(feohImportState).where(eq(feohImportState.feedKey, feedKey)).limit(1);
  return raced!;
}

async function saveCursor(feedKey: string, cursor: string): Promise<void> {
  await db.update(feohImportState).set({ cursor, updatedAt: new Date() }).where(eq(feohImportState.feedKey, feedKey));
}

async function saveSuccess(feedKey: string, checkpoint: string): Promise<void> {
  await db.update(feohImportState).set({
    cursor: checkpoint, lastSuccessAt: new Date(), lastError: null, consecutiveFailures: 0, updatedAt: new Date(),
  }).where(eq(feohImportState.feedKey, feedKey));
}

async function saveFailure(feedKey: string, reason: string): Promise<void> {
  await db.update(feohImportState).set({
    lastError: reason, consecutiveFailures: sql`${feohImportState.consecutiveFailures} + 1`, updatedAt: new Date(),
  }).where(eq(feohImportState.feedKey, feedKey));
}

/** One tick at a time per process: the scheduler and the manual trigger share this. */
let running = false;

/**
 * One tick (spec §3). Pull pages from the persisted cursor, ingest each page,
 * and advance the cursor ONLY after the whole page is written. A dead tick
 * replays its last page harmlessly (dedup on source_id). Never throws.
 * `already_running` and `provider_unavailable` are answered without touching
 * the feed state — neither is a feed failure.
 */
export async function runImportTick(): Promise<ImportTickResult> {
  const result: ImportTickResult = { ok: false, pages: 0, inserted: 0, booked: 0, skipped: 0 };
  const provider = getTransactionSourceProvider();
  if (!provider) return { ...result, error: 'provider_unavailable' };
  if (running) return { ...result, error: 'already_running' };
  running = true;
  try {
    return await runSweep(provider, result);
  } finally {
    running = false;
  }
}

async function runSweep(provider: TransactionSourceProvider, result: ImportTickResult): Promise<ImportTickResult> {
  const state = await getOrCreateState(FEED_KEY);
  let cursor = state.cursor;
  try {
    for (;;) {
      const page = await provider.listSince(cursor, PAGE_LIMIT);
      const r = await ingest(page.items);
      result.pages++;
      result.inserted += r.inserted;
      result.booked += r.booked;
      result.skipped += r.skipped;
      if (page.nextCursor === null) {
        await saveSuccess(FEED_KEY, page.checkpoint);
        break;
      }
      cursor = page.nextCursor;
      await saveCursor(FEED_KEY, cursor);
      if (result.pages >= MAX_PAGES_PER_TICK) throw new SourceProviderError('bad_response', 'page cap reached');
    }
    result.ok = true;
    return result;
  } catch (e) {
    const reason = classifySourceError(e);
    await saveFailure(FEED_KEY, reason);
    // A SourceProviderError message is provider-authored and body-free, but the
    // log line still carries only the token; anything else is a Heorth bug and
    // deserves its stack.
    logError('feoh import tick failed', e instanceof SourceProviderError ? new Error(reason) : e);
    return { ...result, error: reason };
  }
}

export interface ImportStatusView {
  enabled: boolean;
  /** The household's one currency (`FEOH_CURRENCY`) — the web reads it from here, never hard-codes it. */
  currency: string;
  pendingCount: number;
  feed: {
    feedKey: string;
    hasCursor: boolean;
    lastSuccessAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
  } | null;
}

/** For `GET /ingestion/status`. The cursor itself is never exposed. */
export async function getImportStatus(): Promise<ImportStatusView> {
  const [feed] = await db.select().from(feohImportState).where(eq(feohImportState.feedKey, FEED_KEY)).limit(1);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(feohImportedTransactions).where(eq(feohImportedTransactions.status, 'pending'));
  return {
    enabled: getTransactionSourceProvider() !== null,
    currency: config.feohCurrency,
    pendingCount: count,
    feed: feed
      ? {
          feedKey: feed.feedKey,
          hasCursor: feed.cursor !== null,
          lastSuccessAt: feed.lastSuccessAt ? feed.lastSuccessAt.toISOString() : null,
          lastError: feed.lastError,
          consecutiveFailures: feed.consecutiveFailures,
        }
      : null,
  };
}
