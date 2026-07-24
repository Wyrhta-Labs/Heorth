import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError } from '@/api/client';
import {
  saveShoppingListCache, loadShoppingListCache,
  enqueueCheckoff, listQueuedCheckoffs, removeQueuedCheckoff, clearQueue,
  replayQueuedCheckoffs, applyQueueOverlay,
} from './shopping-offline';
import type { ShoppingListItem } from '@/lib/types';

const item = (over: Partial<ShoppingListItem>): ShoppingListItem => ({
  id: 'x', createdAt: '', updatedAt: '', name: 'Milk', qty: null, unit: null,
  checked: false, sourceRecipeId: null, ...over,
});

beforeEach(() => {
  localStorage.clear();
});

describe('shopping list cache', () => {
  it('round-trips items with a cachedAt timestamp', () => {
    saveShoppingListCache([item({ id: 'a' })]);
    const cache = loadShoppingListCache();
    expect(cache?.items).toHaveLength(1);
    expect(cache?.items[0]!.id).toBe('a');
    expect(typeof cache?.cachedAt).toBe('string');
  });

  it('returns null when nothing cached yet', () => {
    expect(loadShoppingListCache()).toBeNull();
  });

  it('tolerates corrupt storage rather than throwing', () => {
    localStorage.setItem('heorth:shopping-list:cache', '{not json');
    expect(loadShoppingListCache()).toBeNull();
  });
});

describe('check-off queue', () => {
  it('starts empty', () => {
    expect(listQueuedCheckoffs()).toEqual([]);
  });

  it('enqueues a new entry', () => {
    enqueueCheckoff('a', true);
    const q = listQueuedCheckoffs();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ id: 'a', checked: true });
  });

  it('replaces (does not duplicate) a queued entry for the same id — last write wins', () => {
    enqueueCheckoff('a', true);
    enqueueCheckoff('a', false);
    enqueueCheckoff('a', true);
    const q = listQueuedCheckoffs();
    expect(q).toHaveLength(1);
    expect(q[0]!.checked).toBe(true);
  });

  it('removes a single entry', () => {
    enqueueCheckoff('a', true);
    enqueueCheckoff('b', true);
    removeQueuedCheckoff('a');
    expect(listQueuedCheckoffs().map((q) => q.id)).toEqual(['b']);
  });

  it('clears the whole queue', () => {
    enqueueCheckoff('a', true);
    clearQueue();
    expect(listQueuedCheckoffs()).toEqual([]);
  });
});

describe('replayQueuedCheckoffs', () => {
  it('removes entries that replay successfully', async () => {
    enqueueCheckoff('a', true);
    enqueueCheckoff('b', false);
    const apply = vi.fn().mockResolvedValue(undefined);
    const outcomes = await replayQueuedCheckoffs(apply);
    expect(apply).toHaveBeenCalledWith('a', true);
    expect(apply).toHaveBeenCalledWith('b', false);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(listQueuedCheckoffs()).toEqual([]);
  });

  it('is idempotent: replaying an already-applied checked=true is a safe no-op', async () => {
    enqueueCheckoff('a', true);
    // Simulate the item already being checked upstream (e.g. checked from
    // another device) — an absolute PATCH set just re-affirms the same value.
    const apply = vi.fn().mockResolvedValue({ data: { id: 'a', checked: true } });
    await replayQueuedCheckoffs(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(listQueuedCheckoffs()).toEqual([]);
  });

  it('drops an entry whose item no longer exists (404) instead of retrying forever', async () => {
    enqueueCheckoff('gone', true);
    const apply = vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Item not found'));
    const outcomes = await replayQueuedCheckoffs(apply);
    expect(outcomes[0]).toMatchObject({ id: 'gone', ok: false, dropped: true });
    expect(listQueuedCheckoffs()).toEqual([]);
  });

  it('requeues an entry that fails for any other reason (still offline / 5xx)', async () => {
    enqueueCheckoff('a', true);
    const apply = vi.fn().mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'no network'));
    const outcomes = await replayQueuedCheckoffs(apply);
    expect(outcomes[0]).toMatchObject({ id: 'a', ok: false });
    expect(outcomes[0]!.dropped).toBeUndefined();
    expect(listQueuedCheckoffs()).toHaveLength(1);
  });

  it('processes entries independently — one failure does not block others', async () => {
    enqueueCheckoff('bad', true);
    enqueueCheckoff('good', true);
    const apply = vi.fn().mockImplementation((id: string) =>
      id === 'bad' ? Promise.reject(new ApiError(503, 'UNAVAILABLE', 'no network')) : Promise.resolve(undefined),
    );
    await replayQueuedCheckoffs(apply);
    expect(listQueuedCheckoffs().map((q) => q.id)).toEqual(['bad']);
  });
});

describe('applyQueueOverlay', () => {
  it('overlays queued checked state onto fresh server data', () => {
    const items = [item({ id: 'a', checked: false }), item({ id: 'b', checked: true })];
    const overlaid = applyQueueOverlay(items, [{ id: 'a', checked: true, queuedAt: '' }]);
    expect(overlaid.find((i) => i.id === 'a')?.checked).toBe(true);
    expect(overlaid.find((i) => i.id === 'b')?.checked).toBe(true);
  });

  it('returns the same array reference when the queue is empty', () => {
    const items = [item({ id: 'a' })];
    expect(applyQueueOverlay(items, [])).toBe(items);
  });
});
