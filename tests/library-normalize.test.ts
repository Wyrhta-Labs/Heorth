import { describe, it, expect } from 'vitest';
import { makeSortTitle, mergeLists } from '../src/modules/library/connectors/normalize.js';

describe('normalize helpers', () => {
  it('strips leading articles and lowercases for sortTitle', () => {
    expect(makeSortTitle('The Hobbit')).toBe('hobbit');
    expect(makeSortTitle('A Wizard of Earthsea')).toBe('wizard of earthsea');
    expect(makeSortTitle('Dune')).toBe('dune');
  });

  it('dedups and orders list membership', () => {
    expect(mergeLists(['favorites'], ['later', 'favorites'])).toEqual(['later', 'favorites']);
    expect(mergeLists([], [])).toEqual([]);
  });
});
