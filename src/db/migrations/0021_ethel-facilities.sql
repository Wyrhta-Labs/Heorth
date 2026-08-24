CREATE TABLE "ethel_facilities" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"commissioned_on" date,
	"service_interval_months" integer,
	CONSTRAINT "ethel_facilities_kind_check" CHECK ("ethel_facilities"."kind" IN ('heating', 'water', 'electrical', 'solar', 'sewage', 'ventilation', 'network', 'other')),
	CONSTRAINT "ethel_facilities_interval_check" CHECK ("ethel_facilities"."service_interval_months" IS NULL OR "ethel_facilities"."service_interval_months" > 0)
);
--> statement-breakpoint
CREATE TABLE "ethel_facility_places" (
	"facility_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	CONSTRAINT "ethel_facility_places_facility_id_place_id_pk" PRIMARY KEY("facility_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "ethel_facilities" ADD CONSTRAINT "ethel_facilities_asset_id_ethel_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."ethel_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ethel_facility_places" ADD CONSTRAINT "ethel_facility_places_facility_id_ethel_facilities_asset_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."ethel_facilities"("asset_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ethel_facility_places" ADD CONSTRAINT "ethel_facility_places_place_id_ethel_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."ethel_places"("id") ON DELETE cascade ON UPDATE no action;