import { STANDARD_LISTS, type StandardList } from '../schema.js';

export function makeSortTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
}

export function mergeLists(...lists: StandardList[][]): StandardList[] {
  const seen = new Set<StandardList>(lists.flat());
  return STANDARD_LISTS.filter((l) => seen.has(l));
}
