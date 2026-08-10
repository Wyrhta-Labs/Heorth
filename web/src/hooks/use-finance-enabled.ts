import { useFeatures } from './use-features';

/**
 * Single source of truth for "is finance on?" across the sidebar, the mobile
 * "More" sheet, and the /feoh page. A failed/errored features fetch must
 * behave as all-off — `data` stays `undefined` on error, so defaulting to
 * `false` covers loading, error, and disabled cases alike.
 *
 * Kept in its own module (rather than folded into `use-features.ts`) so
 * tests can mock `useFeatures` alone and still exercise this real fallback
 * logic — mocking the same module `useFinanceEnabled` is defined in would
 * shadow it too.
 */
export function useFinanceEnabled(): boolean {
  const featuresQuery = useFeatures();
  return featuresQuery.data?.data.finance ?? false;
}
