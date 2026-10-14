// The browser runs in UTC; the household lives in Pacific/Auckland (UTC+12 in
// July). Set before any import touches Date/Intl.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const upsert = { mutateAsync: vi.fn(async () => ({})), isPending: false };
vi.mock('@/hooks/use-meals', () => ({ useUpsertPlanEntry: () => upsert }));
vi.mock('@/hooks/use-tasks', () => ({ useCreateTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
type HouseholdStub = { data?: { data: { timezone: string } }; isError: boolean };
const loaded: HouseholdStub = { data: { data: { timezone: 'Pacific/Auckland' } }, isError: false };
const useHouseholdMock = vi.fn((): HouseholdStub => loaded);
vi.mock('@/hooks/use-household', () => ({ useHousehold: () => useHouseholdMock() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import CapturePage from './capture';

// 13:00Z on Sun 26 Jul is 01:00 on Mon 27 Jul in Auckland.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-26T13:00:00Z'));
  upsert.mutateAsync.mockClear();
  useHouseholdMock.mockReturnValue(loaded);
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

const writeNote = () => {
  fireEvent.click(screen.getByRole('button', { name: /meal note/i }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Leftovers' } });
};

describe('CapturePage meal note in the household time zone', () => {
  it("files the note under the household's today", async () => {
    render(<CapturePage />);
    writeNote();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save note/i })); });
    expect(upsert.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-07-27', freeText: 'Leftovers' }));
  });

  it("can't save a browser-dated note while the household loads", () => {
    useHouseholdMock.mockReturnValue({ data: undefined, isError: false });
    render(<CapturePage />);
    writeNote();
    expect(screen.getByRole('button', { name: /save note/i })).toBeDisabled();
  });
});
