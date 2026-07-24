CREATE TABLE "m365_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"member_id" uuid NOT NULL,
	"account_upn" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_refresh_success_at" timestamp with time zone,
	"last_refresh_error" text,
	CONSTRAINT "m365_conn_member_unique" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "m365_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"feed_key" text NOT NULL,
	"delta_token" text,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "m365_sync_feed_unique" UNIQUE("feed_key")
);
--> statement-breakpoint
ALTER TABLE "m365_connections" ADD CONSTRAINT "m365_connections_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "m365_conn_member_idx" ON "m365_connections" USING btree ("member_id");