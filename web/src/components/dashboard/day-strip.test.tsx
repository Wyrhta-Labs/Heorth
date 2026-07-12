import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DayStrip from './day-strip';
import { weekDays, dayLabel } from '@/lib/format';

describe('DayStrip', () => {
  it('renders seven day cells for the current week', () => {
    render(<DayStrip />);
    // Each weekday abbreviation appears (Mon..Sun); assert count via day-of-month text.
    for (const d of weekDays()) {
      expect(screen.getAllByText(dayLabel(d).dom).length).toBeGreaterThan(0);
    }
  });
});
