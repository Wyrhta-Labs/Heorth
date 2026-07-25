-- Custom SQL migration file, put your code below! --

-- One-time force of a full re-sync for every calendar mirror feed.
-- Pre-fix mirrored rows can carry "series_master_id" = NULL (untitled sparse
-- occurrences, historic master rows), and rows lost to the old deletions
-- cascade would otherwise only heal on the 7-day periodic full resync.
-- Nulling the delta token makes the next sync tick take the fresh-full-window
-- path (null token => full snapshot, see src/m365/sync-runner.ts +
-- src/m365/calendar-provider.ts), which REPLACES each feed's mirror contents;
-- nulling "last_full_sync_at" also marks the feed as full-resync-due.
-- To Do feeds ("todo:...") are untouched.
UPDATE "m365_sync_state"
SET "delta_token" = NULL,
    "last_full_sync_at" = NULL
WHERE "feed_key" LIKE 'calendar:%';
