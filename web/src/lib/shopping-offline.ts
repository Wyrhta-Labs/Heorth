import { ApiError } from '@/api/client';
import type { ShoppingListItem } from '@/lib/types';

// ---------------------------------------------------------------------------
// Offline support for the shopping list phone screen (Task 2.4). Two pieces,
// both pure/localStorage-backed so they're testable without a real service
// worker or network:
//
//  1. A "last-known list" cache — written on every successful fetch, read
//     back when the live query fails/is offline, alongside its timestamp so
//     the UI can show "offline · data from 5:40pm".
//  2. A check-off queue — the ONE write this surface must tolerate offline.
//     The check-off endpoint (PATCH /meals/shopping-list/:id { checked }) is
//     an absolute set, not a toggle, so replaying a queued entry is always
//     idempotent: applying `{checked:true}` twice converges to the same state
//     both times. A 404 (item deleted/consumed meanwhile, e.g. a list
//     regenerate) drops the entry instead of retrying forever; any other
//     failure (still offline, 5xx) leaves it queued for the next attempt.
// ---------------------------------------------------------------------------

const LIST_CACHE_KEY = 'heorth:shopping-list:cache';
const QUEUE_KEY = 'heorth:shopping-list:queue';

export interface ShoppingListCache {
  items: ShoppingListItem[];
  cachedAt: string;
}

export interface QueuedCheckoff {
  id: string;
  checked: boolean;
  queuedAt: string;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full/unavailable (private browsing, quota) — degrade silently;
    // offline support is a nicety, not a hard requirement to use the app.
  }
}

/** Persist the latest successfully-fetched list, for offline fallback rendering. */
export function saveShoppingListCache(items: ShoppingListItem[]): void {
  const cache: ShoppingListCache = { items, cachedAt: new Date().toISOString() };
  writeJson(LIST_CACHE_KEY, cache);
}

export function loadShoppingListCache(): ShoppingListCache | null {
  return readJson<ShoppingListCache>(LIST_CACHE_KEY);
}

// ---- Check-off queue -------------------------------------------------------

export function listQueuedCheckoffs(): QueuedCheckoff[] {
  return readJson<QueuedCheckoff[]>(QUEUE_KEY) ?? [];
}

/** Queue (or replace) a check-off for `id`. Last write for a given id wins —
 * flipping a box twice while offline only ever replays the final state. */
export function enqueueCheckoff(id: string, checked: boolean): void {
  const items = listQueuedCheckoffs();
  const idx = items.findIndex((i) => i.id === id);
  const entry: QueuedCheckoff = { id, checked, queuedAt: new Date().toISOString() };
  if (idx >= 0) items[idx] = entry;
  else items.push(entry);
  writeJson(QUEUE_KEY, items);
}

export function removeQueuedCheckoff(id: string): void {
  writeJson(QUEUE_KEY, listQueuedCheckoffs().filter((i) => i.id !== id));
}

export function clearQueue(): void {
  writeJson(QUEUE_KEY, []);
}

export interface ReplayOutcome {
  id: string;
  ok: boolean;
  /** true if dropped because the item no longer exists upstream (404) */
  dropped?: boolean;
}

/**
 * Replay every queued check-off against `apply` (typically the real PATCH
 * call). Processes sequentially so a still-offline apply fails fast without
 * piling up concurrent retries. Successes and 404s are removed from the
 * queue; any other failure is left queued for the next replay attempt.
 */
export async function replayQueuedCheckoffs(
  apply: (id: string, checked: boolean) => Promise<unknown>,
): Promise<ReplayOutcome[]> {
  const outcomes: ReplayOutcome[] = [];
  for (const item of listQueuedCheckoffs()) {
    try {
      await apply(item.id, item.checked);
      removeQueuedCheckoff(item.id);
      outcomes.push({ id: item.id, ok: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        removeQueuedCheckoff(item.id);
        outcomes.push({ id: item.id, ok: false, dropped: true });
      } else {
        outcomes.push({ id: item.id, ok: false });
      }
    }
  }
  return outcomes;
}

/** Overlay queued-but-not-yet-replayed check-offs onto a freshly fetched list,
 * so the UI never flashes back to the pre-tap state while offline. */
export function applyQueueOverlay(items: ShoppingListItem[], queue: QueuedCheckoff[]): ShoppingListItem[] {
  if (queue.length === 0) return items;
  const byId = new Map(queue.map((q) => [q.id, q.checked]));
  return items.map((item) => (byId.has(item.id) ? { ...item, checked: byId.get(item.id)! } : item));
}
