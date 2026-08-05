import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import HouseholdSettings from './household-settings';
import type { Household } from '@/lib/types';

const household = (over: Partial<Household>): Household => ({
  id: 'h1', name: 'The Smiths', timezone: 'Europe/London', locale: 'en-GB', createdAt: '', ...over,
});

const OPTIONS = {
  timezones: ['UTC', 'America/New_York', 'Europe/Berlin', 'Europe/London'],
  locales: [
    { value: 'de-DE', label: 'Deutsch (Deutschland)' },
    { value: 'en-GB', label: 'English (United Kingdom)' },
    { value: 'en-US', label: 'English (United States)' },
  ],
};

const useHouseholdMock = vi.fn();
const useHouseholdOptionsMock = vi.fn(() => ({ data: { data: OPTIONS } }));

vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => useHouseholdMock(),
  useHouseholdOptions: () => useHouseholdOptionsMock(),
  useUpdateHousehold: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Adults DO render this component now, read-only (see `settings-tabs.ts`). The
// `readOnly` prop is presentation only — `PATCH /household` stays admin-gated.
describe('HouseholdSettings', () => {
  it('resyncs the form to newly refetched household data instead of keeping stale values', () => {
    useHouseholdMock.mockReturnValue({ data: { data: household({}) } });
    const { rerender } = render(<HouseholdSettings />);

    expect(screen.getByLabelText('Name')).toHaveValue('The Smiths');
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/London');
    expect(screen.getByLabelText('Locale')).toHaveValue('en-GB');

    // Simulate a refetch (e.g. after another admin edited the household) that
    // returns a new query result with updated field values.
    useHouseholdMock.mockReturnValue({
      data: { data: household({ name: 'The Joneses', timezone: 'America/New_York', locale: 'en-US' }) },
    });
    rerender(<HouseholdSettings />);

    // Without the fix, the form would still show the original stale values
    // because the render-time guard only fires once (while fields are '').
    expect(screen.getByLabelText('Name')).toHaveValue('The Joneses');
    expect(screen.getByLabelText('Timezone')).toHaveValue('America/New_York');
    expect(screen.getByLabelText('Locale')).toHaveValue('en-US');
  });

  it('renders timezone and locale as selects populated from the API option lists', () => {
    useHouseholdMock.mockReturnValue({ data: { data: household({}) } });
    render(<HouseholdSettings />);

    const tz = screen.getByLabelText('Timezone');
    const locale = screen.getByLabelText('Locale');
    expect(tz.tagName).toBe('SELECT');
    expect(locale.tagName).toBe('SELECT');

    expect([...(tz as HTMLSelectElement).options].map((o) => o.value)).toEqual(OPTIONS.timezones);
    expect([...(locale as HTMLSelectElement).options].map((o) => o.value))
      .toEqual(OPTIONS.locales.map((l) => l.value));
    // Zones are grouped by region, with the region-less UTC left ungrouped.
    expect(screen.getByRole('group', { name: 'Europe' })).toBeInTheDocument();
  });

  it('keeps a stored value that is not in the option list selectable', () => {
    // A row seeded while these fields were free text, or an option list that
    // has not loaded yet — the select must still show the household's value
    // rather than silently substituting the first option.
    useHouseholdMock.mockReturnValue({ data: { data: household({ timezone: 'Mars/Olympus', locale: 'xx-XX' }) } });
    render(<HouseholdSettings />);

    expect(screen.getByLabelText('Timezone')).toHaveValue('Mars/Olympus');
    expect(screen.getByLabelText('Locale')).toHaveValue('xx-XX');
  });

  it('renders read-only: fields disabled, no save button, hint shown', () => {
    useHouseholdMock.mockReturnValue({ data: { data: household({}) } });
    render(<HouseholdSettings readOnly />);

    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Timezone')).toBeDisabled();
    expect(screen.getByLabelText('Locale')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText('Only admins can change these.')).toBeInTheDocument();
  });

  it('stays editable by default', () => {
    useHouseholdMock.mockReturnValue({ data: { data: household({}) } });
    render(<HouseholdSettings />);

    expect(screen.getByLabelText('Name')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  afterEach(() => {
    cleanup();
    useHouseholdMock.mockReset();
  });
});
