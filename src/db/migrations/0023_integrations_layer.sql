ALTER TABLE "m365_connections" RENAME TO "integration_connections";
ALTER TABLE "integration_connections" RENAME COLUMN "account_upn" TO "account_label";
ALTER TABLE "integration_connections" ADD COLUMN "provider" text DEFAULT 'm365' NOT NULL;
ALTER TABLE "integration_connections" DROP CONSTRAINT "m365_conn_member_unique";
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_conn_provider_member_unique" UNIQUE("provider","member_id");
ALTER INDEX "m365_conn_member_idx" RENAME TO "integration_conn_member_idx";

ALTER TABLE "m365_sync_state" RENAME TO "integration_sync_state";
ALTER TABLE "integration_sync_state" RENAME COLUMN "delta_token" TO "sync_token";
ALTER TABLE "integration_sync_state" DROP CONSTRAINT "m365_sync_feed_unique";
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_feed_unique" UNIQUE("feed_key");
