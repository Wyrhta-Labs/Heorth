/**
 * Canonical feed-key convention for `integration_sync_state.feedKey`.
 *
 * A feed key uniquely identifies one incremental-sync stream. Every key starts
 * with its provider, which is what stops an M365 feed and a Google feed for the
 * same member from colliding on the table's unique(feed_key).
 *
 *  - `<provider>:calendar:member:<memberId>`             — a member's default calendar
 *  - `<provider>:calendar:member:<memberId>:<calendarId>` — one named calendar
 *  - `<provider>:calendar:family`                        — the shared household feed
 *  - `<provider>:todo:member:<memberId>:<listId>`        — one task list
 *
 * Keys are OPAQUE: build them here, compare them whole, never parse them back
 * apart. The provider segment exists for uniqueness, not for reading.
 */
export const feedKeys = {
  calendarMember: (provider: string, memberId: string): string =>
    `${provider}:calendar:member:${memberId}`,
  calendarList: (provider: string, memberId: string, calendarId: string): string =>
    `${provider}:calendar:member:${memberId}:${calendarId}`,
  calendarFamily: (provider: string): string => `${provider}:calendar:family`,
  todoMember: (provider: string, memberId: string, listId: string): string =>
    `${provider}:todo:member:${memberId}:${listId}`,
} as const;
