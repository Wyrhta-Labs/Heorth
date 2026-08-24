CREATE TABLE "ethel_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"location_note" text,
	"notes" text,
	"warranty_until" date,
	"purchase_price" numeric(14, 2),
	"purchase_date" date,
	"decommissioned_at" date,
	"decommission_reason" text,
	"disposal_proceeds" numeric(14, 2),
	CONSTRAINT "ethel_assets_reason_check" CHECK ("ethel_assets"."decommission_reason" IS NULL OR "ethel_assets"."decommission_reason" IN ('broken', 'sold', 'given_away', 'worn_out', 'lost', 'other')),
	CONSTRAINT "ethel_assets_decommission_pair_check" CHECK (("ethel_assets"."decommissioned_at" IS NULL) = ("ethel_assets"."decommission_reason" IS NULL))
);
--> statement-breakpoint
DROP INDEX "item_cost_capital_unique";--> statement-breakpoint
ALTER TABLE "feoh_item_costs" ADD COLUMN "asset_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_bills" ADD COLUMN "ethel_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "feoh_item_costs" ADD CONSTRAINT "feoh_item_costs_asset_id_ethel_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."ethel_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_ethel_asset_id_ethel_assets_id_fk" FOREIGN KEY ("ethel_asset_id") REFERENCES "public"."ethel_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_cost_tx_asset_unique" ON "feoh_item_costs" USING btree ("transaction_id","asset_id");--> statement-breakpoint
CREATE INDEX "item_cost_asset_id_idx" ON "feoh_item_costs" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_cost_capital_unique" ON "feoh_item_costs" USING btree ("asset_id","kind") WHERE "feoh_item_costs"."kind" IN ('purchase', 'disposal');