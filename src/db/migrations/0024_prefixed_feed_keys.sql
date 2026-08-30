-- Feed keys gained a provider segment so an M365 feed and a Google feed for the
-- same member cannot collide on unique(feed_key). Existing rows predate the
-- convention and are all Microsoft.
--
-- Guarded by the LIKE so the statement is idempotent: an already-prefixed key
-- starts with 'm365:' and matches neither pattern.
UPDATE integration_sync_state
   SET feed_key = 'm365:' || feed_key
 WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%';
