CREATE TABLE "calendar_mirror_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"feed_key" text NOT NULL,
	"external_id" text NOT NULL,
	"member_id" uuid,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"organizer" text,
	"source_time_zone" text,
	CONSTRAINT "calendar_mirror_feed_ext_unique" UNIQUE("feed_key","external_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_mirror_events" ADD CONSTRAINT "calendar_mirror_events_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_mirror_feed_idx" ON "calendar_mirror_events" USING btree ("feed_key");--> statement-breakpoint
CREATE INDEX "calendar_mirror_member_idx" ON "calendar_mirror_events" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "calendar_mirror_start_idx" ON "calendar_mirror_events" USING btree ("start_at");