CREATE TABLE "ethel_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"notes" text,
	CONSTRAINT "ethel_places_kind_check" CHECK ("ethel_places"."kind" IN ('building', 'floor', 'room', 'outdoor', 'storage')),
	CONSTRAINT "ethel_places_self_parent_check" CHECK ("ethel_places"."id" <> "ethel_places"."parent_id")
);
--> statement-breakpoint
ALTER TABLE "ethel_places" ADD CONSTRAINT "ethel_places_parent_id_ethel_places_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ethel_places"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Sibling names are unique, case-insensitively. NULLS NOT DISTINCT so the rule
-- also holds for ROOTS, where parent_id is NULL - without it, unlimited
-- duplicate roots pass, because every NULL is distinct from every other.
-- Not expressible in the drizzle schema (see the note in schema.ts).
CREATE UNIQUE INDEX ethel_places_parent_name_unique
  ON ethel_places (parent_id, lower(name)) NULLS NOT DISTINCT;
