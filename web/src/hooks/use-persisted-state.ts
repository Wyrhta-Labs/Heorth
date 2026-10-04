import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ZodType } from 'zod';
import { loadUiState, saveUiState } from '@/lib/ui-state';

/**
 * useState that is remembered per browser (lib/ui-state.ts). The schema
 * guards the read, so a stale or hand-edited value falls back cleanly.
 * The key and schema are read once on mount.
 */
export function usePersistedState<T>(
  key: string, schema: ZodType<T>, fallback: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => loadUiState(key, schema, fallback));
  useEffect(() => {
    saveUiState(key, value);
  }, [key, value]);
  return [value, setValue];
}
