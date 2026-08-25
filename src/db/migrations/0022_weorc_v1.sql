CREATE TABLE "weorc_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routine_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_member_id" uuid,
	"note" text,
	"task_feed_key" text,
	"task_external_id" text,
	"projection_error" text,
	CONSTRAINT "weorc_occurrences_routine_due_unique" UNIQUE("routine_id","due_on"),
	CONSTRAINT "weorc_occurrences_status_check" CHECK ("weorc_occurrences"."status" IN ('due', 'completed', 'skipped')),
	CONSTRAINT "weorc_occurrences_completed_pair_check" CHECK (("weorc_occurrences"."status" = 'completed') = ("weorc_occurrences"."completed_at" IS NOT NULL)),
	CONSTRAINT "weorc_occurrences_task_pair_check" CHECK (("weorc_occurrences"."task_feed_key" IS NULL) = ("weorc_occurrences"."task_external_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "weorc_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"mode" text NOT NULL,
	"interval_unit" text NOT NULL,
	"interval_count" integer NOT NULL,
	"anchor_date" date NOT NULL,
	"lead_days" integer DEFAULT 0 NOT NULL,
	"owner_member_id" uuid,
	"anchor_asset_id" uuid,
	"anchor_place_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "weorc_routines_mode_check" CHECK ("weorc_routines"."mode" IN ('from_completion', 'fixed')),
	CONSTRAINT "weorc_routines_unit_check" CHECK ("weorc_routines"."interval_unit" IN ('day', 'week', 'month')),
	CONSTRAINT "weorc_routines_count_check" CHECK ("weorc_routines"."interval_count" > 0),
	CONSTRAINT "weorc_routines_lead_check" CHECK ("weorc_routines"."lead_days" >= 0),
	CONSTRAINT "weorc_routines_anchor_check" CHECK ("weorc_routines"."anchor_asset_id" IS NULL OR "weorc_routines"."anchor_place_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "weorc_occurrences" ADD CONSTRAINT "weorc_occurrences_routine_id_weorc_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."weorc_routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weorc_occurrences" ADD CONSTRAINT "weorc_occurrences_completed_by_member_id_users_id_fk" FOREIGN KEY ("completed_by_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weorc_routines" ADD CONSTRAINT "weorc_routines_owner_member_id_users_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weorc_routines" ADD CONSTRAINT "weorc_routines_anchor_asset_id_ethel_assets_id_fk" FOREIGN KEY ("anchor_asset_id") REFERENCES "public"."ethel_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weorc_routines" ADD CONSTRAINT "weorc_routines_anchor_place_id_ethel_places_id_fk" FOREIGN KEY ("anchor_place_id") REFERENCES "public"."ethel_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weorc_occurrences_one_open_idx" ON "weorc_occurrences" USING btree ("routine_id") WHERE "weorc_occurrences"."status" = 'due';--> statement-breakpoint
CREATE INDEX "weorc_occurrences_status_due_idx" ON "weorc_occurrences" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "weorc_routines_active_idx" ON "weorc_routines" USING btree ("active");--> statement-breakpoint
CREATE INDEX "weorc_routines_anchor_asset_idx" ON "weorc_routines" USING btree ("anchor_asset_id");--> statement-breakpoint
CREATE INDEX "weorc_routines_anchor_place_idx" ON "weorc_routines" USING btree ("anchor_place_id");