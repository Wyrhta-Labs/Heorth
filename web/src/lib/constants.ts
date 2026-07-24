import type { AvatarColor, MealSlot } from './types';

export const QUERY_KEYS = {
  household: ['household'] as const,
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
} as const;

/** Member avatar palette (ember / taupe / sage / sky) — hex per the brand guide. */
export const MEMBER_COLORS: Record<AvatarColor, string> = {
  ember: '#b5542f',
  taupe: '#8a7c6a',
  sage: '#7a8b6f',
  sky: '#6b7e8c',
};
export const AVATAR_COLOR_OPTIONS: { value: AvatarColor; label: string }[] = [
  { value: 'ember', label: 'Ember' },
  { value: 'taupe', label: 'Taupe' },
  { value: 'sage', label: 'Sage' },
  { value: 'sky', label: 'Sky' },
];

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

export const MEAL_SLOTS: { value: MealSlot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'supper', label: 'Supper' },
];

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'adult', label: 'Adult' },
  { value: 'child', label: 'Child' },
] as const;

export const RECURRENCE_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'P1D', label: 'Daily' },
  { value: 'P1W', label: 'Weekly' },
  { value: 'P2W', label: 'Every 2 weeks' },
  { value: 'P1M', label: 'Monthly' },
  { value: 'P1Y', label: 'Yearly' },
] as const;
