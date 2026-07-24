import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/meals';
import {
  saveShoppingListCache, loadShoppingListCache,
  enqueueCheckoff, listQueuedCheckoffs, applyQueueOverlay,
  replayQueuedCheckoffs,
} from '@/lib/shopping-offline';
import { useShoppingList, useAddShoppingItem, useRemoveShoppingItem, useGenerateShoppingList } from '@/hooks/use-meals';
import type { ShoppingListItem } from '@/lib/types';

export interface OfflineShoppingList {
  items: ShoppingListItem[];
  /** True once the live query has failed or the browser reports no connection. */
  isOffline: boolean;
  /** When rendering from the offline cache, when that snapshot was taken. */
  dataAsOf: string | null;
  /** Check-offs made offline and not yet replayed to the server. */
  pendingCount: number;
  toggle: (id: string, checked: boolean) => void;
  add: (name: string) => void;
  remove: (id: string) => void;
  generate: (from: string, to: string) => void;
}

/**
 * The shopping list, made safe for the supermarket dead-spot: renders the
 * last-known list (with its age) when the network is down, and queues
 * check-offs for replay instead of losing them. See src/lib/shopping-offline.ts
 * for the persistence + replay logic this composes.
 */
export function useOfflineShoppingList(): OfflineShoppingList {
  const qc = useQueryClient();
  const query = useShoppingList();
  const addMutation = useAddShoppingItem();
  const removeMutation = useRemoveShoppingItem();
  const generateMutation = useGenerateShoppingList();

  const [pendingCount, setPendingCount] = useState(() => listQueuedCheckoffs().length);
  const [browserOffline, setBrowserOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  const refreshPendingCount = useCallback(() => setPendingCount(listQueuedCheckoffs().length), []);

  const replay = useCallback(async () => {
    if (listQueuedCheckoffs().length === 0) return;
    await replayQueuedCheckoffs((id, checked) => api.updateShoppingItem(id, { checked }));
    refreshPendingCount();
    qc.invalidateQueries({ queryKey: QUERY_KEYS.shoppingList });
  }, [qc, refreshPendingCount]);

  useEffect(() => {
    const onOnline = () => { setBrowserOffline(false); void replay(); };
    const onOffline = () => setBrowserOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void replay();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [replay]);

  useEffect(() => {
    if (query.data?.data) saveShoppingListCache(query.data.data);
  }, [query.data]);

  const cache = useMemo(() => loadShoppingListCache(), [query.isError, query.data]);
  const liveItems = query.data?.data;
  const isOffline = browserOffline || (query.isError && !!cache);
  const baseItems = liveItems ?? cache?.items ?? [];
  const items = applyQueueOverlay(baseItems, listQueuedCheckoffs());
  const dataAsOf = liveItems ? null : (cache?.cachedAt ?? null);

  const toggle = useCallback((id: string, checked: boolean) => {
    // Optimistic: reflect the tap immediately regardless of network state.
    qc.setQueryData(QUERY_KEYS.shoppingList, (prev: { data: ShoppingListItem[] } | undefined) => {
      if (!prev) return prev;
      return { ...prev, data: prev.data.map((i) => (i.id === id ? { ...i, checked } : i)) };
    });
    api.updateShoppingItem(id, { checked })
      .then(() => qc.invalidateQueries({ queryKey: QUERY_KEYS.shoppingList }))
      .catch(() => {
        enqueueCheckoff(id, checked);
        refreshPendingCount();
      });
  }, [qc, refreshPendingCount]);

  return {
    items,
    isOffline,
    dataAsOf,
    pendingCount,
    toggle,
    add: (name) => addMutation.mutate({ name }),
    remove: (id) => removeMutation.mutate(id),
    generate: (from, to) => generateMutation.mutate({ from, to }),
  };
}
