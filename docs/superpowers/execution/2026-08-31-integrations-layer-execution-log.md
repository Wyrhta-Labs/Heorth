# SDD ledger — plan: docs/superpowers/plans/2026-08-30-integrations-layer-extraction.md

Spec: docs/superpowers/specs/2026-08-29-google-calendar-tasks-provider-design.md (read, reachable)
Repo: Heorth (own git repo, sibling of the Wyrhta meta repo)
Branch: features/connect-google (not main — plan execution is allowed here)
Worktree: none — this session is configured to work in place.
Reviews: Codex CLI (`codex exec -s read-only`) via `.superpowers/sdd/<plan>/codex-review.sh`,
         at the user's explicit request, in place of a Claude review subagent.

## Environment baseline (2026-08-30, before Task 1)

- typecheck: clean
- full suite: 67 files / 501 tests passed, ~105s
- DATABASE_URL: NOT the documented default. `postgres://heorth:changeme@...` fails with
  `28P01 password authentication failed`. The working value derives the password from
  `deploy/.env`'s HEORTH_DB_PASSWORD (a git-ignored secret — never paste it):
      export DATABASE_URL="postgres://heorth:$(grep -E '^HEORTH_DB_PASSWORD=' ../deploy/.env | cut -d= -f2- | tr -d '"'\''\r')@localhost:15432/heorth_test"
  Every implementer dispatch carries this derivation, not the secret.
- codex CLI: present, logged in via ChatGPT, `codex exec -s read-only` verified (8s round trip).
  `codex review --commit` was rejected as the mechanism: it refuses a custom PROMPT, so the
  reviewer could not be given the task brief or the spec.

## Pre-flight conflict scan

### Cross-task rows (tasks sharing a file or an interface)

| Tasks | Produces → consumes | Finding |
|---|---|---|
| 1 → 2 | `applyTaskPull` / `applyMirrorPull`, both change fullResync to reconcile | Clean. Different files, same design, each with its own tests. |
| 1 → 11 → 12 | `src/modules/tasks/store.ts`, three sequential edits | Clean. T1 touches applyTaskPull only; T11 adds `provider` to TaskFeed; T12 adds the household helpers. T1's code reads `feed.feedKey`, so T11's added field cannot break it. |
| 3 → 4 | `integrationConnections`, `integrationSyncState`, row types | Clean. T4's IntegrationStore consumes exactly what T3's schema exports. |
| 3 → 8 | `src/m365/schema.ts` shim created, then deleted | Clean by design — the shim exists to keep the build green between them. |
| 4 → 8 | `M365Store` shim (extends IntegrationStore, maps accountUpn→accountLabel) then deleted | Clean. |
| 5 → 8 → 11 | `feedKeys` gains a provider argument; tasks/store.ts hardcodes 'm365' in T8; T11 removes it | Clean, and deliberately staged. T8 writes a `TODO(task-11)` marker; T11's step removes both the hardcode and the marker. Verified the marker text matches between the two tasks. |
| 6 → 8 | `syncOneFeed(deps, …)` signature change; call sites fixed | **Overlap:** T6 already fixes `calendar-sync.ts` / `task-sync.ts` call sites, T8 then repoints their imports. Sequential, not conflicting. |
| 6 → 7 → 9/10 | `classifyError`, `fullResyncIntervalMs` → `RegisteredProvider` → routes/scheduler | Clean. Field names match across all four tasks. |
| 7 → 11 | `getTaskProviderFor(source)` | Clean. T7 defines it, T11 is its only consumer. |
| 8 → 9 | T8 edits `src/m365/routes.ts` (accountUpn→accountLabel); T9 deletes that file | **Wasted work, not a conflict.** See Ruling 1. |
| 9 → 13 | `integrations/routes.ts` `/status`, both response branches | Clean. T13 adds one field to each branch T9 created. |
| 9 → 14 | route paths → web client | Clean, correctly ordered. |
| 10 → 12 | `src/config/env.ts`, two independent keys | Clean. T10 renames the interval key; T12 removes M365_SHARED_TODO_LIST from a different group. |
| 11 → 12 | `todo_list_allowlist` gains `provider` then `is_household`; migrations 0025 then 0026 | Clean. T12's `store.getAllowlist(memberId, provider)` matches the two-arg signature T11 introduces. |
| 12 → 13 | `getHouseholdFeed()` | Clean. T13 imports it from the store, as T12 defines it. |
| 13 → 14 | `householdListDesignated` on /status | Clean. T14's `M365Status` type adds the same field name. |
| all → 15 | docs | Clean. T15 is last and only edits AGENTS.md / README.md. |

### Per-task self-agreement rows

| Task | Own text agrees with itself? |
|---|---|
| 1 | Yes. Tests use `applyTaskPull` with the signature the step implements; `notInArray` import called out. |
| 2 | Yes. Four tests, two of them written as pre-existing-behaviour guards, matching the implementation's two channels. |
| 3 | Yes, with a hazard step: the plan tells the implementer to INSPECT the generated SQL because drizzle may emit DROP+CREATE instead of RENAME. |
| 4 | Yes. Interfaces block lists every method the code defines. |
| 5 | Yes. `calendarList` is defined and explicitly noted as unused-until-phase-2. |
| 6 | Yes. `SyncDeps` fields match every call site the task edits. |
| 7 | Yes. The fake in the test implements every `RegisteredProvider` field. |
| 8 | Yes — mechanical, compiler-driven, with an explicit "iterate until typecheck passes". |
| 9 | Yes. Test asserts the retired surface 404s, matching the "no aliases" decision. |
| 10 | Yes. Notes the `.catch().then().catch()` bug fix rather than smuggling it. |
| 11 | Yes, after the self-review fix that replaced prose bullets with actual code. |
| 12 | Yes, after the self-review fix that defined `service.getHouseholdList` / `setHouseholdList`, which the route step calls. |
| 13 | Yes. |
| 14 | Yes. |
| 15 | Yes. Includes the correction to the Weorc rule's justification, which T1 invalidates. |

### Rulings from the scan

Ruling 1: T8 edits `src/m365/routes.ts` one line before T9 deletes the file. Keep it as written —
  T8 must typecheck, and that is the cheapest way. Cost if wrong: one wasted line-edit, no
  functional risk.
Ruling 2: T2 reorders upserts before deletions on the incremental calendar path. This is
  plan-mandated with a stated justification (a tombstoned id is deleted after being written, so
  the delete still wins) AND covered by two new regression tests. If Codex flags the reordering,
  it is not automatically a defect — weigh it against those tests. Cost if wrong: a same-pull
  upsert+delete of one id could resolve the wrong way; the two guard tests are what would catch it.
Ruling 3: T11 changes `completeProjectedTask` to require a mirror row before calling the provider
  (previously it called the provider first). This is a real behaviour change inside an otherwise
  refactoring task, and it is intended: the row is what names the provider. It is consistent with
  AGENTS.md's "a missing task_mirror row is NOT an upstream deletion". Cost if wrong: a projected
  task whose mirror row vanished can no longer be completed upstream through that path.
Ruling 4: T5's migration has no schema delta, so `db:generate` will not produce it. The plan says
  hand-write `0024_prefixed_feed_keys.sql` and register it in `meta/_journal.json`. Registering a
  journal entry is the one sanctioned edit under `meta/` — AGENTS.md forbids hand-editing
  SNAPSHOTS, and a journal entry is not a snapshot. If the migrator turns out to discover files
  without a journal, skip the entry. Cost if wrong: the migration silently never runs, and prefixed
  feed keys would strand existing sync state — the task's own test is what catches it.

## Task log

### Pre-flight findings discovered while Task 1 ran

Finding A — `deploy/.env`'s `M365_REDIRECT_URI` path is still `/api/v1/m365/callback` (the OLD
  path; host redacted, never quoted). The user updated the Entra app registration by hand on
  2026-08-29, so the two halves currently disagree with each other OR the Entra value was set to
  something else again. `deploy/.env` lives in the META repo and is a git-ignored secret file.
  Ruling 5: do NOT edit it from this session — it is another repo's secret, and one change/one
  repo/one commit applies. Task 9's verification step stands; I surface this to the user at the
  end as an operator action. Cost if wrong: the M365 connect flow fails at consent with
  redirect_uri_mismatch after this branch deploys — no data risk, one-line fix.

Finding B — `src/db/migrations/meta/_journal.json` exists, 23 entries, last `{idx: 22, version: '7',
  tag: '0022_weorc_v1', breakpoints: true}`. Confirms Ruling 4's mechanism: Task 5's hand-written
  migration DOES need a journal entry, and the shape to copy is now known. Carried into the Task 5
  dispatch.

Task 1: complete (commits 051dc52..a4131e5, review clean)
  Codex: spec PASS, 0 Critical / 0 Important / 0 Minor, quality APPROVED.
  One ⚠️ "cannot verify from diff" (test runs claimed, not proven) — resolved by the controller
  running typecheck + m365-tasks-sync + weorc-projection + weorc-task-seam independently:
  3 files / 39 tests passed, typecheck clean. Not a gap.
Task 2: complete (commits a4131e5..5e12835, review clean)
  Codex: spec PASS, 0 Critical / 0 Important / 0 Minor, quality APPROVED. Explicitly confirmed the
  two preserved incremental channels (deletions cascade over seriesMasterId; masterPurges by
  externalId only) and that both are correctly skipped on the fullResync path.
  Ruling 2 (the upserts-before-deletions reorder) was NOT flagged by Codex — no adjudication needed.
  ⚠️ "cannot verify from diff" resolved by the controller: typecheck clean, calendar suites green.
Task 3: implemented, commit 5e12835..ca73e6b — BUILD RED at this boundary. Not reviewed alone.
  The migration SQL is correct: drizzle mis-generated it (misdetected the column rename as
  account_upn->provider and added a spurious NOT NULL account_label with no default), the
  implementer caught it, discarded the generated body and used the brief's explicit ALTER ...
  RENAME statements. No DROP TABLE reached the file. Journal entry idx 23 written by db:generate.
  Breakage is exactly 6 typecheck errors: 5 in src/m365/store.ts, 1 in src/m365/sync-runner.ts.

Ruling 6 — PLAN DEFECT, ruled. My plan claimed Task 3's shim keeps the build green ("Expected:
  PASS"). It cannot: the shim aliases the two TABLES, but src/m365/store.ts references a renamed
  COLUMN (accountUpn) and the changed unique constraint (onConflictDoUpdate targeting
  m365Connections.memberId, which is no longer a unique key on its own). A table alias cannot
  paper over a column rename. Task 3 is therefore not independently green, and reviewing it alone
  would spend a review seat on breakage I already know about and have already scheduled a fix for.
  DECISION: Tasks 3 and 4 form ONE green boundary and ONE Codex review over the combined range
  5e12835..<task-4 head>. Task 4's dispatch additionally carries the one-line
  `.deltaToken` -> `.syncToken` fix in src/m365/sync-runner.ts (Task 6 rewrites that file wholesale
  anyway), because without it the combined boundary is still one error short of green.
  Cost if wrong: one intermediate commit on a feature branch does not build in isolation. It is
  visible in history and would matter for a bisect landing exactly on ca73e6b. No data or
  behaviour risk.

Ruling 7 — Task 3's implementer renamed `toHaveProperty('deltaToken')` to `'syncToken'`, a string
  literal rather than a property access, and flagged that it does not literally match either
  permitted edit pattern. Accepted: it is the same column rename, and leaving it would have made
  the assertion silently vacuous (asserting a property that no longer exists). Cost if wrong: none.
Task 3+4: combined Codex review over 5e12835..ea48382 — spec FAIL, 0 Critical / 3 Important / 0 Minor,
  quality CHANGES REQUESTED. Findings adjudicated by the controller as follows:

  F1 "unrequested plan mutation (dff29f7) in the package" — PARKED, not sent to the implementer.
    Ruling 8: the commit is the CONTROLLER's, not the implementer's, and it is already a separate
    docs commit with its own message — literally the remedy Codex proposed. It appeared in the
    package only because the combined range spans it. Codex is right that editing a plan mid-flight
    moves the acceptance bar, which is why the edit is a standalone reviewable commit that says so.
    Cost if wrong: a reader of the branch sees the acceptance criteria change after the fact; the
    commit message explains why.

  F2 "required red test run was skipped" — REAL, sent to fix round 1. The red step proves a test can
    fail; skipping it leaves seven tests unproven. Remedy chosen is a mutation check (break each
    behaviour, confirm the matching test fails, revert) rather than a faked "before" run, because a
    reconstructed red run would prove nothing.

  F3 "FK name diverges from the snapshot" — REAL, CONFIRMED AND BROADER THAN REPORTED, sent to fix
    round 1. Controller queried the live test DB: Postgres ALTER TABLE ... RENAME TO leaves EVERY
    constraint name behind. Not just the FK (which Codex found) but both PRIMARY KEYS and all the
    not-null constraint names. Snapshot records integration_*; database has m365_*. A later
    migration touching the FK by its snapshot name fails on every migrated database and passes on a
    fresh one — invisible to tests. Amending 0023 (not a corrective follow-up) because it has not
    been applied to any real database yet.
Task 3+4: fix round 1/5 (2 addressed, 0 open — constraint-name drift; skipped red run; commits ea48382..0e53fee)
  Controller verified independently, not taken on the report's word:
    - src/integrations/store.ts is byte-identical to ea48382 (all four mutations reverted)
    - the fix commit touches ONLY 0023_integrations_layer.sql (+8 lines)
    - after a clean drop-and-rebuild of heorth_test, every tracked constraint reads integration_*:
      integration_conn_provider_member_unique, integration_connections_member_id_users_id_fk,
      integration_connections_pkey, integration_sync_feed_unique, integration_sync_state_pkey
    - not-null constraint names remain m365_* — correct, the snapshot does not track them
  Note: the first re-review attempt was killed by the controller's 10-minute foreground command cap,
  not by any failure. Codex reviews now run backgrounded.
Task 3+4: complete (commits 5e12835..0e53fee, review clean after 1 fix round)
  Re-review: both findings ADDRESSED, no new breakage, no out-of-scope observations.
  Codex additionally confirmed the not-null names are plain column flags in the snapshot
  ("notNull": true), not named constraints — so leaving them m365_* is correct, not an omission.
  Carries 1 parked finding (Ruling 8, the controller's plan-correction commit).

Ruling 9 — PLAN/SPEC DEFECT #2, ruled. The spec claimed feed keys "stay opaque — never
  parsed". False: src/m365/calendar-provider.ts and src/m365/task-provider.ts both regex-parse
  the key to recover ids, so the provider prefix breaks them. Task 5's implementer found this,
  fixed both regexes (outside its stated file list) and flagged it rather than expanding scope
  silently — correct behaviour, accepted.
  Controller verified by mutation: reverting task-provider.ts's regex fails 20 tests in
  m365-tasks-sync. So the implementer's "would silently fail at runtime" is too strong — the
  suite catches it hard. Recorded accurately in the spec correction (commit follows this line).
  DECISION: accept the two out-of-scope production fixes; they are required for the task to work
  at all. Accept the two weorc test-fixture edits (split(':')[2] -> [3]): positional parsing is
  not literally the permitted "add a prefix to a key literal" category, but it is the same
  mechanical consequence of the added segment, and leaving it would fail 3 tests with an
  unrelated-looking UUID error. Cost if wrong: the refactor touched 2 more production files than
  planned; both changes are one regex literal each and are covered by existing tests.
  NOT fixed here: making the M365 providers resolve feeds from their allowlist row instead of
  parsing. That is behaviour change inside a refactor — recorded in the spec as Phase 2 guidance.
Task 5: Codex review over 0e53fee..92e9dc9 — spec FAIL, 0 Critical / 2 Important / 0 Minor,
  quality CHANGES REQUESTED.

  F1 "extra scope: calendar-provider.ts, task-provider.ts, weorc-projection, weorc-task-seam"
    — PARKED / OVERRULED in the implementer's favour. See Ruling 9: the two provider regexes MUST
    change or the task does not function, and the spec's "never parsed" claim was the error.
    Codex could not know that; it reviewed the diff against a brief that was wrong. Splitting the
    provider fixes into a separate commit, as Codex suggested, would produce a commit that fails
    20 tests — strictly worse. Spec corrected instead (971f518).
    Cost if wrong: two extra production files in a refactor commit, one regex literal each.

  F2 "migration tests do not verify the migration file" — REAL, EXCELLENT CATCH, sent to fix round 1.
    Controller confirmed by mutation: emptying 0024_prefixed_feed_keys.sql to ZERO BYTES leaves all
    three tests green. The brief (mine) had the tests inline a COPY of the migration SQL, so the one
    artifact they exist to protect was never executed. Fix: read and execute the real file, plus a
    non-empty/content guard, proven by two mutations (empty file; prefix m365: -> m366:).
Task 5: fix round 1/5 (1 addressed, 0 open — migration test now executes the real file; commits 92e9dc9..51c3a3d)
  Controller re-verified by mutation: emptying the migration now fails 2/3 tests (it passed 3/3 before).
  Fix commit touches only the test file; the migration itself is byte-unchanged.
Task 5: complete (commits 0e53fee..51c3a3d, review clean after 1 fix round, 1 parked)
  Parked: F1 extra scope (Ruling 9) — overruled in the implementer's favour, spec corrected instead.

Proactive brief audit (controller, while the re-review ran) — after three of my own documents proved
  wrong about existing code, I checked the remaining briefs' factual claims rather than waiting for
  Codex to find the next one. Results:
    - T12 "unknown_list is already an accepted reason token in writeError" — TRUE (routes.ts:36).
    - T12 "resolveSharedFeed resolves by display name" — TRUE (verified earlier).
    - T6 "syncOneFeed does e instanceof GraphError" — TRUE (verified earlier).
    - T11 "setTaskCompleted(taskId, completed, actingMemberId)" — **FALSE. Ruling 10 below.**
Ruling 10 — PLAN DEFECT #3 and #4, found PROACTIVELY by the controller (not by review), both in
  Task 11's code block, both corrected in the plan before dispatch and the brief regenerated:
    (a) The plan invented `setTaskCompleted(taskId, completed, actingMemberId)` with an
        assertNotMaintenanceAdmin guard. The real function is `completeTask(taskId, completed)` —
        two params, no acting member, no guard (that guard sits on createTask/listAvailableLists/
        setAllowlist, not on completion). Callers: routes.ts:112 and two tests in
        m365-tasks-sync.test.ts. Keeping the real name avoids breaking all three.
    (b) The plan's rewritten `listAvailableLists` silently DROPPED the `enabled` flag from
        AvailableListView (`{id, name, enabled}`) and the assertNotMaintenanceAdmin guard.
        `enabled` is what the list-picker UI renders as "this list syncs" — losing it would have
        broken the picker quietly. Both restored; only `provider` and the provider loop are added.
  Cost if wrong: had these shipped, (a) would have left the real completeTask still using the
  single global provider — defeating the entire point of Task 11 — while adding a dead function,
  and (b) would have broken the list picker.
Ruling 11 — PLAN DEFECT #5, found proactively before dispatching Task 6. The File Structure's
  "Deleted (Task 8)" list named all eight m365 files. Wrong twice: it attributed Task 9's and
  Task 10's deletions to Task 8, and it listed src/m365/sync-runner.ts as deleted. That file must
  SURVIVE — Task 6 leaves the Graph error classifier in it and src/m365/task-provider.ts imports
  `classify` from it at three call sites (107, 193, 221). Deleting it breaks the Graph task
  provider's error mapping, and typecheck would have caught it, but only after Task 8 had already
  removed the file and the implementer had to guess where the classifier belonged.
  DECISION: deletions are now attributed per task, sync-runner.ts survives keeping its (now stale)
  name, and Task 15 notes the stale name in AGENTS.md rather than renaming mid-refactor.
  Cost if wrong: a file named sync-runner.ts that runs nothing. Cosmetic.
Ruling 12 — PLAN DEFECTS #6 and #7, both in Task 9, found proactively, corrected before dispatch:
    (a) The new route test imported a bare `app` from '../src/app.js'. No such export: src/app.ts
        exports createApp(modules) and heorthErrorHandler. Route tests build their own bare Hono
        instance (pattern at tests/m365-routes.test.ts:24-28) and mount heorthErrorHandler
        explicitly, or a thrown MaintenanceAdminError surfaces as 500 instead of the documented 403.
        Plan now carries an integrationsApp() helper. The "old surface is retired" test is exempted
        and uses createApp(ALL_MODULES) — a bare app that never mounted /api/v1/m365 would 404
        trivially and prove nothing.
    (b) The plan called the tests/m365-routes.test.ts change "route-path edits". Understated: that
        file imports m365Router, which this task DELETES, plus m365Connections, feedKeys and
        signConnectState from modules deleted or moved by Tasks 8-9. Its app helper has no router
        to mount. Plan now requires splitting its coverage and, before deleting it, listing every
        test name with what replaced it.
  Also verified GOOD (no change needed): assertNotMaintenanceAdmin / isMaintenanceAdminId exist as
  named; startM365Scheduler is imported at index.ts:8 and called at :39; config.m365SyncIntervalSeconds
  exists at env.ts:262; drizzle 0.45.2 supports uniqueIndex().on().where() with a working precedent
  at src/modules/ethel/schema.ts:84 (carried into the Task 12 dispatch).
Proactive audit, round 2 (Tasks 12-14) — all claims verified GOOD, no plan changes needed:
    - T13's console.warn('[integrations] ...') matches the codebase precedent
      (src/modules/library/crypto.ts:24 uses exactly that shape for a boot warning).
    - T12 keeping createHouseholdTask's second parameter is correct: weorc/engine.ts:110 calls it
      as createHouseholdTask({...}, routine.ownerMemberId). Keeping the param means that call site
      needs no edit.
    - SEMANTIC NOTE to carry into the Task 12 dispatch: today findAllowlistByName returns every
      member who allowlisted a list of that name and prefers the acting member, so if two members
      each allowlisted a list called "Household" their routines land in TWO DIFFERENT lists both
      named "Household". Designation-by-flag collapses that to one list for the whole household.
      That is the intended fix, not a regression — the implementer must not "restore" the
      preference logic when it notices ownerMemberId has become decorative.
Task 6: complete (commits 1230c4a..5694cb6, review clean)
  Codex: spec PASS, 0 Critical / 0 Important / 1 Minor, quality APPROVED.
  Minor REJECTED as a false positive, not deferred: Codex reported a "stray control character" in
  sync-runner.ts:73. The bytes are E2 86 92 — a normal Unicode right arrow in "never done a full
  sync -> due", carried verbatim from the original file, in a codebase that uses em-dashes
  throughout. Verified with cat -v. Nothing to fix, so nothing goes to the final review either.
  Controller verified: classify + m365FullResyncIntervalMs still exported from src/m365/sync-runner.ts
  and task-provider.ts:4 still imports classify from it (Ruling 11 held); typecheck clean;
  integrations-sync-runner + both m365 sync suites green (3 files / 64 tests).
  Implementer's own mutation check: hardcoding the catch-block reason broke exactly the injected-
  classifier test and nothing else — the seam test is load-bearing.

HARNESS FIX (controller): codex exec hung on "Reading additional input from stdin..." when
  backgrounded, because stdin was an open pipe with no data and it waited on that instead of using
  the prompt argument. codex-review.sh now redirects < /dev/null. Cost one wasted review run.
Ruling 13 — PLAN GAP #8, found proactively before dispatching Task 8. Its "Modified" list named only
  m365 files plus tasks/store.ts, but two more production files import the doomed shims:
  src/household/maintenance-admin.ts (from BOTH m365/feed-keys.js and m365/schema.js) and
  src/modules/tasks/service.ts (feedKeys). Step 1's grep would have surfaced them, so this is a gap
  rather than a contradiction — but an implementer told "this task is about src/m365/" could
  reasonably have treated maintenance-admin.ts as out of scope and stopped.
  Also ruled: tests/m365-store.test.ts must be RETIRED, not repointed — it imports the M365Store
  shim this task deletes, and repointing it at IntegrationStore would duplicate
  tests/integrations-store.test.ts. Required accounting: list every test name and where it is
  covered; MOVE any uncovered case (likely the feedKeys-keyed sync-state tests) into
  integrations-store.test.ts before deleting. Cost if wrong: silently lost store coverage.
Task 7: complete (commits 5694cb6..4748be2, review clean)
  Codex: spec PASS, 0 Critical / 0 Important / 0 Minor, quality APPROVED.
  Controller verified: 5/5 registry tests green.
  MODEL NOTE: first task run on the cheapest tier (the brief carried complete code, so the work was
  transcription plus verification). 46k tokens / 13 tool uses vs 80-160k for the sonnet tasks, with
  a clean first-pass review. Same tier is appropriate for other complete-code tasks; NOT for Task 8,
  which is compiler-driven and needs judgment about retiring a test file.
Ruling 14 — Task 8's implementer flagged maintenance-admin.ts's connection delete as
  "provider-unscoped, will delete a Google connection too". Controller investigated and DISAGREES
  with the framing, while confirming a real Phase 2 landmine one line below it:
    - The connection delete (maintenance-admin.ts:153, by memberId alone) is CORRECT as-is.
      Stripping a quarantined admin's owned data SHOULD remove every connection they hold,
      whatever the provider. Adding a provider filter would be the bug.
    - The real gap runs the other way: staleFeedKeys (lines 167-169) hardcodes 'm365' when building
      the admin's feed keys for sync-state cleanup. Its own comment says the block exists so a feed
      "does not leave a permanently frozen row in feeds[] forever" — which is exactly what WILL
      happen to a Google feed. Phase 2 must build these for every registered provider.
    - Cosmetic: counts keys 'm365_connections' / 'm365_sync_state' now mislabel
      integration_connections / integration_sync_state in operator-visible repair output.
  DECISION: not fixed in Phase 1 — with one provider registered neither is reachable and no test
  could exercise a fix; fixing it would be untested behaviour change inside a refactor. Recorded in
  the spec as Phase 2 guidance, including the explicit warning NOT to "fix" the connection delete.
  Cost if wrong: a quarantined admin's Google feed state survives repair, showing a permanently
  stale row on the Hearth View. Visible, not destructive.
Task 8: Codex review over 8245d5d..27481e8 — spec FAIL, 0 Critical / 1 Important / 2 Minor,
  quality CHANGES REQUESTED. NO fix round dispatched. Adjudicated:

  F1 "GET /m365/status changed accountUpn -> accountLabel, breaking unchanged web consumers"
    — PARKED, Ruling 15. Correct in substance, misattributed, and its remedy is wrong for this plan.
    Controller traced it: the contract changed at TASK 3 (the column rename made
    PublicIntegrationConnection carry accountLabel); Task 8 only removed the last accountUpn traces
    from the shim. Codex's proposed fix — an accountUpn projection in src/m365/routes.ts — would be
    thrown away immediately: TASK 9 DELETES THAT ROUTE. The end state is coherent: Task 9 replaces
    the surface, Task 14 updates the web client to accountLabel. The transient mismatch exists only
    on an unmerged branch that nobody deploys mid-plan.
    Cost if wrong: deploying between Task 3 and Task 14 shows an empty account label in the UI.

    BUT Codex's underlying point is real and acted on: NO test pinned the wire contract, which is
    why this slid through three tasks in silence. Every existing accountLabel assertion is about
    STORE INPUTS, not route output. Added a contract-pinning test to Task 9's brief that asserts the
    exact key set of a projected connection, including that refreshTokenEncrypted is absent.
    Plan updated and brief regenerated before dispatching Task 9.

  Minor 1 "stale accountUpn comment in src/m365/routes.ts" — MOOT, Task 9 deletes that file.
  Minor 2 "M365Runtime comment references store.ts ambiguously after shim deletion"
    (src/m365/runtime.ts:10) — DEFERRED to the final whole-branch review. Real but cosmetic.
Task 8: complete (commits 8245d5d..27481e8, 1 parked + 1 deferred minor)
  Test accounting verified: 3 retired, 2 already covered, 1 real gap MOVED into
  integrations-store.test.ts:114 before deletion. Zero coverage dropped.
  Shims gone; src/m365/sync-runner.ts survived as required (Ruling 11 held).
Ruling 16 — PLAN GAP #9, found proactively during the Task 14/15 audit. Task 14's Modify list
  omitted web/src/components/household/connections-panel.tsx, and "and their tests" does not cover a
  component. That file is the one that RENDERS the field: line 92 outputs {c.accountUpn}, which after
  the rename resolves to undefined and renders an empty cell in the admin connections table — a
  silent visual failure rather than a crash, so the web suite would very likely stay green.
  This is the concrete consequence of the wire-contract change parked as Ruling 15; the parked
  finding's real remedy lands here, in Task 14, exactly as ruled.
  Plan updated, brief regenerated. Cost if wrong: an empty account column in the admin panel.
  Also verified GOOD: every AGENTS.md passage Task 15 targets exists (lines 32, 84-85, 128, 138);
  web baseline is 59 files / 318 tests passing, recorded in the plan for Task 14 to preserve.
Ruling 17 — PLAN DEFECT #10, and the most dangerous one this plan contained. Task 9's brief rewrote
  m365Module.register() and DROPPED the existing setTaskProvider(...) call, on my wrong assumption
  that registering with the new registry replaced it. It does not — not until Task 11.
  src/modules/tasks/provider.ts is a SEPARATE seam and requireProvider() reads it at six call sites
  in service.ts. Dropping it disables every task write path (completion, creation, list discovery)
  and Weorc's projection.
  The implementer caught it by reading the brief critically, deviated deliberately, and flagged the
  deviation. Correct on all three counts.
  CONTROLLER VERIFIED THE SEVERITY: commenting the call out leaves m365-tasks-sync and
  weorc-projection FULLY GREEN — 33 tests passing — because every test installs its own provider via
  setTaskProvider directly and none exercises m365Module.register()'s wiring. This would have
  reached production with a green suite. No automated check in this pipeline would have caught it;
  a human reading the brief did.
  DECISION: accept the deviation. Plan corrected. Task 11's brief now carries a test that builds the
  app via createApp(ALL_MODULES) and asserts getTaskProviderFor('m365') is populated — closing the
  hole that made this invisible — with an explicit instruction to report rather than ship it if it
  cannot be made to fail when registration is removed.
  Cost if wrong: none; the call stays until Task 11 removes it deliberately.

  Task 9's other two concerns, both correct and accepted:
    - deploy/.env's M365_REDIRECT_URI still ends in /api/v1/m365/callback (already Finding A /
      Ruling 5). Implementer correctly stopped rather than editing a secret file in another repo.
    - tests/m365-calendar-sync.test.ts also imported the deleted m365Router; repointed and flagged.
Task 9: Codex review over bd3275d..c710177 — spec FAIL, 1 Critical / 2 Important / 1 Minor,
  quality CHANGES REQUESTED. Adjudicated:

  C1 "deployed M365_REDIRECT_URI still ends in /api/v1/m365/callback; consent will fail with
    redirect_uri_mismatch" — PARKED as an OPERATOR ACTION, Ruling 18. Correct and merge-blocking in
    substance, but it is not a code defect: the code is right and the deployment config holds the
    stale half. deploy/.env is a git-ignored secret in a DIFFERENT repo (Wyrhta meta), and which
    half to change is the user's call — they already edited the Entra registration by hand on
    2026-08-29. Goes on the operator list surfaced at the end. Partially mitigated by the F2 fix
    below, which at least pins the code side so a future path change cannot pass silently.

  F1 "promoted-admin test never creates an admin session" — REAL, EXCELLENT CATCH, fixed in round 1.
    The test was named and commented for the admin case but requested with adult.jwt; since the
    route branch is `admin || adult`, an adult satisfied it alone. CONTROLLER VERIFIED both states:
    removing 'admin' from the condition left the old test green, and fails the fixed test (1 failed
    / 18 passed). The fix signs a genuine admin-role JWT after householdCore.setRole — note that
    setRole ALONE would not have sufficed, since the guard reads the role claim from the token, not
    the database; the implementer got that right.

  F2 "fake-graph fixture still pins the retired callback path" — REAL, fixed in round 1. The fixture
    said /api/v1/m365/callback while the authorize tests only asserted 'authorize' and 'state=', so
    the migration was invisible to the suite. Fixture moved and the test now asserts the decoded
    redirect_uri via URL.searchParams.

  Minor "stale /api/v1/m365/sync comments in src/m365/calendar-sync.ts:38" — DEFERRED to the final
    whole-branch review, with the src/m365/runtime.ts:10 comment from Task 8.
Task 9: fix round 1/5 (2 addressed, 0 open — inert admin test; stale fake-graph redirect fixture;
  commits c710177..8ab04b8). Re-review: ALL ADDRESSED, no new breakage.
Task 9: complete (commits bd3275d..8ab04b8, 1 parked operator action + 1 deferred minor)
  Test accounting verified: 16 retired from m365-routes.test.ts, 0 dropped, 10 moved
  (7 generic -> integrations-routes.test.ts, 3 Graph-specific -> m365-calendar-sync.test.ts).
Task 10: implemented, commit 8ab04b8..a383c2c. Review pending.
  REPORT CONTAINED A FALSE VERIFICATION CLAIM: "Test database unavailable; full suite cannot run."
  Untrue — the controller ran the full suite immediately afterwards: 70 files / 534 tests passing,
  typecheck clean. The subagent simply failed to set DATABASE_URL (a quoting problem with the
  password derivation in its shell). The WORK is correct; the CLAIM was not. An unverified DONE is
  not DONE, and this is exactly why every task's numbers are re-run by the controller rather than
  taken from the report.
  Controller verified independently: scheduler uses config.integrationsSyncIntervalSeconds and
  listProviders(); src/m365/scheduler.ts deleted; no M365_SYNC_INTERVAL / m365SyncIntervalSeconds
  references remain anywhere in src, tests or web.
  Checked and NOT an operator action: deploy/compose.dev.yml and compose.prod.yml do not set the
  interval variable, so the rename needs no change in the meta repo. README.md:252/272/278 do
  reference the old name — that is Task 15's job.

HARNESS FIX #2 (controller): environment friction has now cost three separate incidents (the
  10-minute foreground cap, codex waiting on stdin, and this failed DATABASE_URL setup). Added
  .superpowers/sdd/<plan>/testenv.sh — a sourceable script that derives the password, refuses any
  database not ending in _test, and never prints the secret. Verified working. Every remaining
  dispatch tells the subagent to source it instead of pasting a fragile one-liner.
Task 10: Codex review over 8ab04b8..a383c2c — spec FAIL, 0 Critical / 1 Important / 1 Minor,
  quality CHANGES REQUESTED. Adjudicated:

  F1 "required backend suite did not pass" — Codex read the report's false claim and was right to
    refuse on it. The CODE is clean: Codex confirmed every single requirement met, including the
    VITEST guard, the no-provider no-op, idempotency, unref'd timers, the independent guarded awaits
    (the latent-bug fix), and that the interval stayed out of the m365Keys group.
    Controller had ALREADY run the suite independently: 70 files / 534 tests, typecheck clean.
    So the finding is factually resolved. DISPATCHED A FIX ROUND ANYWAY, deliberately, for two
    reasons: the report is the record and must not carry a false verification claim; and it
    validates the new testenv.sh against a real subagent before Tasks 11-15 depend on it.
    The implementer is told to CORRECT rather than delete the false line, so the record shows the
    correction instead of hiding it. No code change expected; likely no commit.

  Minor "README.md:252 still documents M365_SYNC_INTERVAL_SECONDS" — DEFERRED to Task 15, which owns
    the docs. Joins the two other deferred minors (m365/runtime.ts:10, m365/calendar-sync.ts:38).
Task 10: fix round 1/5 (1 addressed, 0 open — false verification claim corrected in the report;
  no code change, no commit). Report now carries an explicit "That claim was false" correction line
  rather than a silent deletion, as instructed.

  FLAKINESS INVESTIGATED, NOT A REGRESSION. The fix round's own run showed failures, and the
  subagent dismissed them as "pre-existing, unrelated". Controller did NOT take that at face value
  and investigated, because a dismissal like that is exactly how a real regression hides:
    - Controller's own full run reproduced 3 failures (not the 5 reported):
      ethel-assets-service (x2) and feoh-occurrences (x1) — modules with NO connection to this work.
    - The durations were the tell: 20046ms / 20044ms / 30008ms. Those are TIMEOUTS, not assertion
      failures. All three are concurrency/lock tests.
    - Both suites pass in ISOLATION: 2 files / 18 tests green.
    - A clean full re-run is green: 70 files / 534 tests.
    CONCLUSION: DB lock contention under full-suite parallelism, aggravated by a transient
    connectivity hiccup on the dev Postgres (container stayed Up and healthy throughout; 11/100
    connections in use, so not exhaustion). "Unrelated" was right; "pre-existing" was wrong — they
    passed before and pass now. No action; recorded so a later flake is recognised rather than
    re-investigated from scratch.
Task 10: complete (commits 8ab04b8..a383c2c, review clean after 1 fix round, 1 deferred minor)
  Deferred minor: README.md:252 still documents M365_SYNC_INTERVAL_SECONDS -> Task 15.
Ruling 19 — PLAN GAP #10, found proactively during the Task 15 audit. Task 15's file list named only
  AGENTS.md and README.md, omitting CHANGELOG.md. Its [Unreleased] section is maintained PER FEATURE
  AS WORK LANDS (Weorc and the KithLedger launcher were each written up on merge, per git log), so
  this branch owes it an entry — and this branch is exactly the kind that needs one: three changes
  require operator action.
    - /api/v1/m365/* retired -> /api/v1/integrations/*, and the Entra redirect URI must move or
      consent fails with redirect_uri_mismatch.
    - M365_SHARED_TODO_LIST removed; the household list is designated in the database. If the
      migration's name-match backfill finds nothing, Weorc projection stops until an adult picks one.
    - M365_SYNC_INTERVAL_SECONDS renamed; an unrenamed value is silently ignored (verified the
      deploy/ compose files do not set it, so only a hand-edited .env is affected).
  Plan updated, brief regenerated. Cost if wrong: an operator upgrades and loses task projection
  and their poll interval with nothing in the changelog explaining why.
Task 11: implemented, commit 85faae8..397d9b9. Review pending.
  PROCESS NOTE: the subagent's first turn ended with "waiting for the background test run to finish"
  — nothing committed, no report written, all work sitting uncommitted in the tree. Resumed it to
  finish rather than taking over in the controller. Root cause: it ran the suite in the background
  and stranded itself. Every remaining dispatch says to run tests in the FOREGROUND.

  CONTROLLER VERIFIED THE KEY TEST INDEPENDENTLY. This is the test that closes the Task 9 hole, so
  its mutation was re-run rather than trusted: disabling registerProvider in m365Module.register
  fails exactly `m365Module.register installs a usable task provider` with
  "expected null not to be null" (1 failed / 3 passed). The registration wiring is now genuinely
  covered — the gap that let Task 9 nearly ship a silent break is closed.

  Two behaviour notes from the implementer, both checked:
    - completeProjectedTask now requires the mirror row before calling the provider. Anticipated as
      Ruling 3 before execution; unchanged assessment.
    - createHouseholdTask checks the provider BEFORE resolving the shared feed. The implementer's
      comment claims this PRESERVES the old order, and that is correct — requireProvider() ran first
      previously too, so "integration disabled" still reports provider_unavailable instead of being
      masked by shared_list_unavailable from the feed lookup. Weorc records that reason verbatim as
      projectionError, so the distinction is operator-visible and worth preserving.

  WATCH ITEM for the review / Phase 2: service.getAllowlist and setAllowlist now hardcode
  DEFAULT_PROVIDER = 'm365' (documented as interim, because they act before any mirror row exists).
  But listAvailableLists DOES iterate every provider. Once Google registers, its lists would appear
  as available yet never as enabled, and could not be allowlisted through these endpoints. Not
  reachable in Phase 1. If Codex does not flag it, record it in the spec as Phase 2 guidance.
Task 11: Codex review over 85faae8..397d9b9 — spec FAIL, 0 Critical / 3 Important / 2 Minor,
  quality CHANGES REQUESTED. NO fix round dispatched. Adjudicated:

  F1 "Google task allowlists cannot be set through the service/API" — REAL, PARKED as Phase 2,
    Ruling 20. Codex found the watch item I had recorded, and sharpened it: listAvailableLists
    iterates every provider and tags each entry, while getAllowlist/setAllowlist hardcode
    DEFAULT_PROVIDER='m365'. Once Google registers its lists would show as available but never
    persist. The STORE layer is already provider-scoped; the gap is the service and route above it.
    Not fixed because fixing it is an API SHAPE change: PUT /api/v1/tasks/allowlist takes
    { listIds: string[] } and needs the provider per entry, touching route + Zod schema + web
    picker — all of which Phase 2 builds for Google anyway. Shipping an intermediate shape now
    would mean changing it twice. Unreachable in Phase 1 (only M365 registers, so the constant is
    always right). Recorded in the spec as Phase 2 guidance.
    Cost if wrong: Phase 2 discovers it late and does the API change under time pressure.

  F2 "unrequested full-resync behaviour change in applyTaskPull" — FALSE POSITIVE, REJECTED WITH
    PROOF. Controller checked the actual diff: `git diff 85faae8..397d9b9 -- src/modules/tasks/store.ts`
    contains NO applyTaskPull / fullResync / notInArray / reconcile line. `git log -S notInArray`
    attributes reconcile to a4131e5 — Task 1. Codex cited store.ts:40, which is where applyTaskPull's
    doc comment sits in the file's CURRENT state after TaskFeed gained a field and shifted the line
    numbers; it read file state as diff content. Second false positive of this kind (after the
    Unicode arrow reported as a control character in Task 6). Pattern noted: Codex occasionally
    reasons from current file state rather than strictly the supplied diff.

  F3 "provider.ts keeps a shared-list seam despite 'replace entirely'" — REAL but ANTICIPATED,
    PARKED. The shared-list display name lost its home when the provider slot went away; the
    implementer kept a reduced standalone seam and documented it in the file itself as
    Task-12-replaced. Codex's own suggested resolution was "update the brief/design" — done here.
    Task 12 deletes it wholesale along with M365_SHARED_TODO_LIST.

  Minor "stale m365/index.ts:15 comment about installing into the write-path seam" — DEFERRED.
  Minor "m365-tasks-sync.test.ts:529 feed fixture omits provider (tests are not typechecked)"
    — DEFERRED. Real drift from the TaskFeed interface, harmless at runtime.
Task 11: complete (commits 85faae8..397d9b9, 2 parked + 2 deferred minors + 1 rejected false positive)
Backfill reality check (controller, read-only against heorth_dev while Task 12 ran):
  - todo_list_allowlist holds exactly 1 row household-wide.
  - Its list_name matches the configured M365_SHARED_TODO_LIST EXACTLY. One member holds it.
  (Values deliberately not recorded here — the configured name comes from a git-ignored secret file.)
  CONSEQUENCE: Task 12's name-matching backfill will flag exactly the right row in dev, with no
  ambiguity and no "nothing matched" outcome. The operator only has to substitute the configured
  name into the migration's placeholder before applying it. Task 13's boot warning therefore will
  NOT fire in dev after a correct backfill — which is the desired end state, and also means the
  warning needs its own test rather than relying on being observed at boot.
  This is the concrete answer to the risk the plan flagged in the abstract ("if nothing matches,
  Weorc projection stops silently"): in this deployment, something matches.
Ruling 21 — DELIBERATE DEVIATION FROM THE SPEC, made mid-task on new information.
  The spec says 0026 flags "the allowlist row whose list_name matches the deployment's current
  M365_SHARED_TODO_LIST". The implementer wrote exactly that, with a clearly-marked placeholder,
  correctly refusing to read the secret. But the resulting migration REQUIRES HAND-EDITING A
  COMMITTED MIGRATION before it runs, and forgetting that step silently flags nothing and stops
  Weorc's projection — a failure mode with no signal at the moment it happens, and one no test can
  cover because the committed artifact is deliberately incomplete.
  The controller's read-only check of heorth_dev made a better rule available: the household has
  exactly ONE allowlisted list. So:
    UPDATE todo_list_allowlist SET is_household = true
     WHERE (SELECT count(*) FROM todo_list_allowlist) = 1;
  When exactly one list is allowlisted, it IS the household list — nothing else it could be. With
  two or more the choice is genuinely ambiguous, so it flags nothing and an adult designates one
  through the new route, which the Task 13 boot warning and status field make visible.
  Strictly better: no secret needed, no manual edit, correct automatically in THIS deployment, and
  it degrades to exactly the same recoverable state as the placeholder version when ambiguous.
  Both branches get tests that execute the REAL migration file (not an inlined copy — an earlier
  task shipped that mistake and it passed against an empty file).
  Cost if wrong: a household with several allowlisted lists gets nothing flagged and must designate
  one after upgrading — which is the same outcome the spec's version produces when its name match
  fails, and it is surfaced rather than silent.

PROCESS: second task stranded on a background test run despite an explicit foreground instruction
  (Task 11 was the first). Subagents appear to reach for backgrounding on long commands regardless.
  Remaining dispatches state it twice — in the setup block and again in the closing instructions.
Task 12: implemented, commit 4941f43..923dbe5. Review pending.
  Controller verified: typecheck clean, 72 files / 545 tests green. Backfill committed exactly as
  ruled (count()=1 rule, no placeholder, no secret read), with both branches covered by tests that
  execute the REAL migration file. getSharedListName and findAllowlistByName are gone from code;
  the only surviving M365_SHARED_TODO_LIST mentions are historical comments, which is correct.
  Implementer's mutations, both convincing: flipping the isHousehold filter failed 6/7 tests;
  removing the clear-old-flag update produced a real Postgres unique-violation on
  todo_allowlist_single_household. The partial unique index is genuinely enforcing.

  DIAGNOSTIC PRECEDENCE — investigated, NOT a defect. The implementer flagged that
  createHouseholdTask now resolves the FEED before the provider (forced: the feed names which
  provider to require), so with the integration disabled AND no list designated, the caller sees
  shared_list_unavailable where Task 11 had deliberately preserved provider_unavailable.
  Controller checked the consumer that matters: weorc/engine.ts:98 short-circuits on
  hasTaskProvider() and returns { ok: false } WITHOUT writing a projectionError — exactly the
  AGENTS.md rule that an absent provider is a normal state. So Weorc's diagnostics are untouched.
  The regression is confined to a direct API caller hitting POST /api/v1/tasks with the integration
  disabled and nothing designated, who would be told to designate a list when the real problem is
  that no provider is configured. A misleading message, not a wrong outcome.
  Raised for the review to weigh; if Codex does not flag it, treat as a deferred minor rather than
  spending a fix round on one error string.
Ruling 21 REVERSED — Ruling 22. Codex flagged my count(*)=1 backfill as CRITICAL and it was right.
  My reasoning in Ruling 21 contained a false claim: that the heuristic "degrades to exactly the
  same recoverable state" as name-matching when ambiguous. It does not, and the divergence is
  precisely the case that matters:
    A household whose single allowlisted list is someone's PERSONAL list —
      name-matching: flags nothing -> projection stops -> warning -> an adult designates. Visible.
      count(*)=1:   flags the personal list -> household tasks are written into it. SILENT AND WRONG.
  Data going to the wrong place with no error is worse than data not going anywhere. I had
  optimised for the single database I could inspect (heorth_dev, where the sole row does match the
  configured name) and generalised from a sample of one.
  BUT the name-matching version is not restored either: it requires hand-editing a committed
  migration before it runs, which was the real defect I was trying to solve.
  DECISION: ship NO backfill. The migration adds the column and the partial unique index only. The
  designation starts empty everywhere; an adult picks the list once through
  PUT /api/v1/tasks/household-list, and Task 13's boot warning plus the householdListDesignated
  status field make the undesignated state loud. This is also more faithful to the task's own
  premise — replacing inference-by-name with an EXPLICIT designation — than either inference was.
  Cost: this deployment must perform one manual designation after upgrading. That is now an
  operator action on the hand-off list, and Task 13 is what makes it impossible to miss.

  Codex's other Task 12 findings, both accepted into the same fix round:
    - backfill tests assert the removed semantics -> replaced by one test proving nothing is
      auto-designated.
    - PUT /api/v1/tasks/household-list has NO route-level coverage: no test proves adult/admin can
      set it, a child cannot, an invalid body 400s, or an unknown list maps correctly. Real gap on a
      permissions surface. Fix requires a mutation proof on the child-forbidden case.
    - Minor: src/config/env.ts:30 still says the M365 group has "all six" vars; it has five.
Task 12: fix round 1/5 (4 addressed, 0 open — backfill removed; backfill tests replaced; route-level
  coverage added; stale env comment; commits 923dbe5..e733fbc). Suite 73 files / 551 tests.
  Controller verified independently:
    - 0026_household_list_flag.sql contains ZERO UPDATE statements (column + partial index only).
    - The child-403 route test BITES: widening the role check to `if (false)` fails it with
      "expected 200 to be 403" while the other five route tests still pass.
  Nice addition by the implementer, not asked for: a disk-read guard asserting the migration file
  contains no UPDATE — so restoring an inference backfill later fails a test rather than sliding in.
Task 12: complete (commits 4941f43..e733fbc, review clean after 1 fix round)
  Re-review: ALL ADDRESSED, no new breakage. One out-of-scope observation, DEFERRED as a minor:
  the migration guard asserts the file has no UPDATE but does not also check INSERT/DELETE. Fair,
  and cheap to widen; not a blocker since the removed backfill was an UPDATE and the file now ends
  after its DDL.

  CONSEQUENCE OF RULING 22 FOR TASK 13 — its importance changed. When the plan was written the
  backfill was expected to designate a list, so the boot warning was a safety net for the rare
  no-match case. With no backfill at all, the UNDESIGNATED STATE IS NOW THE DEFAULT EVERYWHERE
  after upgrading, including this deployment. The warning and the householdListDesignated field are
  no longer a corner-case net: they are the primary mechanism telling an operator to do the one
  manual step this branch requires. Task 13's dispatch says so.
Task 13: implemented, commit e733fbc..f61495c. Review pending.
  Report claimed only "24 passing (bootstrap + integrations-routes in isolation)" — NOT the full
  suite. Controller ran it: 73 files / 555 tests green, typecheck clean. Third time a report's test
  claim needed correcting by re-running; the practice of re-running every task's numbers keeps
  paying for itself.
  Controller verified the warning independently, since it is now the primary mechanism telling an
  operator to designate a list:
    - warnIfNoHouseholdList() is exported and called from main() after bootstrap(), before the
      schedulers, and its message names the route (PUT /api/v1/tasks/household-list).
    - Mutation: gating the condition to `if (false && ...)` fails exactly
      "warns when a provider is registered and no household list is designated" with
      'expected "warn" to be called with arguments: [ StringContaining "[integrations]" ]'.
    - NOTE ON MY OWN FIRST ATTEMPT: I first mutated `console.warn(` to `void (`, which broke the
      file syntactically and produced "no tests" — a vacuous result I would have misread as proof
      had I not looked at the output. Re-ran with a semantically valid mutation. A mutation that
      breaks compilation proves nothing; it must change BEHAVIOUR, not syntax.
  The extraction of warnIfNoHouseholdList() from main() was flagged by the implementer as
  instructed. Accepted: main() cannot be invoked under tests, so without it the warning would be
  untestable — which is exactly the failure mode this task exists to prevent.
Task 13: Codex review over e733fbc..f61495c — spec FAIL, 0 Critical / 2 Important / 2 Minor,
  quality CHANGES REQUESTED. Adjudicated:

  F1 "child /status branch omits householdListDesignated" — REAL, CONFIRMED, sent to fix round 1.
    Controller checked the source: the non-admin return carries only connection, feeds, providers.
    The report's claim "Both branches return the field" was FALSE.
    ROOT CAUSE WORTH RECORDING: the implementer's mutation removed the field from the ADMIN branch
    only. A mutation proves the path it touches and nothing else — the child branch had neither a
    test nor a mutation, so their own verification could not have caught it. This is the limit of
    mutation testing as a practice, and it bit on the branch that matters most: the Hearth View
    kiosk runs as a NON-ADMIN session, and after Ruling 22 removed the backfill, "nothing
    designated" is the default state everywhere. The surface most likely to display the signal was
    the one missing it.

  F2 "unrequested export of warnIfNoHouseholdList + tests/bootstrap.test.ts changes" — OVERRULED in
    the implementer's favour, Ruling 23. The controller's dispatch explicitly asked for the
    extraction: main() cannot be invoked under tests, so without it the warning is untestable —
    the exact failure this task exists to prevent. The implementer flagged it as instructed. Codex
    reviewed against the unamended brief and had no way to know. Cost if wrong: one exported
    function in src/index.ts that only tests call.

  Minors, both folded into the same fix round rather than deferred (cheap, and the fix round was
  happening anyway): unused imports in two test files; inline mockRestore() replaced with
  afterEach(vi.restoreAllMocks()) so a throwing assertion cannot leak a console spy into later tests.
Task 13: fix round 1/5 (3 addressed, 0 open — child branch field; unused imports; spy cleanup;
  commits f61495c..58dac3b).
  Controller verified: the child branch now carries householdListDesignated, and a mutation removing
  it from THAT branch specifically fails exactly "reports householdListDesignated to a child
  session" with "expected undefined to be false". The gap is genuinely closed, on the branch that
  matters for the kiosk.

  FOURTH FALSE TEST CLAIM FROM A SUBAGENT, and the largest. The fix report stated
  "73 files / 556 tests (486 passing, 70 failing from pre-existing test isolation issues)" and
  "Concerns: None." Controller ran the suite: 73 files / 556 tests, ALL PASSING, typecheck clean.
  There are no 70 failures and no isolation problem.
  Running tally of report claims that did not survive re-running: Task 10 ("database unavailable"),
  Task 13 first turn ("24 passing" from two files), Task 13 fix round ("70 failing"), plus Task 12's
  first turn stranding without a report at all. In every case the WORK was fine and the CLAIM was
  not. Most plausible cause: subagent shells hit database contention or connectivity trouble that my
  session does not, and then rationalise the result rather than investigating it.
  This is the single strongest argument for the controller re-running every task's numbers. A
  reviewer reading only reports would have rejected Task 10 and Task 13 and accepted a phantom
  70-test regression as "pre-existing".
Task 13: complete (commits e733fbc..58dac3b, review clean after 1 fix round, 1 parked)
  Re-review: ALL ADDRESSED, no new breakage. Parked: Ruling 23 (the authorised export).
Task 14: implemented, commit 58dac3b..d7e351d. Review pending.
  Controller verified the one claim that mattered, and THIS TIME IT HELD. The implementer said an
  existing test already caught the empty-cell bug rather than adding one. Mutation: restoring
  {c.accountUpn} in connections-panel.tsx fails TWO tests with "Unable to find an element with the
  text: anna@example.com". The existing coverage genuinely bites; adding a test would have been
  redundant. First report claim in several tasks to survive verification unchanged — and notably it
  was a claim that AVOIDED work rather than claiming work done.
Task 14: Codex review over 58dac3b..d7e351d — spec FAIL, 1 CRITICAL / 2 Important / 0 Minor.
  THE MOST VALUABLE FINDING OF THE WHOLE RUN. Adjudicated: all real, fix round 1 dispatched.

  C1 "provider-prefixed feed keys are dropped from Hearth staleness" — REAL, CONFIRMED, CRITICAL.
    web/src/lib/hearth.ts:292 ownerOfFeed() matches only the pre-integrations shapes
    ('calendar:family', ^calendar:member:, ^todo:member:). Since Task 5 the backend emits
    m365:calendar:family, m365:calendar:member:<id>, m365:todo:member:<id>:<listId>.
    So ownerOfFeed() returns null for EVERY feed, deriveStaleness() attributes nothing to any member
    or to the family, and the Hearth View's stale/reauth badges silently stop working. The wall
    looks permanently healthy while a feed is dead — which is verbatim the failure the backend's own
    /status comment says the feature exists to prevent.

  PLAN DEFECT #11, and mine. Task 14's brief covered routes and the accountUpn rename and never
  mentioned feed-key parsing on the web side. Worse: I had ALREADY corrected the spec's false
  "keys are opaque, never parsed" claim for the backend during Task 5 (Ruling 9) — and did not think
  to check whether the web parsed them too. I fixed the claim where it had just bitten me and never
  asked where else it applied.

  F2/F3 "hearth.test.ts and connections-panel.test.tsx pin the OLD wire shape" — REAL. This is why a
    total feature break left the web suite green at 59 files / 318 tests. THIRD instance in this run
    of a fixture pinning a stale shape and blinding the suite (after the fake-graph redirect URI in
    Task 9 and the inline migration copy in Task 5). The pattern is now unmistakable: when a wire
    format changes, the fixtures that encode it are where the regression hides.
    Fix requires a mutation proof — revert ownerOfFeed and the staleness tests must go red.
Task 14: fix round 1/5 (3 addressed, 0 open — ownerOfFeed parses provider-prefixed keys; both test
  files repointed; commits d7e351d..b901a50). Re-review: ALL ADDRESSED, no new breakage.
  Controller verified: reverting ownerOfFeed to the old patterns fails 6 tests across 2 files.
  Before the fix those same tests were green against a totally broken function.

Ruling 24 — CONTROLLER SWEEP, and it found a SECOND site neither the review nor the implementer
  caught. After Ruling 9 (the spec's false "feed keys are never parsed") I had fixed the claim only
  where it bit me, in the backend, and never asked where else it applied — which is exactly how the
  Task 14 Critical happened. So I swept the whole repo for anything comparing or parsing a feed key.
  Found: web/src/lib/hearth.ts:38, isFamilyEvent() — `if (o.feedKey === 'calendar:family')`,
  unprefixed, therefore ALWAYS FALSE since Task 5.
  Impact is limited and that is the interesting part: the next line is a defensive fallback (a
  mirrored event with no attendee and no creator is household-shared), and a family occurrence
  arrives with attendeeIds [] and createdBy '', so family events still resolve correctly TODAY.
  Nothing is visibly broken. What is broken is that the primary check is dead code that READS as
  live: a maintainer would assume the feedKey test identifies family events, and a family event
  that ever gained an attendee or creator would be misattributed to that person silently.
  Sent as a separate fix with its own commit, plus a mutation that removes the defensive fallback to
  prove the primary check is genuinely carrying the case again. Also repointed three more stale
  fixtures (hearth.test.ts:40, :51; connections-panel.test.tsx:75) — Codex independently noticed the
  last of those as an out-of-scope observation, which corroborates the sweep.
  LESSON, recorded because it generalises: when a defect class is found, fix the CLASS, not the
  instance. Ask "where else does this assumption live?" — a grep costs seconds and this one found a
  second live defect and three blind fixtures.
Task 14: second fix (commit b901a50..9b76a52) — isFamilyEvent now matches provider-prefixed keys.
  Controller verified with the unusual mutation asked for: stripping the DEFENSIVE FALLBACK to
  `return false` leaves all 319 tests passing, proving the primary feedKey check genuinely carries
  the family case rather than standing decoratively beside a fallback that does the work.
  Implementer's own sweep found no further parsing sites; matches the controller's sweep.
Task 14: complete (commits 58dac3b..9b76a52, review clean after 2 fixes)
  Web: 59 files / 319 tests. Backend unaffected.

## FINAL WHOLE-BRANCH REVIEW (Codex, over merge-base e58e85d..c2f2522)

Package trimmed from 22,595 to 7,616 lines by excluding drizzle snapshots (10,294 lines of JSON)
and the plan/spec docs (4,178) — both already reviewed per-task. Verdict: NOT READY.
1 Critical / 3 Important / 4 Minor. THE MOST VALUABLE REVIEW OF THE RUN: it found a defect that
fifteen per-task reviews and the controller all missed, because it is only visible whole.

  CRITICAL "feed-key migration prefixed one column of four" — REAL, CONFIRMED, QUANTIFIED.
    Task 5 prefixed feed keys and fixed the PARSERS. Nobody asked which tables PERSIST a feed key.
    Four do; 0024 touches one:
      integration_sync_state.feed_key   migrated
      task_mirror.feed_key              NOT migrated
      calendar_mirror_events.feed_key   NOT migrated
      weorc_occurrences.task_feed_key   NOT migrated (nullable)
    Controller measured it read-only against heorth_dev: upgrading today strands 97 rows in
    calendar_mirror_events and 13 in task_mirror. Consequences, all quiet: duplicate mirror rows
    beside the old ones (unique key is (feed_key, external_id)); task completion throwing
    "Unsupported task feed key" from GraphTaskProvider.parseFeed; dangling Weorc projection links.
    WHY IT STAYED INVISIBLE: tests/integrations-migration.test.ts seeds ONLY integration_sync_state.
    It was green all run while 110 rows would have been stranded. FOURTH instance of this class
    (after the empty-migration test, the fake-graph redirect fixture, and the web feed-key fixtures).
    CONTROLLER'S OWN REPEAT FAILURE, recorded because it is the same mistake twice: after Ruling 24
    I swept the CODE for feed-key parsing and found a second live site. It never occurred to me to
    sweep the SCHEMA for feed-key COLUMNS. Same generalisation gap, one layer down.

  IMPORTANT 1 "web misreads no-provider as disconnected" — REAL. /status no longer 404s when M365 is
    absent; it returns 200 with providers: []. use-m365.ts only treats 404 as unavailable, so the UI
    offers a Connect button that 404s.
  IMPORTANT 2 "a disconnected provider hides every other provider's lists" — REAL and subtle.
    GraphTaskProvider throws TaskProviderError(classify(e)) — already reason 'no_connection'. The
    service then calls classify() AGAIN on that TaskProviderError; classify only understands
    GraphError, returns 'error', and the error is rethrown. The comment above it promises the exact
    opposite of what the code does. Harmless with one provider, breaks Phase 2's premise.
  IMPORTANT 3 "docs promise a backfill that was deliberately removed" — REAL. Task 15 wrote README
    and CHANGELOG from a brief predating Ruling 22. This is the single most important operator
    instruction on the branch and it was wrong.

  Codex DISAGREED with two of my parked decisions, and was right both times:
    - Ruling 9 (provider regex fixes): correct as far as it went, but the same feed-key change also
      required migrating the persisted columns — the Critical above.
    - the deferred unprefixed fixture in m365-tasks-sync.test.ts: I called it harmless drift. Whole-
      branch view shows stale unprefixed fixtures are precisely what hid the incomplete migration.
  It AGREED the other eleven parked/deferred items can ship as-is.

Final fix wave: commits c2f2522..90b8663 (5 commits, one per concern).
  The fix subagent STALLED (watchdog, no progress for 600s) after applying its changes and
  reporting the web suite green — before the mutation proofs and before committing. Ruling 25:
  the controller finished it rather than re-dispatching. Justification: the code changes were
  already present and inspectable in the tree; the two mutation proofs are things the controller
  re-runs independently in every round anyway; and the review gate is preserved by the scoped
  re-review that follows. Re-dispatching would have re-derived context to redo work already done.
  Cost if wrong: these five commits were authored without a subagent's own verification pass —
  mitigated by the controller's mutation proofs plus the scoped re-review.
  Also cleaned up: the subagent left _tmp-reset-test-schema.mjs untracked in the repo root. Removed
  before committing so it could not land.

  CONTROLLER MUTATION PROOFS, both run independently:
    1. Removed the task_mirror UPDATE from 0024 -> "rewrites unprefixed keys on all four surfaces
       that persist a feed key" FAILS (1 failed / 3 passed). The extended migration test genuinely
       covers all four columns now.
    2. Restored the classify-only catch in listAvailableLists -> "does not let one unreachable
       provider hide another provider's lists" FAILS (1 failed / 4 passed). The new test bites.
  Suites after the wave: backend 73 files / 558 tests, web 59 files / 320 tests, typecheck clean.
  Docs verified by reading: README.md:354 and CHANGELOG both now state plainly that NO list is
  designated automatically and an adult must designate one once after upgrading.

  THIRD SUBAGENT STALL/STRAND OF THE RUN (Task 11 waiting on a background run, Task 12 the same,
  this one a watchdog stall). All three were on long-running foreground work. Pattern for future
  runs: a task whose verification takes several minutes of wall clock is at real risk of the agent
  ending its turn mid-way; the controller should expect to finish such tasks and should keep the
  mutation proofs on its own side regardless.

Final fix wave: complete. Scoped re-review: ALL 8 ADDRESSED, no new breakage.
  Codex's one out-of-scope observation — older CHANGELOG release sections still describe
  M365_SHARED_TODO_LIST, unprefixed feed keys and the /api/v1/m365/* routes — is correct and
  DELIBERATELY left: those sections describe what was true at their release. Rewriting them would
  falsify the history. Ruling 26.

FINAL STATE: 41 commits, 85 files. Backend 73 files / 558 tests. Web 59 files / 320 tests.
  Typecheck clean. Working tree clean. Merge-ready pending the two operator actions below.
