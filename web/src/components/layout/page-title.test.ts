import { describe, it, expect } from 'vitest';
import { titleKeyFor } from './app-shell';
import { navItems, isNavItemActive } from './sidebar';
import { DEFAULT_SETTINGS_TAB } from '@/lib/settings-tabs';

describe('titleKeyFor', () => {
  it('resolves an exact route', () => {
    expect(titleKeyFor('/calendar')).toBe('nav.calendar');
    expect(titleKeyFor('/')).toBe('nav.homeTitle');
  });

  it('resolves a nested household tab to the household title', () => {
    expect(titleKeyFor('/household')).toBe('nav.household');
    expect(titleKeyFor('/household/members')).toBe('nav.household');
    expect(titleKeyFor('/household/connections')).toBe('nav.household');
  });

  it('returns undefined for an unknown path', () => {
    expect(titleKeyFor('/nope')).toBeUndefined();
  });

  it('points the household nav item at a concrete tab so a click costs no redirect', () => {
    const household = navItems.find((item) => item.labelKey === 'nav.household');
    expect(household?.to).toBe(`/household/${DEFAULT_SETTINGS_TAB}`);
    // …but keeps /household as its active range, or the item would go dim on
    // every tab except Members. See `activePrefix` in sidebar.tsx.
    expect(household?.activePrefix).toBe('/household');
  });

  it('treats every household tab as active for the household nav item', () => {
    const household = navItems.find((item) => item.labelKey === 'nav.household')!;
    expect(isNavItemActive(household, '/household/members')).toBe(true);
    expect(isNavItemActive(household, '/household/settings')).toBe(true);
    expect(isNavItemActive(household, '/household')).toBe(true);
    expect(isNavItemActive(household, '/householding')).toBe(false);
  });

  it('still matches non-prefixed items exactly as before', () => {
    const home = navItems.find((item) => item.labelKey === 'nav.thisWeek')!;
    expect(isNavItemActive(home, '/')).toBe(true);
    expect(isNavItemActive(home, '/calendar')).toBe(false);
  });
});
