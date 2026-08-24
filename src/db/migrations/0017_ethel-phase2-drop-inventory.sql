ALTER TABLE "inventory_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- NOTE (Task 1, hand-fixed): drizzle-kit emitted this DROP TABLE ... CASCADE
-- *and* two explicit `ALTER TABLE ... DROP CONSTRAINT` statements for the FKs
-- that reference inventory_items.id (feoh_item_costs.item_id,
-- recurring_bills.inventory_item_id). CASCADE already drops those FKs as a
-- side effect, so the explicit drops that followed failed with
-- "constraint ... does not exist" (42704) on a real run. Removed as
-- redundant; nothing else in this file was touched. Not a snapshot edit —
-- meta/*_snapshot.json is untouched and still matches this schema.
DROP TABLE "inventory_items" CASCADE;--> statement-breakpoint
DROP INDEX "item_cost_tx_item_unique";--> statement-breakpoint
DROP INDEX "item_cost_item_id_idx";--> statement-breakpoint
ALTER TABLE "feoh_item_costs" DROP COLUMN "item_id";--> statement-breakpoint
ALTER TABLE "recurring_bills" DROP COLUMN "inventory_item_id";