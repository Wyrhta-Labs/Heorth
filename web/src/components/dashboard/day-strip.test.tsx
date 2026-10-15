import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('DayStrip with onSelect', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('renders the days as buttons, marks the selected one and reports a click', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const onSelect = vi.fn();
    render(<DayStrip selected="2026-10-06" onSelect={onSelect} />);
    const cells = screen.getAllByTestId('day-strip-cell');
    expect(cells.every((c) => c.tagName === 'BUTTON')).toBe(true);
    expect(cells[2]).toHaveAttribute('aria-pressed', 'true');
    expect(cells[0]).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(cells[4]!);
    expect(onSelect).toHaveBeenCalledWith('2026-10-08');
  });
});

describe('DayStrip today marker', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps the real today marked while another day is selected', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    render(<DayStrip selected="2026-10-07" onSelect={() => {}} />);
    const cells = screen.getAllByTestId('day-strip-cell');
    expect(cells[0]).toHaveAttribute('aria-current', 'date');
    expect(cells[0]!.querySelector('[data-today-marker]')).not.toBeNull();
    expect(cells[3]).not.toHaveAttribute('aria-current');
    expect(cells[3]!.querySelector('[data-today-marker]')).toBeNull();
    expect(cells[0]).toHaveAccessibleName(/today/i);
  });
});
