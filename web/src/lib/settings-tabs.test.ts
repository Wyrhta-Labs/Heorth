import { describe, it, expect } from 'vitest';
import { byRole, findSettingsTab, SETTINGS_TABS, DEFAULT_SETTINGS_TAB } from './settings-tabs';
import type { Member, Role } from '@/lib/types';

function memberWith(role: Role, handle: string | null = 'someone'): Member {
  return {
    id: 'm1', createdAt: '', updatedAt: '', email: 'a@b.test', handle,
    role, displayName: 'Someone', avatarColor: 'ember',
  };
}

describe('byRole', () => {
  it('makes a tab visible only to the listed roles', () => {
    const access = byRole({ roles: ['admin', 'adult'] });
    expect(access(memberWith('admin')).visible).toBe(true);
    expect(access(memberWith('adult')).visible).toBe(true);
    expect(access(memberWith('child')).visible).toBe(false);
  });

  it('marks only the readOnlyFor roles read-only', () => {
    const access = byRole({ roles: ['admin', 'adult'], readOnlyFor: ['adult'] });
    expect(access(memberWith('admin')).readOnly).toBe(false);
    expect(access(memberWith('adult')).readOnly).toBe(true);
  });

  it('defaults readOnlyFor to nobody', () => {
    const access = byRole({ roles: ['admin', 'adult'] });
    expect(access(memberWith('adult')).readOnly).toBe(false);
  });
});

describe('SETTINGS_TABS', () => {
  it('gates the four tabs as designed', () => {
    const visibleTo = (role: Role) =>
      SETTINGS_TABS.filter((tab) => tab.access(memberWith(role)).visible).map((tab) => tab.id);

    expect(visibleTo('admin')).toEqual(['members', 'keys', 'settings', 'connections']);
    expect(visibleTo('adult')).toEqual(['members', 'keys', 'settings', 'connections']);
    expect(visibleTo('child')).toEqual(['members']);
  });

  it('makes settings and connections read-only for an adult but not an admin', () => {
    const readOnlyFor = (role: Role) =>
      SETTINGS_TABS.filter((tab) => tab.access(memberWith(role)).readOnly).map((tab) => tab.id);

    expect(readOnlyFor('adult')).toEqual(['members', 'settings', 'connections']);
    expect(readOnlyFor('admin')).toEqual([]);
  });

  it('keeps the default tab visible to every role so it is always a valid fallback', () => {
    const fallback = findSettingsTab(DEFAULT_SETTINGS_TAB);
    expect(fallback).toBeDefined();
    for (const role of ['admin', 'adult', 'child'] as Role[]) {
      expect(fallback!.access(memberWith(role)).visible).toBe(true);
    }
  });
});

describe('findSettingsTab', () => {
  it('resolves a known id and rejects an unknown one', () => {
    expect(findSettingsTab('settings')?.id).toBe('settings');
    expect(findSettingsTab('nope')).toBeUndefined();
    expect(findSettingsTab('')).toBeUndefined();
  });
});
