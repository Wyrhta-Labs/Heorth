CREATE TABLE "task_mirror" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"feed_key" text NOT NULL,
	"external_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"list_id" text NOT NULL,
	"list_name" text,
	"title" text NOT NULL,
	"notes" text,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "task_mirror_feed_ext_unique" UNIQUE("feed_key","external_id")
);
--> statement-breakpoint
CREATE TABLE "todo_list_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"member_id" uuid NOT NULL,
	"list_id" text NOT NULL,
	"list_name" text,
	CONSTRAINT "todo_allowlist_member_list_unique" UNIQUE("member_id","list_id")
);
--> statement-breakpoint
ALTER TABLE "task_mirror" ADD CONSTRAINT "task_mirror_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_list_allowlist" ADD CONSTRAINT "todo_list_allowlist_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_mirror_feed_idx" ON "task_mirror" USING btree ("feed_key");--> statement-breakpoint
CREATE INDEX "task_mirror_member_idx" ON "task_mirror" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "task_mirror_status_idx" ON "task_mirror" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_mirror_due_idx" ON "task_mirror" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "todo_allowlist_member_idx" ON "todo_list_allowlist" USING btree ("member_id");