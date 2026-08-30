ALTER TABLE "todo_list_allowlist" DROP CONSTRAINT "todo_allowlist_member_list_unique";--> statement-breakpoint
ALTER TABLE "todo_list_allowlist" ADD COLUMN "provider" text DEFAULT 'm365' NOT NULL;--> statement-breakpoint
ALTER TABLE "todo_list_allowlist" ADD CONSTRAINT "todo_allowlist_provider_member_list_unique" UNIQUE("provider","member_id","list_id");