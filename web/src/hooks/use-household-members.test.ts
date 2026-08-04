import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const useMembersMock = vi.fn();
vi.mock('@/api/household', () => ({ listMembers: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => useMembersMock() }));

const { useHouseholdMembers } = await import('./use-household');

describe('useHouseholdMembers', () => {
  it('filters out the maintenance admin (by handle) but keeps everyone else', () => {
    useMembersMock.mockReturnValue({
      data: { data: [
        { id: 'a', role: 'admin', handle: 'admin', displayName: 'Admin' },
        { id: 'b', role: 'adult', handle: 'anna', displayName: 'Anna' },
        { id: 'c', role: 'child', handle: 'kim', displayName: 'Kim' },
      ] },
      isError: false,
    });

    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data?.data.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('keeps a promoted member with role "admin" whose handle is NOT the maintenance handle (the regression this fixes)', () => {
    useMembersMock.mockReturnValue({
      data: { data: [
        { id: 'a', role: 'admin', handle: 'admin', displayName: 'Admin' },
        // Promoted via PATCH /members/:id/role — an ordinary member, not quarantined.
        { id: 'b', role: 'admin', handle: 'anna', displayName: 'Anna' },
      ] },
      isError: false,
    });

    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data?.data.map((m) => m.id)).toEqual(['b']);
  });

  it('keeps a member with a null handle (never the maintenance admin)', () => {
    useMembersMock.mockReturnValue({
      data: { data: [
        { id: 'a', role: 'admin', handle: 'admin', displayName: 'Admin' },
        { id: 'b', role: 'adult', handle: null, displayName: 'No Handle' },
      ] },
      isError: false,
    });

    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data?.data.map((m) => m.id)).toEqual(['b']);
  });

  it('survives a not-yet-loaded query', () => {
    useMembersMock.mockReturnValue({ data: undefined, isError: false });
    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data).toBeUndefined();
  });
});
