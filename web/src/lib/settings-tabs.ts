import type { ComponentType } from 'react';
import type { ParseKeys } from 'i18next';
import type { Member, Role } from '@/lib/types';
import MembersPanel from '@/components/household/members-panel';
import ApiKeysPanel from '@/components/household/api-keys-panel';
import HouseholdSettings from '@/components/household/household-settings';
import ConnectionsPanel from '@/components/household/connections-panel';

/** A catalog key, so `t(tab.labelKey)` type-checks like a literal would. */
type TranslationKey = ParseKeys<'translation'>;

export interface TabAccess {
  visible: boolean;
  readOnly: boolean;
}

/**
 * A contributed settings tab on /household. Add an entry to SETTINGS_TABS and
 * the tab, its URL (/household/<id>) and its panel all appear — no route or page
 * edit needed. Mirrors the PROVIDERS registry in `providers.ts`.
 *
 * `access` is PRESENTATION ONLY. It decides what is shown, never what is
 * permitted: the API's own role guards are the authorization boundary.
 */
export interface SettingsTab {
  /** URL segment under /household and the React key. Keep it slug-safe. */
  id: string;
  labelKey: TranslationKey;
  /**
   * Who may open this tab, and whether they get it read-only. A predicate over
   * the whole Member, NOT a role list: the maintenance admin is quarantined by
   * `handle` (see `maintenance-admin.ts` and profile.tsx), so a role list could
   * not express "admin except the maintenance admin".
   */
  access: (member: Member) => TabAccess;
  /**
   * Wrap the panel in a titled Card. Omit when the panel renders its own chrome
   * (members brings its own Card; connections is a multi-card layout).
   */
  card?: { titleKey: TranslationKey };
  Panel: ComponentType<{ readOnly: boolean }>;
}

/** The common case: gate on role alone. */
export function byRole({ roles, readOnlyFor = [] }: { roles: Role[]; readOnlyFor?: Role[] }): SettingsTab['access'] {
  return (member: Member): TabAccess => ({
    visible: roles.includes(member.role),
    readOnly: readOnlyFor.includes(member.role),
  });
}

export const SETTINGS_TABS = [
  {
    id: 'members',
    labelKey: 'settings.tabs.members',
    access: byRole({ roles: ['admin', 'adult', 'child'], readOnlyFor: ['adult', 'child'] }),
    Panel: MembersPanel,
  },
  {
    id: 'keys',
    labelKey: 'settings.tabs.apiKeys',
    access: byRole({ roles: ['admin', 'adult'] }),
    card: { titleKey: 'settings.tabs.apiKeys' },
    Panel: ApiKeysPanel,
  },
  {
    id: 'settings',
    labelKey: 'settings.tabs.settings',
    access: byRole({ roles: ['admin', 'adult'], readOnlyFor: ['adult'] }),
    card: { titleKey: 'nav.household' },
    Panel: HouseholdSettings,
  },
  {
    id: 'connections',
    labelKey: 'settings.tabs.connections',
    access: byRole({ roles: ['admin', 'adult'], readOnlyFor: ['adult'] }),
    Panel: ConnectionsPanel,
  },
] as const satisfies readonly SettingsTab[];

/**
 * The fallback tab. MUST stay visible to every role — an unknown or forbidden
 * tab id redirects here, so a role-gated default would loop.
 */
export const DEFAULT_SETTINGS_TAB = 'members';

/**
 * Resolve a `$tab` route param, which is an arbitrary string. `undefined` means
 * "no such tab" — this runtime check is the authority, not the param's type.
 */
export function findSettingsTab(id: string): SettingsTab | undefined {
  return SETTINGS_TABS.find((tab) => tab.id === id);
}
