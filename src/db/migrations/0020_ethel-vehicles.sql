CREATE TABLE "ethel_vehicles" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registration" text,
	"vin" text,
	"first_registered_on" date,
	"odometer" integer,
	"odometer_read_at" date,
	"service_interval_months" integer,
	CONSTRAINT "ethel_vehicles_odometer_check" CHECK ("ethel_vehicles"."odometer" IS NULL OR "ethel_vehicles"."odometer" >= 0),
	CONSTRAINT "ethel_vehicles_odometer_pair_check" CHECK (("ethel_vehicles"."odometer" IS NULL) = ("ethel_vehicles"."odometer_read_at" IS NULL)),
	CONSTRAINT "ethel_vehicles_interval_check" CHECK ("ethel_vehicles"."service_interval_months" IS NULL OR "ethel_vehicles"."service_interval_months" > 0)
);
--> statement-breakpoint
ALTER TABLE "ethel_vehicles" ADD CONSTRAINT "ethel_vehicles_asset_id_ethel_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."ethel_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ethel_vehicles_registration_unique" ON "ethel_vehicles" USING btree ("registration") WHERE "ethel_vehicles"."registration" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ethel_vehicles_vin_unique" ON "ethel_vehicles" USING btree ("vin") WHERE "ethel_vehicles"."vin" IS NOT NULL;