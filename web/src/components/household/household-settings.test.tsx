import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import HouseholdSettings from './household-settings';
import type { Household } from '@/lib/types';

const household = (over: Partial<Household>): Household => ({
  id: 'h1', name: 'The Smiths', timezone: 'Europe/London', locale: 'en-GB', createdAt: '', ...over,
});

const useHouseholdMock = vi.fn();

vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => useHouseholdMock(),
  useUpdateHousehold: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('HouseholdSettings', () => {
  it('resyncs the form to newly refetched household data instead of keeping stale values', () => {
    useHouseholdMock.mockReturnValue({ data: { data: household({}) } });
    const { rerender } = render(<HouseholdSettings canManage />);

    expect(screen.getByLabelText('Name')).toHaveValue('The Smiths');
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/London');
    expect(screen.getByLabelText('Locale')).toHaveValue('en-GB');

    // Simulate a refetch (e.g. after another admin edited the household) that
    // returns a new query result with updated field values.
    useHouseholdMock.mockReturnValue({
      data: { data: household({ name: 'The Joneses', timezone: 'America/New_York', locale: 'en-US' }) },
    });
    rerender(<HouseholdSettings canManage />);

    // Without the fix, the form would still show the original stale values
    // because the render-time guard only fires once (while fields are '').
    expect(screen.getByLabelText('Name')).toHaveValue('The Joneses');
    expect(screen.getByLabelText('Timezone')).toHaveValue('America/New_York');
    expect(screen.getByLabelText('Locale')).toHaveValue('en-US');
  });

  afterEach(() => {
    cleanup();
    useHouseholdMock.mockReset();
  });
});
