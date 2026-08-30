ALTER TABLE "todo_list_allowlist" ADD COLUMN "is_household" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "todo_allowlist_single_household" ON "todo_list_allowlist" USING btree ("is_household") WHERE "todo_list_allowlist"."is_household";--> statement-breakpoint

-- Backfill the household designation.
--
-- The pre-flag deployment picked its household list by matching a display name
-- from M365_SHARED_TODO_LIST. That value is a deployment secret and is not
-- available here, and hand-editing a committed migration to inject it is exactly
-- the kind of step that gets forgotten -- silently flagging nothing and stopping
-- Weorc's projection with no signal.
--
-- Instead: when the household has allowlisted exactly ONE list, that list IS the
-- household list -- there is nothing else it could be. When two or more exist the
-- choice is genuinely ambiguous, so flag nothing and let an adult designate one
-- through PUT /api/v1/tasks/household-list. `getHouseholdList()` returning null
-- surfaces that state today; a follow-up task is expected to add a boot-time
-- warning so it is visible without an adult having to check.
--
-- OPERATOR NOTE: a household with SEVERAL allowlisted lists gets nothing flagged
-- by this statement and must designate one explicitly after upgrading.
UPDATE todo_list_allowlist
   SET is_household = true
 WHERE (SELECT count(*) FROM todo_list_allowlist) = 1;