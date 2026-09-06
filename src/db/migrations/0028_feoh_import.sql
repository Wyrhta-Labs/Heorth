CREATE TABLE "feoh_import_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_account_id" text NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feoh_import_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pattern" text NOT NULL,
	"envelope_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "feoh_import_rules_pattern_check" CHECK (length("feoh_import_rules"."pattern") > 0)
);
--> statement-breakpoint
CREATE TABLE "feoh_import_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"feed_key" text NOT NULL,
	"cursor" text,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feoh_imported_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_id" text NOT NULL,
	"source_account_id" text NOT NULL,
	"date" date NOT NULL,
	"payee" text NOT NULL,
	"memo" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"envelope_id" uuid,
	"transaction_id" uuid,
	"applied_rule_id" uuid,
	CONSTRAINT "feoh_imported_transactions_amount_check" CHECK ("feoh_imported_transactions"."amount" > 0),
	CONSTRAINT "feoh_imported_transactions_direction_check" CHECK ("feoh_imported_transactions"."direction" IN ('in', 'out')),
	CONSTRAINT "feoh_imported_transactions_status_check" CHECK ("feoh_imported_transactions"."status" IN ('pending', 'booked', 'dismissed')),
	CONSTRAINT "feoh_imported_transactions_booked_pair_check" CHECK (("feoh_imported_transactions"."status" = 'booked') = ("feoh_imported_transactions"."transaction_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "feoh_import_accounts" ADD CONSTRAINT "feoh_import_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feoh_import_rules" ADD CONSTRAINT "feoh_import_rules_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feoh_import_rules" ADD CONSTRAINT "feoh_import_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feoh_imported_transactions" ADD CONSTRAINT "feoh_imported_transactions_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feoh_imported_transactions" ADD CONSTRAINT "feoh_imported_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feoh_imported_transactions" ADD CONSTRAINT "feoh_imported_transactions_applied_rule_id_feoh_import_rules_id_fk" FOREIGN KEY ("applied_rule_id") REFERENCES "public"."feoh_import_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feoh_import_accounts_source_unique" ON "feoh_import_accounts" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "feoh_import_rules_created_by_idx" ON "feoh_import_rules" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "feoh_import_rules_envelope_idx" ON "feoh_import_rules" USING btree ("envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feoh_import_state_feed_key_unique" ON "feoh_import_state" USING btree ("feed_key");--> statement-breakpoint
CREATE UNIQUE INDEX "feoh_imported_transactions_source_unique" ON "feoh_imported_transactions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "feoh_imported_transactions_status_idx" ON "feoh_imported_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feoh_imported_transactions_transaction_idx" ON "feoh_imported_transactions" USING btree ("transaction_id");