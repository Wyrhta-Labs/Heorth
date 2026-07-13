CREATE INDEX "expense_splits_transaction_id_idx" ON "expense_splits" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "expense_splits_member_id_idx" ON "expense_splits" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "postings_transaction_id_idx" ON "postings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "postings_account_id_idx" ON "postings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "postings_envelope_id_idx" ON "postings" USING btree ("envelope_id");--> statement-breakpoint
CREATE INDEX "recurring_bills_envelope_id_idx" ON "recurring_bills" USING btree ("envelope_id");--> statement-breakpoint
CREATE INDEX "transactions_created_by_idx" ON "transactions" USING btree ("created_by");