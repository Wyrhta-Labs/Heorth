import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { getFeatures } from '@/api/features';

export function useFeatures() {
  return useQuery({ queryKey: QUERY_KEYS.features, queryFn: () => getFeatures() });
}
