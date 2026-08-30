ALTER TABLE "m365_connections" RENAME TO "integration_connections";
ALTER TABLE "integration_connections" RENAME COLUMN "account_upn" TO "account_label";
ALTER TABLE "integration_connections" ADD COLUMN "provider" text DEFAULT 'm365' NOT NULL;
ALTER TABLE "integration_connections" DROP CONSTRAINT "m365_conn_member_unique";
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_conn_provider_member_unique" UNIQUE("provider","member_id");
ALTER INDEX "m365_conn_member_idx" RENAME TO "integration_conn_member_idx";
--> statement-breakpoint
-- ALTER TABLE ... RENAME TO renames the table but leaves every constraint name
-- untouched. Rename them explicitly so the database matches the drizzle
-- snapshot (0023_snapshot.json), which records the post-rename names.
ALTER TABLE "integration_connections" RENAME CONSTRAINT "m365_connections_member_id_users_id_fk" TO "integration_connections_member_id_users_id_fk";
ALTER TABLE "integration_connections" RENAME CONSTRAINT "m365_connections_pkey" TO "integration_connections_pkey";

ALTER TABLE "m365_sync_state" RENAME TO "integration_sync_state";
ALTER TABLE "integration_sync_state" RENAME COLUMN "delta_token" TO "sync_token";
ALTER TABLE "integration_sync_state" DROP CONSTRAINT "m365_sync_feed_unique";
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_feed_unique" UNIQUE("feed_key");
--> statement-breakpoint
ALTER TABLE "integration_sync_state" RENAME CONSTRAINT "m365_sync_state_pkey" TO "integration_sync_state_pkey";
