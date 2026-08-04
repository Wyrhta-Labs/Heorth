import type { AvatarColor, MealSlot, Role } from './types';

/**
 * The maintenance admin's fixed handle — mirrors `MAINTENANCE_ADMIN_HANDLE` in
 * `src/household/maintenance-admin.ts`. The quarantine is anchored on this
 * handle, NOT on `role`: a real household member can be promoted to admin
 * (`PATCH /members/:id/role`) and remains an ordinary, non-quarantined member.
 * UI code that needs to distinguish the maintenance login from a real member
 * (even one with role 'admin') must filter on `handle`, never on `role`.
 */
export const MAINTENANCE_ADMIN_HANDLE = 'admin';

export const QUERY_KEYS = {
  household: ['household'] as const,
  // Deliberately not nested under `household`: saving the household invalidates
  // that key by prefix, and the option lists are static config.
  householdOptions: ['householdOptions'] as const,
  members: ['members'] as const,
  whoami: ['whoami'] as const,
  apiKeys: ['apiKeys'] as const,
  events: ['events'] as const,
  recipes: ['recipes'] as const,
  mealPlan: ['mealPlan'] as const,
  shoppingList: ['shoppingList'] as const,
  accounts: ['accounts'] as const,
  envelopes: ['envelopes'] as const,
  transactions: ['transactions'] as const,
  bills: ['bills'] as const,
  summary: (month: string) => ['summary', month] as const,
  libraryConnections: ['library', 'connections'] as const,
  libraryItems: ['library', 'items'] as const,
  tasks: ['tasks'] as const,
  taskLists: ['tasks', 'lists'] as const,
  taskAllowlist: ['tasks', 'allowlist'] as const,
  m365Status: ['m365', 'status'] as const,
} as const;

/** Member avatar palette (ember / taupe / sage / sky) — hex per the brand guide. */
export const MEMBER_COLORS: Record<AvatarColor, string> = {
  ember: '#b5542f',
  taupe: '#8a7c6a',
  sage: '#7a8b6f',
  sky: '#6b7e8c',
};
/** `labelKey`s are literal `options.*` catalog keys — see `src/i18n/locales/en.json`. */
export const AVATAR_COLOR_OPTIONS = [
  { value: 'ember', labelKey: 'options.avatarColor.ember' },
  { value: 'taupe', labelKey: 'options.avatarColor.taupe' },
  { value: 'sage', labelKey: 'options.avatarColor.sage' },
  { value: 'sky', labelKey: 'options.avatarColor.sky' },
] as const satisfies { value: AvatarColor; labelKey: string }[];

/** Feoh envelope tone -> progress-bar hue (primary/amber/sage/ink from the mockup). */
export const ENVELOPE_TONES: Record<string, string> = {
  primary: '#b5542f',
  ember: '#b5542f',
  amber: '#a07535',
  sage: '#7a8b6f',
  sky: '#6b7e8c',
  ink: '#2b2823',
};
export function toneColor(tone: string | null | undefined): string {
  return (tone && ENVELOPE_TONES[tone]) || ENVELOPE_TONES['primary']!;
}

export const MEAL_SLOTS = [
  { value: 'breakfast', labelKey: 'options.mealSlot.breakfast' },
  { value: 'lunch', labelKey: 'options.mealSlot.lunch' },
  { value: 'supper', labelKey: 'options.mealSlot.supper' },
] as const satisfies { value: MealSlot; labelKey: string }[];

export const ROLE_OPTIONS = [
  { value: 'admin', labelKey: 'options.role.admin' },
  { value: 'adult', labelKey: 'options.role.adult' },
  { value: 'child', labelKey: 'options.role.child' },
] as const satisfies { value: Role; labelKey: string }[];

export const RECURRENCE_OPTIONS = [
  { value: '', labelKey: 'options.recurrence.none' },
  { value: 'P1D', labelKey: 'options.recurrence.daily' },
  { value: 'P1W', labelKey: 'options.recurrence.weekly' },
  { value: 'P2W', labelKey: 'options.recurrence.biweekly' },
  { value: 'P1M', labelKey: 'options.recurrence.monthly' },
  { value: 'P1Y', labelKey: 'options.recurrence.yearly' },
] as const;
