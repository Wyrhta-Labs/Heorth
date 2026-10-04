import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { z } from 'zod';
import { usePersistedState } from './use-persisted-state';

const View = z.enum(['week', 'month']);

beforeEach(() => {
  localStorage.clear();
});

describe('usePersistedState', () => {
  it('starts from the fallback and remembers a change for the next mount', () => {
    const first = renderHook(() => usePersistedState('calendar:view', View, 'week'));
    expect(first.result.current[0]).toBe('week');
    act(() => first.result.current[1]('month'));
    expect(first.result.current[0]).toBe('month');
    first.unmount();

    const second = renderHook(() => usePersistedState('calendar:view', View, 'week'));
    expect(second.result.current[0]).toBe('month');
  });

  it('accepts an updater function like useState', () => {
    const { result } = renderHook(() => usePersistedState('x:flag', z.boolean(), false));
    act(() => result.current[1]((v) => !v));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('heorth:ui:x:flag')).toBe('true');
  });
});
