-- Feed keys gained a provider segment so an M365 feed and a Google feed for the
-- same member cannot collide on unique(feed_key). Existing rows predate the
-- convention and are all Microsoft.
--
-- Four tables persist a feed key, not one: integration_sync_state (the sync
-- cursor), task_mirror and calendar_mirror_events (the mirrored rows
-- themselves, keyed unique on (feed_key, external_id)), and
-- weorc_occurrences.task_feed_key (how a routine finds its projected task).
-- Migrating only integration_sync_state leaves the other three holding
-- unprefixed keys: new syncs write prefixed rows beside the old unprefixed
-- ones for the same events (duplicate mirror rows), task completion no
-- longer matches the provider's feed-key pattern and throws, and a Weorc
-- projection link never matches its re-synced task again.
--
-- Guarded by the LIKE so each statement is idempotent: an already-prefixed
-- key starts with 'm365:' and matches neither pattern.
UPDATE integration_sync_state
   SET feed_key = 'm365:' || feed_key
 WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%';

UPDATE task_mirror
   SET feed_key = 'm365:' || feed_key
 WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%';

UPDATE calendar_mirror_events
   SET feed_key = 'm365:' || feed_key
 WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%';

-- task_feed_key is nullable, unlike the other three columns above.
UPDATE weorc_occurrences
   SET task_feed_key = 'm365:' || task_feed_key
 WHERE task_feed_key IS NOT NULL
   AND (task_feed_key LIKE 'calendar:%' OR task_feed_key LIKE 'todo:%');
