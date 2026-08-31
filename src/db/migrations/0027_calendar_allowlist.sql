CREATE TABLE "calendar_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"member_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_name" text,
	"is_household" boolean DEFAULT false NOT NULL,
	CONSTRAINT "calendar_allowlist_provider_member_cal_unique" UNIQUE("provider","member_id","calendar_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_allowlist" ADD CONSTRAINT "calendar_allowlist_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_allowlist_member_idx" ON "calendar_allowlist" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_allowlist_single_household" ON "calendar_allowlist" USING btree ("is_household") WHERE "calendar_allowlist"."is_household";