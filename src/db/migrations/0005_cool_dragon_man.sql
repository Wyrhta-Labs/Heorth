CREATE TABLE "library_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"external_ref" text NOT NULL,
	"credentials" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "library_conn_unique" UNIQUE("provider","external_ref","member_id")
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"sort_title" text NOT NULL,
	"creators" text[] DEFAULT '{}' NOT NULL,
	"year" integer,
	"cover_url" text,
	"status" text,
	"lists" text[] DEFAULT '{}' NOT NULL,
	"rating" numeric,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source_url" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "library_item_unique" UNIQUE("connection_id","media_type","external_id")
);
--> statement-breakpoint
ALTER TABLE "library_connections" ADD CONSTRAINT "library_connections_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_connection_id_library_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."library_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_conn_member_idx" ON "library_connections" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "library_item_conn_idx" ON "library_items" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "library_item_media_idx" ON "library_items" USING btree ("media_type");