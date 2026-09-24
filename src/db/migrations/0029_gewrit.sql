CREATE TABLE "gewrit_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"document_type" text,
	"correspondent" text,
	"created_on" date,
	"status" text DEFAULT 'available' NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gewrit_documents_source_external_unique" UNIQUE("source","external_id"),
	CONSTRAINT "gewrit_documents_source_check" CHECK ("gewrit_documents"."source" IN ('paperless', 'fake')),
	CONSTRAINT "gewrit_documents_status_check" CHECK ("gewrit_documents"."status" IN ('available', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "gewrit_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document_id" uuid NOT NULL,
	"asset_id" uuid,
	"place_id" uuid,
	"role" text NOT NULL,
	"note" text,
	CONSTRAINT "gewrit_links_unique" UNIQUE NULLS NOT DISTINCT("document_id","asset_id","place_id","role"),
	CONSTRAINT "gewrit_links_element_check" CHECK (("gewrit_links"."asset_id" IS NULL) <> ("gewrit_links"."place_id" IS NULL)),
	CONSTRAINT "gewrit_links_role_check" CHECK ("gewrit_links"."role" IN ('manual', 'warranty', 'invoice', 'contract', 'certificate', 'other')),
	CONSTRAINT "gewrit_links_note_check" CHECK ("gewrit_links"."note" IS NULL OR char_length("gewrit_links"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "gewrit_links" ADD CONSTRAINT "gewrit_links_document_id_gewrit_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."gewrit_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gewrit_links" ADD CONSTRAINT "gewrit_links_asset_id_ethel_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."ethel_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gewrit_links" ADD CONSTRAINT "gewrit_links_place_id_ethel_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."ethel_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gewrit_links_document_idx" ON "gewrit_links" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "gewrit_links_asset_idx" ON "gewrit_links" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "gewrit_links_place_idx" ON "gewrit_links" USING btree ("place_id");