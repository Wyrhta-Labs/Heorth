// The browser runs in UTC; the household lives in Pacific/Auckland.
process.env.TZ = 'UTC';

import { describe, it, expect } from 'vitest';
import { enUS } from 'date-fns/locale';
import { formatDate } from './format';

describe('formatDate in the household zone', () => {
  it("shows an instant's household date, not the browser's", () => {
    // 21:00Z Sun 26 Jul = 09:00 Mon 27 Jul in Auckland.
    expect(formatDate('2026-07-26T21:00:00Z', enUS, 'Pacific/Auckland')).toBe('Jul 27, 2026');
    expect(formatDate('2026-07-26T21:00:00Z', enUS)).toBe('Jul 26, 2026');
  });

  it('leaves a plain calendar date as it is', () => {
    expect(formatDate('2026-07-27', enUS, 'Pacific/Auckland')).toBe('Jul 27, 2026');
  });
});
