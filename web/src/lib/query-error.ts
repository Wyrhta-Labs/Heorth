/** Minimal shape shared by every TanStack Query result we care about here. */
export interface QueryLike {
  isError: boolean;
  refetch: () => unknown;
}

/**
 * If any of the given queries has errored, return a single retry function that
 * refetches all the failed ones; otherwise return null. Lets a page/widget
 * render one consistent <ErrorState onRetry={...}/> across several queries.
 */
export function retryOf(...queries: QueryLike[]): (() => void) | null {
  const errored = queries.filter((q) => q.isError);
  if (errored.length === 0) return null;
  return () => {
    for (const q of errored) q.refetch();
  };
}
