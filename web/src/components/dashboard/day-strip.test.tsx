import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/hooks/use-household', () => ({ useHousehold: () => ({ data: { data: { timezone: 'UTC' } }, isError: false }) }));
import DayStrip from './day-strip';

describe('DayStrip', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('on a Sunday shows today followed by the coming week, not the week that is ending', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z')); // Sun 4 Oct 2026
    render(<DayStrip />);
    const cells = screen.getAllByTestId('day-strip-cell');
    expect(cells.map((c) => c.dataset.iso)).toEqual([
      '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    ]);
    expect(cells[0]!.dataset.today).toBe('true');
  });
});
