# Google as a Second Calendar & Tasks Provider — Design

**Date:** 2026-08-29
**Status:** Draft (awaiting review)
**Branch:** `features/connect-google`
**Relates to:** ADR 0001 (external systems of record behind providers), ADR 0014 (Weorc)

## Goal

Add Google (Calendar + Tasks) as a **second** calendar and task provider, running
**side by side** with Microsoft 365 at full feature parity. A household may have
one member on M365 and another on Google, or one member on both.

ADR 0001 named Google as the planned second provider and built the
`CalendarProvider` / `TaskProvider` seams for exactly this. Those seams hold up.
Everything *around* them does not: connections, sync state, feed keys, the
runtime, the scheduler, the routes and the config are all M365-shaped singletons.
So this is two pieces of work, in order:

1. **Phase 1 — a pure refactor** extracting a provider-neutral `src/integrations/`
   layer. No behaviour changes.
2. **Phase 2 — the Google provider** on top of it.

Both land on `features/connect-google`, as two clearly separated stretches of
commits, so the refactor is reviewable and verifiable on its own.

A third section below — **Phase 3** — is not a third stretch of work. It is two
deliberate behaviour changes that ride along with **Phase 1's** migration
(designation-by-flag, and the truncate-on-full-resync fix), documented separately
only because they are the parts of Phase 1 that are *not* pure refactoring. Phase
1's "no assertion changes" verification rule applies to the refactor, not to
these two.

**Suggested plan split:** Phases 1+3 as one implementation plan, Phase 2 as a
second. They have different verification stories — one is "prove nothing changed",
the other is "prove the new thing works".

## Decisions (from brainstorming, 2026-08-29)

- **Side by side**, not one-per-household and not a replacement. Provider-scoped
  connections, provider-prefixed feed keys, a provider registry.
- **Full parity**: Google ships calendar mirror *and* tasks with write-back.
- **Extract a shared integrations layer** rather than adding a `provider` column
  in place or duplicating `google_*` tables. One copy of the machinery, one
  `/status` surface for the Hearth View.
- **Google's family calendar is a delegated feed**, designated on one member's
  connection. No Workspace service account, no domain-wide delegation — it must
  work for consumer Gmail.
- **A member allowlists which calendars sync**, mirroring `todo_list_allowlist`.
  Nothing syncs by default.
- **The shared household task list moves to the database** as a flag on the
  allowlist row, not an env var and not a `wyrhta-core` household column.
- **Google Tasks pulls a full snapshot and reconciles against the mirror**
  instead of imitating a delta API.
- **The truncate-on-full-resync bug is fixed for M365 too**, in both mirrors.

## Non-goals

- CalDAV, or any third provider.
- Calendar write-back for either provider (the mirror stays read-only — ADR 0001
  phase 1).
- Migrating existing M365 data to Google, or any cross-provider data movement.
- Changing `@wyrhta/core`. Nothing here needs a new core tag.

---

# Phase 1 — The integrations layer (pure refactor)

## New `src/integrations/`

What is today M365-shaped but behaviourally generic moves out of `src/m365/`:

| File | From | Change |
|---|---|---|
| `schema.ts` | `m365/schema.ts` | `integration_connections`, `integration_sync_state` |
| `store.ts` | `m365/store.ts` | every method gains a `provider` scope |
| `crypto.ts` | `m365/crypto.ts` | moved **verbatim** (see hazard below) |
| `sync-runner.ts` | `m365/sync-runner.ts` | `classify` becomes provider-supplied |
| `scheduler.ts` | `m365/scheduler.ts` | ticks every registered provider |
| `registry.ts` | *new* | providers register runtime + calendar/task impls |
| `routes.ts` | `m365/routes.ts` | provider-scoped connect / callback / disconnect |
| `feed-keys.ts` | `m365/feed-keys.ts` | every key gains a provider segment |

`src/m365/` keeps only what is genuinely Microsoft: `graph.ts`, `delegated.ts`,
`app-only.ts`, `calendar-provider.ts`, `task-provider.ts`, the Graph error
classifier, and a thin `index.ts` that registers them.

**The `src/m365/` containment rule in AGENTS.md still holds** — Graph types and
URLs stay there. `src/google/` gets the identical rule for Google types.

## Hazard: the crypto key derivation is load-bearing

`src/m365/crypto.ts` derives its AES-256-GCM key as:

```
hkdfSync('sha256', config.jwtSecret, 'heorth-m365-v1', 'heorth-m365-tokens', 32)
```

Those two strings are **inputs to the key**, not documentation. If the file moves
to `src/integrations/crypto.ts` and they are "tidied" to say `integration`
instead of `m365`, every stored refresh token becomes undecryptable and every
member must reconnect.

**They move verbatim, with a comment saying why the name is stale.** Google
tokens are encrypted with the same derived key; there is no security argument for
per-provider keys here (same process, same secret, same threat model), and a
second derivation would only add a second thing to get wrong.

## Schema changes

One migration, generated via `npm run db:generate -- --name integrations_layer`
(expected `0023_integrations_layer.sql`). Per AGENTS.md, both
`src/db/schema/drizzle-schema.ts` and `src/db/schema/index.js` must register the
moved tables.

**`m365_connections` → `integration_connections`**

- add `provider text not null default 'm365'`
- `account_upn` → `account_label` (Google has no UPN; `web/src/lib/providers.ts`
  already calls this `accountLabel`)
- drop `unique(member_id)` → `unique(provider, member_id)`

**`m365_sync_state` → `integration_sync_state`**

- `delta_token` → `sync_token` (Google's word, and it was never Graph-specific)

**`todo_list_allowlist`**

- add `provider text not null default 'm365'`
- unique becomes `(provider, member_id, list_id)`
- add `is_household boolean not null default false` (see Phase 3)

**Backfill**

- `provider = 'm365'` on all existing rows (the column default covers this)
- rewrite every `integration_sync_state.feed_key` to its prefixed form:
  `calendar:member:X` → `m365:calendar:member:X`, `calendar:family` →
  `m365:calendar:family`, `todo:member:X:Y` → `m365:todo:member:X:Y`

A reversible `down` is included. The feed-key rewrite is the only part that is
not a pure rename; it must be exact, because an unrewritten key would orphan a
feed's sync state and silently trigger a full re-sync.

## Feed keys

```
m365:calendar:member:<memberId>
m365:calendar:family
m365:todo:member:<memberId>:<listId>
google:calendar:member:<memberId>:<calendarId>
google:todo:member:<memberId>:<listId>
```

Keys are built through `feedKeys` helpers. The provider segment exists to guarantee
uniqueness across providers, and `integration_sync_state` rows are located by exact
key.

> **Corrected 2026-08-30, during implementation.** This paragraph originally claimed
> keys "stay opaque — never parsed". **That was wrong about the existing code**, and
> the error was load-bearing: both Graph providers parse the key back apart to recover
> ids, so adding the provider segment breaks them.
>
> - `src/m365/calendar-provider.ts`: `/^calendar:member:(.+)$/.exec(feedKey)`
> - `src/m365/task-provider.ts`: `/^todo:member:([^:]+):(.+)$/.exec(feedKey)`
>
> Two test fixtures parse positionally as well — `weorc-projection.test.ts` and
> `weorc-task-seam.test.ts` derive a member id via `feedKey.split(':')[2]`, which the
> added segment shifts to `[3]`.
>
> Verified by mutation: leaving `task-provider.ts` stale fails 20 tests in
> `tests/m365-tasks-sync.test.ts`, so the suite catches it loudly rather than letting
> it ship silently.
>
> **What this means for Phase 2:** opacity is the right aspiration, but it is not the
> current reality, and a Google provider must not inherit the habit. `GoogleCalendarProvider`
> and `GoogleTaskProvider` should resolve a feed's member and list from its
> `calendar_allowlist` / `todo_list_allowlist` row — which they already read to enumerate
> feeds — instead of re-parsing the key. Making the M365 providers do the same is worth
> a follow-up, but is deliberately out of scope here: it is behaviour change inside a
> refactor.

## Error classification seam

`sync-runner.ts` currently does `e instanceof GraphError` inside `classify()`.
That is the one real seam violation in the existing code: the runner is
documented as provider-agnostic but is not.

`syncOneFeed` gains a `classifyError: (e: unknown) => string` from the provider's
runtime. The Graph classifier moves to `src/m365/` unchanged; Google supplies its
own. The existing reason tokens (`needs_reauth`, `no_connection`, `graph_<n>`,
`network_error`, `error`, `shared_list_unavailable`, `provider_unavailable`) stay
the contract that REST and MCP status mapping depend on; Google adds `google_<n>`
alongside `graph_<n>`.

The full-resync interval, currently the module constant
`DEFAULT_FULL_RESYNC_INTERVAL_MS` plus a `M365_FULL_RESYNC_INTERVAL_SECONDS` env
read, also becomes provider-supplied.

## Provider registry

`setTaskProvider(provider, sharedName)` — a single global slot — becomes
`registerTaskProvider(source, provider)`, keyed by source. The same for calendar
providers.

The consequence that matters: **`tasks/service.ts` resolves the provider from the
mirror row's `source` column**, not from a global. That is what makes
`setCompleted` on a Google-mirrored task reach Google while the same call on an
M365 row reaches Graph. Today `requireProvider()` returns "the" provider; it
becomes `requireProviderFor(row.source)`.

`getSharedListName()` disappears entirely (Phase 3).

The `get*Runtime()` / `set*Runtime()` test seam described in AGENTS.md is
preserved per provider — `setM365Runtime` keeps working, `setGoogleRuntime` joins
it.

## Routes

`/api/v1/m365/*` retires; the surface becomes provider-scoped:

```
GET    /api/v1/integrations/status                    household-wide, all providers
POST   /api/v1/integrations/sync                      admin, all providers
GET    /api/v1/integrations/:provider/connect         302 to consent
GET    /api/v1/integrations/:provider/connect-url     JSON twin
GET    /api/v1/integrations/:provider/callback        token exchange
DELETE /api/v1/integrations/:provider/connection      disconnect
```

**No deprecation aliases** — decided 2026-08-29. `heorth-mcp` has zero `m365`
references, so nothing outside this repo breaks.

The existing role logic in `/status` is preserved exactly: `feeds[]` is visible to
any authenticated session (no secrets in it, and the Hearth View needs
household-wide staleness on a non-admin kiosk); the household-wide `connections`
list is admin **and** adult; children stay scoped to their own connection. The
`toPublicFeed` projection still never exposes the sync token.

The maintenance-admin quarantine (`assertNotMaintenanceAdmin`,
`isMaintenanceAdminId`) carries over unchanged to both providers, including the
redirect-not-throw behaviour on the callback path.

> **Found 2026-08-30, during Phase 1. A Phase 2 landmine in `src/household/maintenance-admin.ts`.**
>
> `stripAdminOwnedData` cleans up after a quarantined maintenance admin. Two of its steps do not survive a second provider:
>
> 1. **`staleFeedKeys` hardcodes `'m365'`** (`maintenance-admin.ts:167-169`). It builds the admin's calendar and To Do feed keys to delete their sync state, and its own comment says why this matters: *"Without this, a feed the admin had connected leaves a permanently frozen row in `/status`'s `feeds[]` forever."* Once Google exists, exactly that happens to the admin's Google feeds. **Phase 2 must build these keys for every registered provider**, not just M365.
> 2. The `counts` keys are now stale labels — `'m365_connections'` and `'m365_sync_state'` name tables called `integration_connections` and `integration_sync_state`. Operator-visible in the repair output.
>
> Note the connection delete itself (`maintenance-admin.ts:153`) is provider-**un**scoped, deleting by `memberId` alone — and that is **correct**. Stripping the admin's owned data should remove every connection they hold, whatever the provider. The gap runs the other way: the sync-state cleanup is over-scoped to M365. Do not "fix" the connection delete by adding a provider filter.
>
> Not fixed in Phase 1: with only one provider registered, neither issue is reachable, and no test could exercise the fix.

**Operator action, already done:** the Entra app registration's redirect URI was
updated on 2026-08-29. Phase 1 must verify `M365_REDIRECT_URI` in `deploy/.env`
matches the registered value (expected `<base>/api/v1/integrations/m365/callback`)
rather than assuming it.

## Phase 1 verification

Phase 1 changes no behaviour. The 13 M365-touching suites — `m365-calendar-sync`,
`m365-clients`, `m365-crypto`, `m365-env`, `m365-routes`, `m365-store`,
`m365-tasks-sync`, plus `weorc-engine`, `weorc-projection`, `weorc-routes`,
`weorc-task-seam`, `kith-reminders`, `maintenance-admin-repair` — must pass with
**only import-path, route-path and feed-key-fixture edits. No assertion changes.**

If an assertion has to change, the refactor leaked. Stop and report rather than
adjusting the test.

An additional migration test asserts the feed-key rewrite: seed pre-migration
rows, migrate, assert every key carries the `m365:` prefix and no sync state was
orphaned.

---

# Phase 2 — The Google provider

## Config

A `GOOGLE_*` group, all-or-nothing exactly like `M365_*` per the AGENTS.md rule
(schema group + `superRefine` check + `config.google` object):

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

No family-mailbox equivalent (the family calendar is a designated allowlist row)
and no shared-list equivalent (Phase 3 moves it to the database). Absent → the
Google module registers as a no-op, zero impact, per the same rule.

Scopes: `https://www.googleapis.com/auth/calendar.readonly`,
`https://www.googleapis.com/auth/tasks`, and `userinfo.email` for `accountLabel`.

## Hazard: Google only issues a refresh token once

Google returns a `refresh_token` **only on the first consent** for a given
client/user pair unless the authorize URL carries **both** `access_type=offline`
and `prompt=consent`. Without them a reconnect yields an access token and nothing
to persist, and the connection dies silently about an hour later — presenting as
"it worked yesterday".

Both parameters go in the authorize URL unconditionally. The callback treats a
response with no `refresh_token` as a hard failure
(`?connectError=GOOGLE_NO_REFRESH_TOKEN`) rather than storing a connection that
cannot survive.

## `GoogleCalendarProvider`

- `listFeeds()` reads `calendar_allowlist` (not Google), so a disconnected
  member's feeds disappear naturally, matching how To Do feeds already work.
- `events.list` with `singleEvents=true` — Google expands recurrence server-side,
  which satisfies the contract's "the provider does the expansion; we never
  reconstruct rules".
- Incremental via `syncToken`; initial and re-windowed pulls use
  `timeMin`/`timeMax`.
- `410 GONE` → drop the token, re-window, return `fullResync: true`. Same shape as
  the Graph 410 path.
- `status: 'cancelled'` → `deletions`; `recurringEventId` → `seriesMasterId`.
- All-day events arrive as `start.date` (no time) rather than `start.dateTime` →
  `allDay: true`. `MirroredInstant.timeZone` takes the per-event `timeZone`.
  Absolute UTC instants are still what gets stored (AGENTS.md data rule).
- **`masterPurges` stays empty.** With `singleEvents=true` Google never delivers a
  series master, so the Graph-specific hazard that field exists for cannot arise
  here.

## `calendar_allowlist`

A sibling of `todo_list_allowlist`, same shape:

```
provider, member_id, calendar_id, calendar_name, is_household
```

- `unique(provider, member_id, calendar_id)`
- **`is_household boolean`** designates the shared family calendar. A partial
  unique index allows at most one `true` household-wide.
- Discovery: `GET /api/v1/calendar/calendars` (the acting member's calendars, each
  flagged allowlisted or not) and `PUT /api/v1/calendar/allowlist`, mirroring the
  existing `/tasks/lists` and `/tasks/allowlist` routes.

**Feed keys stay member-scoped and stable** —
`google:calendar:member:<id>:<calendarId>` — whether or not the row is the
household one. `is_household` controls only *attribution*: the provider emits
`kind: 'family'` and `memberId: null`, so mirrored rows render as shared rather
than as that member's.

Toggling `is_household` changes every mirrored row's attribution, so the toggle
clears that feed's sync token to force one full re-sync.

**Consequence to accept:** if the designated member disconnects, the family feed
stops until an admin designates another. This is the price of not requiring
Workspace domain-wide delegation, and it is surfaced on the status endpoint.

## `GoogleTaskProvider` — snapshot, not delta

**Google Tasks has no delta API.** The obvious move is to imitate one with
`updatedMin` + `showDeleted`. That was the original design and it was wrong:

- `updatedMin` reports what changed, but deletions surface only via `showDeleted`
  and only while Google retains the tombstone. Past retention, a task deleted on a
  phone stays mirrored **forever**.
- Task lists are small — tens of items, `tasks.list` pages at 100 — so a full pull
  is 1–2 API calls per feed. At a 5-minute tick with four feeds that is roughly
  1,150–2,300 calls/day, far below default project quota.

So the provider **always pulls the complete list and reconciles against the
mirror**. A row we hold that the list does not contain is deleted, structurally,
with no tombstone required. This removes the fake sync token, the 410-equivalent
recovery path, drift, and any full-resync-interval tuning — every pull is already
a full pull.

- `tasks.list` with `showCompleted=true&showHidden=true`, paged to exhaustion.
  **Both flags are required:** Google hides completed tasks by default, so without
  them a completion would look like a deletion to the reconciler.
- `pullChanges` ignores `syncToken` entirely and returns `fullResync: true` on
  every pull (see Phase 3 — `fullResync` means "this payload is the whole feed",
  and the store reconciles rather than truncating).
- `due` is date-only in effect (Google stores UTC midnight and ignores the time
  part) → converted to household-local midnight, as the Graph provider already
  does.
- `completed` is a real RFC3339 instant, so Google is *better* than To Do here; no
  coarsening is needed and none should be applied.
- Writes: `tasks.patch` for `setCompleted`, `tasks.insert` for `createTask`.
  Errors map through `GoogleApiError` to the same classified `TaskProviderError`
  reasons, so REST/MCP status mapping is unchanged.

## Web

The existing `PROVIDERS` registry in `web/src/lib/providers.ts` was built for this
and needs no re-architecture — Google is a second entry.

- `web/src/api/google.ts` and `web/src/hooks/use-google.ts`, mirroring the M365
  adapters, mapping onto the existing provider-neutral `ProviderConnection` /
  `ProviderState`.
- `web/src/api/m365.ts` and `use-m365.ts` are repointed at the new
  `/api/v1/integrations/*` paths.
- A calendar picker alongside the existing To Do list picker, including the "this
  is the household calendar" designation (admin/adult only).
- `en.json` / `de.json` keys for both.

## Tests

`tests/fake-google.ts`, a sibling of `tests/fake-graph.ts`, installed through
`setGoogleRuntime`. Per AGENTS.md, **no test may reach a real external service**,
and the scheduler never runs under tests.

New suites: `google-calendar-sync`, `google-tasks-sync`, `google-clients`,
`google-routes`, `google-env`, mirroring the M365 ones.

Cases that earn their own tests because they are where this design is most likely
to be got wrong:

- a task deleted at the source with no tombstone disappears from the mirror on the
  next snapshot reconcile
- a completed task is **not** treated as deleted (the `showHidden` trap)
- a reconcile preserves `task_mirror.id` for surviving rows
- a connect flow with no `refresh_token` fails loudly instead of storing a doomed
  connection
- toggling `is_household` re-attributes a feed's mirrored rows
- an M365 member and a Google member can both sync without feed-key collision

---

# Phase 3 — Designation by flag (folded into Phase 1's migration)

## The shared household task list moves to the database

Today `resolveSharedFeed()` (`src/modules/tasks/service.ts:137-156`) resolves the
shared list **by display name** from `M365_SHARED_TODO_LIST`, matching against
every member's allowlist and tie-breaking with "prefer the acting member, else
`entries[0]`".

That is fragile in a way that already bites: **a member renaming the list in
Outlook silently breaks household task creation**, which silently breaks Weorc's
projected maintenance tasks. With two providers it gets worse — an arbitrary
tie-break could route a task to either provider.

Replace it with the same designation mechanism the family calendar uses:
**`todo_list_allowlist.is_household`**, a partial unique index allowing at most one
`true` household-wide. `resolveSharedFeed()` selects the flagged row.

This deletes:

- `M365_SHARED_TODO_LIST` from the env group (which becomes five vars, and the
  `superRefine` all-or-nothing list shrinks accordingly)
- `findAllowlistByName()` and the name matching
- `getSharedListName()` and the shared-name half of the provider seam
- the acting-member tie-break — one designated row means outward creates always go
  through the same connection, predictably

No new table, no new settings surface, and **no `wyrhta-core` change** — the
`household` table is core's, so a household *column* would mean a new core tag and
a dependency bump for a one-field setting. The flag belongs to the tasks module
anyway.

The admin toggle is a radio button in the To Do list picker that already exists.

**Migration + backfill.** `0023` sets `is_household = true` on the allowlist row
whose `list_name` matches the deployment's current `M365_SHARED_TODO_LIST`. If
nothing matches — the list was renamed, or nobody allowlisted it — no row is
flagged and `createHouseholdTask` throws `shared_list_unavailable`. That is the
same error as today in that situation, so it is not a regression, **but it
silently disables Weorc's projection.**

So: a boot-time warning and a field on `GET /api/v1/integrations/status` when no
household list is designated. Per AGENTS.md, an absent provider writes no
`projectionError` and is a normal state; *no designated household list while a
provider is connected* is different, and should be visible.

## The truncate-on-full-resync fix, for both providers

`applyTaskPull` implements `fullResync` as `DELETE WHERE feed_key` then re-insert
(`src/modules/tasks/store.ts:50-52`). Every mirror row's uuid changes.

The codebase already knows: `weorc/schema.ts:51` — *"The task link is (feedKey,
externalId), NEVER task_mirror.id: a full resync deletes and re-inserts a feed's
mirror rows."* Weorc routed around it. **The REST surface did not**:
`GET /api/v1/tasks` returns those ids and the web holds them, so a
`/:id/complete` between a fetch and a click 404s.

Today that window opens weekly. With Google snapshotting every tick it would open
every five minutes — a flaky bug, the worst kind.

**No new flag is added.** An earlier draft introduced a separate `snapshot: true`
alongside `fullResync`, which was redundant — both would have meant the same thing
to the store, and two flags for one concept is exactly the kind of ambiguity that
gets implemented inconsistently. Instead, `fullResync: true` keeps its existing
meaning and gains a better implementation:

```
fullResync: true   // upserts[] IS the complete current contents of the feed
```

The stores reconcile instead of truncating: upsert everything present, then
`DELETE WHERE feed_key = ? AND external_id NOT IN (...)`. Same end state, but **row
ids survive**, so a mirrored task's `id` is stable for as long as the task exists
at the source.

`GoogleTaskProvider` therefore sets `fullResync: true` on **every** pull. The only
side effect is that `lastFullSyncAt` is stamped every tick, which is simply true
for that provider.

Applied to **both** mirrors:

- `applyTaskPull` — Graph's 410 recovery and periodic re-sync get stable ids too.
- `applyMirrorPull` — the calendar mirror has the identical truncate. The not-seen
  delete must run **before** the `seriesMasterId` cascade and `masterPurges`, not
  instead of them, so the existing series-deletion semantics are preserved.

Because a re-windowed calendar snapshot contains only events inside the window,
reconcile also correctly drops events that aged out of the past edge — exactly what
the truncate achieved, without churning ids.

Folding the M365 half in was decided 2026-08-29: leaving one mirror truncating
while the other reconciles would be worse than either consistent choice.

---

# Documentation to update

- **`AGENTS.md`** — the "Microsoft 365 rules" section becomes a provider-neutral
  "Integrations" section: the containment rule applies to `src/m365/` **and**
  `src/google/`; `setTaskProvider` becomes the registry; the feed-key reference
  moves; the `M365_*` group gains `GOOGLE_*`; the note that Weorc stores
  `(feedKey, externalId)` "because a full resync re-inserts rows" needs revising
  once reconcile lands — the reason changes, the rule stays.
- **`README.md`** — the `GOOGLE_*` group, the new route surface, the Google Cloud
  console setup (OAuth consent screen, redirect URI, enabling the Calendar and
  Tasks APIs), and the household-list designation replacing
  `M365_SHARED_TODO_LIST`.
- **Meta repo `docs/decisions/`** — ADR 0001 predicted this but did not decide the
  shape. Worth a short ADR recording provider-scoped connections, the
  snapshot/reconcile pull mode, and designation-by-flag. That commit belongs in the
  **meta** repo, not here.
- **`deploy/.env`** — `GOOGLE_*` for the dev stack (meta repo).

# Open questions

None blocking. Two things to confirm during implementation rather than guess:

1. The exact registered Entra redirect URI, checked against `M365_REDIRECT_URI`
   before phase 1 merges.
2. Whether the dev stack's Google OAuth client can use a `localhost` redirect, or
   needs a tunnelled host — a Google Cloud console constraint, not a code one.
