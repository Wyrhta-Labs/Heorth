# M365 Connections UI and Admin Quarantine — Design

**Date:** 2026-08-04
**Status:** Approved, ready for implementation planning

## Problem

Two related gaps:

1. **No UI for connecting a Microsoft 365 account.** The backend M365 delegated
   OAuth flow has existed since Phase 2 (`src/m365/routes.ts`), but nothing in the
   web app can start it, show its state, or disconnect. A member has no way to
   connect their calendar and To Do lists.
2. **The maintenance admin leaks into daily business.** The seeded `admin` account
   is a maintenance login, not a household person, yet it appears in member
   pickers (calendar owner, dashboard row, Hearth wall) and can own household
   items. It is also deletable once a second admin exists.

## Scope

- A personal `/profile` page with a provider-agnostic "connected accounts" surface.
- An admin-only household-wide connections overview.
- The backend deltas the browser OAuth hand-off requires.
- Removal of the maintenance admin from every household-facing surface, enforced
  server-side, plus making that account undeletable and env-anchored.

Out of scope: adding a second provider (Google, CalDAV). The design makes room for
one; it does not build one.

---

## A. Connect flow and backend deltas

The web client sends `Authorization: Bearer` from `localStorage`, so the browser
cannot navigate to the auth-guarded `GET /m365/connect` redirect — the header would
not travel with a top-level navigation. Three changes in `src/m365/routes.ts`:

1. **`GET /m365/connect-url`** (auth) returns `ok(c, { url })` — the signed Microsoft
   consent URL built exactly as `/connect` builds it (`signConnectState` +
   `delegated.authorizeUrl`). The UI fetches it and assigns
   `window.location.href = url`. `/connect` is left in place unchanged; it remains
   valid for non-browser and dev use.
2. **`/callback` redirects to `/profile`** rather than `/`:
   - success → `302 /profile?connected=m365`
   - consent denied, invalid state, or exchange failure → `302 /profile?connectError=<CODE>`
     where `<CODE>` is the existing error code (`M365_CONSENT_DENIED`,
     `M365_CALLBACK_INVALID`, `M365_STATE_INVALID`, `M365_EXCHANGE_FAILED`).

   Today those failures return a JSON error body, which lands as raw JSON in a
   browser tab. Redirecting keeps the member inside the app. No error detail beyond
   the code crosses the redirect — the existing rule that failure details may
   reference token material is preserved.
3. No change to `GET /m365/status`, `DELETE /m365/connection`, or `POST /m365/sync`.

The admin overview needs member display names alongside `memberId`; the web joins
`connections` with `useMembers()` client-side, so `/status` keeps its current shape.

## B. `/profile` page and the provider registry

**Routing.** A new `/profile` route under `authRoute` in `web/src/app.tsx`, with
`PAGE_TITLES['/profile'] = 'nav.profile'` in `app-shell.tsx`. It is deliberately not
added to the sidebar or mobile nav — the entry point is the top bar: the avatar and
display name in `components/layout/top-bar.tsx` become a `<Link to="/profile">`. The
sign-out button stays where it is, so no dropdown-menu primitive is needed.

**Provider registry.** `web/src/lib/providers.ts` exports a `PROVIDERS` array. Each
entry describes one provider:

```ts
interface ConnectionProvider {
  id: string;                                  // 'm365'
  nameKey: string;                             // i18n key
  descriptionKey: string;
  capabilities: ('calendar' | 'tasks')[];
  icon: LucideIcon;
  api: ProviderApi;                            // adapter, see below
}

interface ProviderApi {
  useStatus: () => { connection: ProviderConnection | null; available: boolean; isLoading: boolean };
  getConnectUrl: () => Promise<string>;
  disconnect: () => Promise<void>;
}
```

M365 is the only entry. Adding a provider means adding an entry plus its adapter —
no change to the rendering component.

**Rendering.** `components/profile/provider-card.tsx` renders one entry generically
and handles four states:

| State | Trigger | UI |
|---|---|---|
| not available | `/m365/status` 404s (integration disabled server-side) | muted card, "not available on this server", no action |
| not connected | status 200, `connection` is `null` | description + **Connect** |
| connected | `connection.status === 'active'` | account UPN, capability chips, last refresh, **Disconnect** |
| needs re-auth | `connection.status !== 'active'` | warning styling, `lastRefreshError`, **Reconnect** |

The disabled-integration 404 is treated as "not available", never as an error toast —
matching how `web/src/api/m365.ts` already documents the disabled case.

**API layer.** `web/src/api/m365.ts` grows `getM365ConnectUrl()` and
`disconnectM365()`; a thin `m365ProviderApi` object adapts them (plus a
`useM365Status` hook) to `ProviderApi`.

**Search params.** On mount `/profile` reads `?connected=` / `?connectError=`, raises
the corresponding success/error toast, invalidates the M365 status query, and
replaces the URL without the param so a reload does not re-toast.

## C. Household › Connections (admin only)

A fourth tab in `web/src/pages/household.tsx`, rendered only when
`whoami.role === 'admin'`. Three panels in
`components/household/connections-panel.tsx`:

1. **Connections table** — member display name, provider, account (UPN), status,
   last successful refresh. Read-only: OAuth consent is personal, so there is no
   connect-on-behalf. Members without a connection are not listed.
2. **Feed health** — the `feeds[]` array from `/m365/status`: feed key, last success,
   last error, consecutive failures. Rows with `consecutiveFailures > 0` or a stale
   `lastSuccessAt` are visually flagged so a silently dead feed is obvious.
3. **Sync now** — `POST /api/v1/m365/sync` (already admin-gated), reporting the
   per-feed result summary in a toast and refetching status.

## D. Hiding the admin from the UI

The maintenance admin is not a household person, so it is excluded from every
household-facing member surface.

**Shared hook.** `useHouseholdMembers()` in `web/src/hooks/use-household.ts` wraps
`useMembers()` and filters `role !== 'admin'`. It becomes the default for all
daily-business code. The raw `useMembers()` survives for exactly two consumers: the
household members table and the admin connections join.

**Call sites switched to `useHouseholdMembers()`:**

- `components/calendar/event-form.tsx` — the attendee picker. Note the form has no
  owner field: its schema carries only `attendeeIds`
  (`web/src/components/calendar/event-form.tsx:25`) and `events.created_by` is taken
  from the authenticated principal server-side (`src/modules/calendar/routes.ts:35`).
  So the UI change is attendee filtering only; creator quarantine is server-side.
- `components/dashboard/members-row.tsx`
- `pages/hearth.tsx` — wall columns and the `membersById` map

**Admin-only tabs** (API Keys, Settings, Connections) are hidden from non-admins
rather than rendered-but-disabled. The Members tab remains visible to everyone,
read-only for non-admins as today.

**Role labels.** The `Admin` entry in `ROLE_OPTIONS` stays, used only by the
members-table role select. `member-form.tsx` already excludes it via `MemberRole`.

**Consequences named deliberately:** `pages/hearth.tsx` keeps a fallback in the
`membersById` lookup so a pre-existing admin-owned event still renders rather than
crashing on a missing key; and if the admin is the only account, `MembersRow` and the
Hearth wall show their empty state.

## E. The maintenance admin account

**Identity anchor: `handle`, not email.** `isMaintenanceAdmin(user) =>
user.handle === MAINTENANCE_ADMIN_HANDLE` (the constant `'admin'`), in a new
`src/household/maintenance-admin.ts`. No schema change — adding a column is not
viable, since `users` is owned by `@wyrhta/core`, a pinned tag dependency, and Heorth
must not diverge its schema.

Handle is the right anchor because it is **stable and unique**:
`users_handle_unique` (`src/db/migrations/0000_watery_namora.sql:34`) and
`seedAdmin()` hardcodes `handle: 'admin'` (`src/index.ts:24`), independent of env.

Email was the obvious candidate and is **wrong**, for two reasons found in review:

1. **Rotation orphans the old account.** `ADMIN_EMAIL` is a credential, not an
   identity. Anchoring on it means changing `ADMIN_EMAIL` seeds a *second* admin and
   silently demotes the old one to an ordinary, deletable, un-quarantined admin that
   can own household items — the exact state this design exists to prevent.
2. **First-boot ambush.** `seedAdmin()` returns if *any* row has that email
   (`src/index.ts:21`), regardless of role. A pre-existing ordinary member whose
   email happens to match would inherit the maintenance marker and be quarantined out
   of their own household.

With the handle anchor, `ADMIN_EMAIL` becomes purely a credential synced onto the
anchored row, and rotating it is an in-place update of that row — no second account,
no orphan.

**Handle protection.** `handle` is settable through the member API
(`src/household/validators.ts:12`). Creating or updating any member with
`handle === 'admin'` is rejected with `403 ADMIN_PROTECTED`, so the anchor cannot be
claimed or moved. (The `UNIQUE` constraint already makes it unclaimable once seeded
at first boot; this closes the pre-seed window and gives a clear error instead of a
constraint violation.)

**Boot integrity check.** If the anchored row exists but its role is not `admin`,
`seedAdmin()` restores it. If no anchored row exists but a row already holds
`ADMIN_EMAIL`, boot fails loudly rather than guessing — that is an operator error
(pre-existing member colliding with the configured admin address), not something to
paper over.

**Protected against removal and alteration**, in `src/household/routes.ts` /
`service.ts`:

- `DELETE /members/:id` → `403 ADMIN_PROTECTED` when the target is the maintenance
  admin. Checked *before* the existing `LAST_ADMIN` rule, which stays in force for
  ordinary admins.
- `PATCH /members/:id/role` → `403 ADMIN_PROTECTED`; the account cannot be demoted
  out of `admin`.
- `PATCH /members/:id` → email and handle changes on the maintenance admin are
  rejected with `403 ADMIN_PROTECTED`; its credentials are managed by env alone.
  Display name and avatar colour remain editable.

**Env-driven credentials.** `ADMIN_EMAIL` and `ADMIN_PASSWORD` already exist in
`src/config/env.ts` and are required, so the login is not a fixed target. `seedAdmin()`
**re-syncs both onto the anchored row on every boot** when they differ, making env the
genuine source of truth rather than first-boot-only values. Accepted consequence: an
out-of-band credential change is reverted on restart — correct for a maintenance
account. Email re-sync is what makes `ADMIN_EMAIL` rotation safe under the handle
anchor.

`displayName: 'Admin'` is unchanged — it is not a credential (login is by email only,
`authRouter.post('/token')`), and it is what the members list should show.

## F. Quarantine: no household item may be owned by the admin

A single guard, `assertNotMaintenanceAdmin(memberId)`, applied at the **service**
layer so REST and MCP are both covered by one implementation. Every rejection is
`403 ADMIN_NOT_A_MEMBER` with one shared message.

**Guarded paths:**

- **Calendar** (`src/modules/calendar/service.ts`) — reject if the maintenance admin
  appears in `attendeeIds` (`src/modules/calendar/validators.ts:13,28` — the
  `event_attendees` write) or is the acting creator (`events.created_by`) on create
  or update.
- **Meals** (`src/modules/meals/service.ts`) — reject the maintenance admin as recipe
  `created_by`, **and** as `cook` or `helper` on `upsertPlanEntry`. Those two are real
  member FKs (`src/modules/meals/schema.ts:33-34`) accepted by both REST
  (`src/modules/meals/validators.ts:25-26`) and MCP (`src/modules/meals/mcp.ts:47`) —
  meal duty is exactly the daily business the admin must stay out of. The web UI does
  not currently expose a cook/helper picker, so this is a server-side-only gap and
  needs no UI change today.
- **Tasks** (`src/modules/tasks/service.ts`) — tasks have no free assignee field:
  ownership is derived entirely from the To Do feed owner, so the enforcement points
  are `listAvailableLists`, `setAllowlist`, and the outward-create path, all of which
  reject the maintenance admin. Because that account can never connect M365 (see
  Connections below), no admin-owned feed can come into existence in the first place;
  these guards are defence in depth.
- **Connections** — `GET /m365/connect-url` and the M365 `/callback` reject the
  maintenance admin. For LibraryThing and Trakt the guard goes **inside
  `src/modules/library/service.ts`** (`createLibraryThingConnection`,
  `pollTraktDevice`), not in `routes.ts`: those services insert whatever `memberId`
  they are handed (`service.ts:35`, `service.ts:58`), so a route-only guard would
  leave a direct service-call path to an admin-owned connection. This is the same
  service-layer rule the rest of this section follows.
- **Feoh (finance)** — the satellite proxy lets admins write
  (`requireRole('admin', 'adult')`, `src/satellites/feoh/proxy.ts:42`), injects the
  acting principal as a transaction's `createdBy`
  (`transformRecordTransaction`, `proxy.ts:109`), and the roster mirrors *every*
  member into Feoh as a party (`src/satellites/feoh/roster.ts:80`). Finance is
  household business, so: reject maintenance-admin writes through the proxy, reject
  it as a split participant, and exclude it from `roster.sync()` / `upsertMember` so
  no Feoh party is created for it at all.

The admin retains full access to everything administrative: members, household
settings, API keys, the connections overview, and `POST /m365/sync`.

**Web side.** `/profile` renders a plain explanatory card instead of provider cards
when the session is the maintenance admin, so the 403 is never reached by clicking.

**Auth-path independence.** Because every guard lives in the service layer and keys
on a member id, it holds regardless of how the caller authenticated — JWT session,
MCP tool call, or an API key issued to the admin (`api_keys.user_id`, core-owned).
There is no separate API-key bypass to close.

**Boot-time repair**, idempotent, extracted as an exported
`repairMaintenanceAdmin({ db, adminEmail, adminPassword })` in
`src/household/maintenance-admin.ts` and called by `seedAdmin()` after the seed.
Extracting it is what makes it testable: `seedAdmin()` is currently a private
function in `src/index.ts:20`, and `config` is parsed at module load
(`src/config/env.ts:87`), so a test cannot re-run it under a changed `ADMIN_PASSWORD`
without module-state surgery. Taking its inputs as parameters sidesteps that
entirely. The repair steps:

1. Delete the admin's `event_attendees` rows. An event left with no attendees is a
   valid household/family item; it is not deleted.
2. Repoint `events.created_by` and `recipes.created_by` from the admin to the oldest
   non-admin member, and set `meal_plan_entries.cook` / `.helper` to `NULL` wherever
   they reference the admin (both columns are nullable with `ON DELETE set null`, so
   clearing is the schema's own notion of "unassigned" — no repointing needed).
3. Delete any `m365_connections`, `library_connections`, `todo_list_allowlist`,
   `task_mirror`, and admin-scoped `calendar_mirror_events` rows for the admin, plus
   the corresponding `m365_sync_state` rows for its feed keys. Mirror rows are
   derived data — deleting them loses nothing that a re-sync could not rebuild, and
   leaving them would keep admin-owned items on the wall.

If the household has no non-admin member yet, step 2 is skipped — there is nothing to
point at — and it runs on a later boot once a member exists. Steps 1 and 3 always run.

## G. Testing

**Backend** (real Postgres, existing fake-Graph runtime seam — no network):

- `GET /m365/connect-url` requires auth and returns a Microsoft authorize URL;
  404s when the integration is disabled.
- `/callback` redirects to `/profile?connected=m365` on success and
  `/profile?connectError=<CODE>` on each failure branch.
- Each quarantined service path returns `403 ADMIN_NOT_A_MEMBER` for the maintenance
  admin and succeeds for a normal member.
- `DELETE /members/:id` and `PATCH /members/:id/role` on the maintenance admin return
  `403 ADMIN_PROTECTED`; both still work on an ordinary member.
- Repair test: seed admin-owned `event_attendees` / `created_by` / `cook` / `helper` /
  connection rows, call `repairMaintenanceAdmin(...)` directly, assert the repair; call
  it twice, assert idempotence; assert the no-non-admin-member case skips the
  `created_by` repointing without error.
- `repairMaintenanceAdmin` re-syncs a changed `ADMIN_PASSWORD` and a changed
  `ADMIN_EMAIL` onto the handle-anchored row, creating no second admin.
- Creating or updating a member with `handle: 'admin'` returns `403 ADMIN_PROTECTED`.
- Boot fails loudly when `ADMIN_EMAIL` is held by a row that is not the anchored admin.

**Web** (Vitest):

- `provider-card.tsx` renders each of its four states correctly.
- The Connections tab is present for an admin session and absent for a non-admin.
- Regression: the maintenance admin is absent from the event-form picker, the
  dashboard members row, and the Hearth wall, but present in the members table.
- `/profile` turns `?connected=m365` into a success toast and `?connectError=` into an
  error toast, and clears the param.

## Files touched

**Backend:** `src/m365/routes.ts`, `src/household/maintenance-admin.ts` (new),
`src/household/routes.ts`, `src/household/service.ts`, `src/household/validators.ts`,
`src/index.ts`, `src/modules/calendar/service.ts`, `src/modules/meals/service.ts`,
`src/modules/tasks/service.ts`, `src/modules/library/service.ts`,
`src/satellites/feoh/proxy.ts`, `src/satellites/feoh/roster.ts`.

**Web:** `web/src/app.tsx`, `web/src/components/layout/top-bar.tsx`,
`web/src/components/layout/app-shell.tsx`, `web/src/pages/profile.tsx` (new),
`web/src/components/profile/provider-card.tsx` (new), `web/src/lib/providers.ts` (new),
`web/src/api/m365.ts`, `web/src/hooks/use-household.ts`,
`web/src/pages/household.tsx`, `web/src/components/household/connections-panel.tsx` (new),
`web/src/components/calendar/event-form.tsx`,
`web/src/components/dashboard/members-row.tsx`, `web/src/pages/hearth.tsx`,
`web/src/i18n/locales/en.json`, `web/src/i18n/locales/de.json`.
