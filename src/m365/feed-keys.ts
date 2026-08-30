import { feedKeys as generic } from '../integrations/feed-keys.js';

/**
 * TEMPORARY SHIM — the convention moved to `src/integrations/feed-keys.ts` and
 * gained a provider argument. This binds `'m365'` so existing call sites compile
 * unchanged. Deleted in the task that rewires `src/m365/`.
 */
export const feedKeys = {
  calendarMember: (memberId: string): string => generic.calendarMember('m365', memberId),
  calendarFamily: (): string => generic.calendarFamily('m365'),
  todoMember: (memberId: string, listId: string): string =>
    generic.todoMember('m365', memberId, listId),
} as const;
