CREATE TABLE "feoh_item_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "item_cost_kind_check" CHECK ("feoh_item_costs"."kind" IN ('purchase', 'disposal', 'repair', 'maintenance', 'accessory'))
);
--> statement-breakpoint
CREATE TABLE "recurring_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bill_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"transaction_id" uuid,
	"skipped" boolean DEFAULT false NOT NULL,
	"override_amount" numeric(14, 2),
	CONSTRAINT "occurrence_paid_xor_skipped" CHECK (NOT ("recurring_occurrences"."transaction_id" IS NOT NULL AND "recurring_occurrences"."skipped"))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"location" text,
	"notes" text,
	"warranty_until" date,
	"purchase_price" numeric(14, 2),
	"purchase_date" date,
	"decommissioned_at" date,
	"decommission_reason" text,
	"disposal_proceeds" numeric(14, 2),
	CONSTRAINT "inventory_reason_check" CHECK ("inventory_items"."decommission_reason" IS NULL OR "inventory_items"."decommission_reason" IN ('broken', 'sold', 'given_away', 'worn_out', 'lost', 'other')),
	CONSTRAINT "inventory_decommission_pair_check" CHECK (("inventory_items"."decommissioned_at" IS NULL) = ("inventory_items"."decommission_reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "recurring_bills" ADD COLUMN "inventory_item_id" uuid;--> statement-breakpoint
ALTER TABLE "feoh_item_costs" ADD CONSTRAINT "feoh_item_costs_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feoh_item_costs" ADD CONSTRAINT "feoh_item_costs_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_bill_id_recurring_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."recurring_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_cost_tx_item_unique" ON "feoh_item_costs" USING btree ("transaction_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_cost_capital_unique" ON "feoh_item_costs" USING btree ("item_id","kind") WHERE "feoh_item_costs"."kind" IN ('purchase', 'disposal');--> statement-breakpoint
CREATE INDEX "item_cost_item_id_idx" ON "feoh_item_costs" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrence_bill_due_unique" ON "recurring_occurrences" USING btree ("bill_id","due_date");--> statement-breakpoint
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'weekly'     WHERE lower(trim("cadence")) IN ('p1w', 'weekly', 'wöchentlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'monthly'    WHERE lower(trim("cadence")) IN ('p1m', 'monthly', 'monatlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'quarterly'  WHERE lower(trim("cadence")) IN ('p3m', 'quarterly', 'quartalsweise', 'vierteljährlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'semiannual' WHERE lower(trim("cadence")) IN ('p6m', 'semiannual', 'semi-annual', 'halbjährlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'yearly'     WHERE lower(trim("cadence")) IN ('p1y', 'yearly', 'annual', 'jährlich');