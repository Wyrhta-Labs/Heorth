import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const useMembersMock = vi.fn();
vi.mock('@/api/household', () => ({ listMembers: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => useMembersMock() }));

const { useHouseholdMembers } = await import('./use-household');

describe('useHouseholdMembers', () => {
  it('filters out the admin but keeps everyone else', () => {
    useMembersMock.mockReturnValue({
      data: { data: [
        { id: 'a', role: 'admin', displayName: 'Admin' },
        { id: 'b', role: 'adult', displayName: 'Anna' },
        { id: 'c', role: 'child', displayName: 'Kim' },
      ] },
      isError: false,
    });

    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data?.data.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('survives a not-yet-loaded query', () => {
    useMembersMock.mockReturnValue({ data: undefined, isError: false });
    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data).toBeUndefined();
  });
});
