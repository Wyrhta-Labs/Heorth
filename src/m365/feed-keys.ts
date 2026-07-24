/**
 * Canonical feed-key convention for `m365_sync_state.feedKey`.
 *
 * A feed key uniquely identifies one incremental-sync stream. Tasks 2.2/2.3 MUST
 * build keys through these helpers so the format stays stable across the codebase.
 *
 *  - `calendar:member:<memberId>`      — a member's own delegated calendar.
 *  - `calendar:family`                 — the shared family mailbox (app-only).
 *  - `todo:member:<memberId>:<listId>` — one Microsoft To Do list for a member.
 */
export const feedKeys = {
  calendarMember: (memberId: string): string => `calendar:member:${memberId}`,
  calendarFamily: (): string => 'calendar:family',
  todoMember: (memberId: string, listId: string): string => `todo:member:${memberId}:${listId}`,
} as const;
