ALTER TABLE "todo_list_allowlist" ADD COLUMN "is_household" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "todo_allowlist_single_household" ON "todo_list_allowlist" USING btree ("is_household") WHERE "todo_list_allowlist"."is_household";--> statement-breakpoint

-- No backfill, deliberately.
--
-- The pre-flag deployment picked its household list by matching a display name from
-- M365_SHARED_TODO_LIST. That value is a deployment secret and is not available to a migration,
-- and every way of inferring the list from what IS available is unsafe:
--   * hand-substituting the name into this file means editing a committed migration, which gets
--     forgotten -- and then nothing is flagged, silently;
--   * flagging the sole allowlisted row when there is exactly one guesses. If that one row is a
--     member's personal list, household tasks would be written into it with no error at all.
--
-- So this migration designates nothing, and the household designation starts empty. An adult picks
-- the list once, explicitly, through PUT /api/v1/tasks/household-list. Until they do,
-- createHouseholdTask reports shared_list_unavailable and Weorc's projection is paused -- a visible,
-- correctable state, which is the entire point of replacing name-matching with an explicit flag.
--
-- OPERATOR STEP AFTER UPGRADING: designate the household task list. Nothing projects until you do.
