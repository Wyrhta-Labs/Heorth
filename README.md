# Heorth

The flagship self-hosted household system in the Wyrhta Labs stack: household
membership, calendar, meal planning, and a media/book library, built with
Node.js 22 + TypeScript, Hono, Drizzle ORM, PostgreSQL 16, Zod, and Vitest.
Finance is not in-process — it is proxied to the independent **Feoh**
satellite service (its own repo and database); see
[Finance (Feoh satellite)](#finance-feoh-satellite) below.

## Quick start

Copy `.env.example` → `.env` and fill in real values:

```
DATABASE_URL=postgres://heorth:<password>@localhost:5432/heorth
JWT_SECRET=<32+ char random string>
HOUSEHOLD_NAME=Our Home
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<password>
API_PORT=4000
JWT_TTL_SECONDS=604800
CORS_ORIGIN=*
DB_POOL_MAX=10
POSTGRES_PASSWORD=<password>

# Feoh satellite — required, both production and test
FEOH_BASE_URL=http://localhost:4001
FEOH_API_KEY=fe_change-me
```

`FEOH_BASE_URL`/`FEOH_API_KEY` point at a running Feoh instance and the
service API key Feoh issued for Heorth (`POST /api/v1/auth/keys` on Feoh).
Both are required at startup — `src/config/env.ts` validates the full set
with Zod and exits the process if anything is missing or malformed.

```bash
npm install
npm run docker:up      # API + PostgreSQL 16 via docker-compose.yml
# or, with your own Postgres running and DATABASE_URL pointed at it:
npm run dev             # API only (tsx watch src/index.ts)
npm run dev:all          # API + web dev server concurrently
```

Other scripts (`package.json`): `build` / `build:web` (compile), `start`
(run compiled output), `typecheck`, `db:generate` / `db:migrate` / `db:push`
/ `db:studio` (Drizzle, run via `tsx`), `docker:down`, `docker:reset`.

On boot, `bootstrap()` (`src/index.ts`) runs migrations, seeds the household
+ admin user (both idempotent), and best-effort syncs the member roster into
Feoh — a Feoh that's down at boot is logged and skipped, not fatal; the
finance proxy re-syncs lazily on first use (see below).

## API surface

REST is mounted under `/api/v1`, one router per module (`src/modules/index.ts`
lists `ALL_MODULES`):

| Prefix | Module | Notes |
|---|---|---|
| `/api/v1/household`, `/api/v1/members`, `/api/v1/auth` | `src/household/` | Household singleton, member CRUD/roles, login, `he_` API keys |
| `/api/v1/events` | `src/modules/calendar/` | Calendar with server-side recurrence expansion |
| `/api/v1/recipes`, `/api/v1/meals` | `src/modules/meals/` | Recipes, weekly meal plan, shopping list |
| `/api/v1/library` | `src/modules/library/` | Book/media library; Trakt + LibraryThing connectors |
| `/api/v1/tasks` | `src/modules/tasks/` | Household tasks backed by Microsoft To Do — list/complete/create + per-member list allowlist (writes need M365 enabled) |
| `/api/v1/feoh/*` | `src/satellites/feoh/` | Transparent proxy to the Feoh satellite (see below) — not a `HeorthModule`, mounted directly in `src/app.ts` |
| `/api/v1/m365/*` | `src/m365/` | Microsoft 365 connection flow — **only mounted when configured** (see below); absent otherwise |

`/mcp` (mounted in `src/index.ts`) exposes one MCP-over-HTTP server
(`@wyrhta/core`'s scaffold) assembling every module's tool registry plus a
`household.*` set, authenticated the same way as REST (`he_` API key or JWT).
Feoh's own finance MCP tools live on **Feoh's** `/mcp`, not Heorth's — they
were removed from Heorth's registry when finance was extracted (see
`CHANGELOG.md`).

The React web UI (`web/`) is served as static files from `web/dist` for any
unmatched non-API route.

## Finance (Feoh satellite)

Finance used to be an in-process module; it is now the independent **Feoh**
service, with Heorth mounting a transparent request proxy at the same
`/api/v1/feoh/*` paths (`src/satellites/feoh/`):

- `client.ts` / `satellite-client.ts` — thin HTTP client, service-API-key
  authenticated.
- `roster.ts` — maintains the Heorth-member ↔ Feoh-party id mapping
  (`FeohRoster`); syncs once at boot, lazily re-syncs (deduped across
  concurrent misses) on a cache miss, and is best-effort re-upserted right
  after a member's `displayName` changes (`household/service.ts#updateMember`
  — the one choke-point for member profile edits). Outside of those three
  paths, a renamed member's Feoh party can go stale until one of them fires —
  a known, accepted limitation, not a bug.
- `proxy.ts` — the router: forwards requests/responses verbatim except for
  the member-boundary fields (`createdBy`, split `memberId`/`partyId`).
  A Feoh 4xx/5xx passes through with its own envelope and status; an
  unreachable Feoh becomes Heorth's `503 SERVICE_UNAVAILABLE`; a roster
  mapping still missing after a successful re-sync becomes a
  `500 ROSTER_MAPPING_MISSING` (a different condition from "Feoh is down" —
  see the docstring in `proxy.ts`).

## Microsoft 365 (optional integration)

Heorth can mirror the household's M365 calendars and sync Microsoft To Do
(Phase 2). The foundation lives in `src/m365/` — the **only** place Graph
types and URLs appear. It is **optional as a group**: set all six `M365_*`
variables to enable it, or none to leave it fully disabled.

```
# Microsoft 365 — all six or none (partial config is a startup error)
M365_TENANT_ID=<tenant guid>
M365_CLIENT_ID=<app registration client id>
M365_CLIENT_SECRET=<client secret>
M365_REDIRECT_URI=http://localhost:4000/api/v1/m365/callback
M365_FAMILY_MAILBOX=family-calendar@example.com   # shared mailbox (app-only)
M365_SHARED_TODO_LIST=Household                    # write-target To Do list

# Optional, INDEPENDENT of the group above (a tuning knob, not a credential):
M365_SYNC_INTERVAL_SECONDS=300                      # mirror poll interval; floored at 60
```

- **Disabled (default):** when the group is absent, the M365 module registers
  as a no-op — no routes are mounted, so `/api/v1/m365/*` returns the app's
  catch-all `404`. Zero impact on boot, existing routes, or tests.
- **Enabled:** the connection routes mount at `/api/v1/m365`:
  - `GET /connect` (auth) → 302 to Microsoft consent; the `state` is a signed
    token binding the flow to the acting member.
  - `GET /callback` → exchanges the code, resolves the account via `/me`, and
    stores the **encrypted** refresh token (one row per member).
  - `GET /status` (auth) → the acting member's connection + last errors and
    **per-feed sync state** (feed key, last success, last error, consecutive
    failures — the delta token is never exposed); admin sees all connections and
    all feeds. This is the data the Hearth View staleness badges (Task 2.5) read.
  - `POST /sync` (admin) → runs all calendar feeds then all To Do feeds once and
    returns the combined per-feed result summary; used by dev/tests to drive sync
    without the scheduler.
  - `DELETE /connection` (auth) → the acting member disconnects (row deleted).
- **Read-only calendar mirror (Task 2.2):** a background poll
  (`M365_SYNC_INTERVAL_SECONDS`, default 300, floored at 60) pulls each connected
  member's **default calendar** (delegated) and the **family mailbox** (app-only)
  via Graph `calendarView/delta` over a rolling window (−60d … +400d). A delta
  token replays the SAME window it was minted with — it does not itself widen
  or shift — so the mirror also does a deterministic **full re-window** every
  `M365_FULL_RESYNC_INTERVAL_SECONDS` (default 7 days, independent of the
  `M365_SYNC_INTERVAL_SECONDS` poll cadence), tracked per feed via
  `m365_sync_state.last_full_sync_at`; this is what actually rolls the window
  forward. Recurring events are mirrored as Graph's expanded occurrences (rules
  are never reconstructed). Mirrored events land in a sibling
  `calendar_mirror_events` table and surface in the existing calendar
  range/week/dashboard/MCP queries alongside native events — but are
  **read-only everywhere**: REST and MCP update/move/delete of a mirrored event
  are rejected (`EVENT_READ_ONLY`), and the web renders them with a subtle
  source marker and no edit affordance. Delta tokens + per-feed errors persist
  in `m365_sync_state`; an expired token (`410 Gone`) also triggers a full feed
  re-sync (in addition to the deterministic schedule above), and a connection
  needing re-consent is recorded as `needs_reauth` and skipped (not
  hot-retried). Absolute UTC instants are stored; the source event's own
  timezone is kept as display metadata only (`source_time_zone`) — Heorth does
  not re-localize on write. The scheduler starts at boot only when enabled and
  never runs under tests.
- **Household tasks + To Do sync (Task 2.3):** the Tasks surface
  (`/api/v1/tasks`) is backed by Microsoft To Do as the system of record.
  Sync is **delegated-only** and **allowlist-gated per member** — nothing syncs
  until a member chooses lists (`GET /api/v1/tasks/lists` discovery,
  `GET/PUT /api/v1/tasks/allowlist`); each allowlisted list becomes a feed
  `todo:member:<id>:<listId>` pulled via `/me/todo/lists/{listId}/tasks/delta`
  into a sibling `task_mirror` table (a `410`/periodic full re-sync replaces the
  feed). Unlike the calendar, tasks are **interactive**:
  `POST /api/v1/tasks/:id/complete` writes completion back (optimistic local
  update, sync reconciles) and `POST /api/v1/tasks` creates a task into the
  **shared household list** (`M365_SHARED_TODO_LIST`), resolved BY NAME through a
  connected member who has allowlisted it — preferring the acting member, else
  any member that has it. `GET /api/v1/tasks` lists the mirror with filters
  (status / member / list / due range). All members may read; any authenticated
  member (children included) may complete/create; a write against a
  dead/absent connection returns a **classified** error (409 conflict, or 500
  when the integration is off / an upstream failure), never a crash and never a
  silent drop. MCP: `tasks.list` / `tasks.complete` / `tasks.create`. Task feeds
  join the same scheduler tick and `POST /api/v1/m365/sync` (sequential after
  calendar, same per-feed isolation) and appear in `GET /api/v1/m365/status`.
  Reads work even when the integration is disabled (the mirror is simply empty);
  only the write/discovery paths need it enabled.
- **Auth modes:** per-member **delegated** (auth-code, refresh tokens encrypted
  at rest, access tokens cached in memory, rotated refresh tokens re-stored) for
  calendars + To Do; **app-only** (client-credentials, `.default`) for the
  family shared mailbox, so the family calendar never hangs off one member's
  token.
- **Secrets:** refresh tokens are AES-256-GCM encrypted (`src/m365/crypto.ts`,
  key derived from `JWT_SECRET`); token material is never logged or returned
  over the API.

Real-tenant behaviour is out of CI scope. A human can smoke-test app-only
access against the real `.env` with `npx tsx scripts/m365-smoke.ts` (acquires
an app-only token and probes `GET /users/{M365_FAMILY_MAILBOX}`; prints no
secrets).

## Phone PWA

The web app (`web/`) installs to a phone homescreen and stays useful with a
dead network for its one critical mobile surface, the shopping list.

**Install to homescreen (iOS Safari):**
1. Open the site in Safari (not Chrome/Firefox — only Safari drives the iOS
   install flow).
2. Tap the **Share** icon (square with an upward arrow) in the toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name ("Heorth") and tap **Add**.
5. Launch it from the homescreen icon — it opens full-screen (no browser
   chrome), matching `display: standalone` in the manifest.

Android (Chrome) picks up the same manifest and offers an "Install app"
prompt automatically — supported, but untested/unpolished by design for this
phase; iOS homescreen installability is the acceptance bar.

**Offline behaviour:** the app shell (build assets) is cached so it still
loads with no connection. The shopping list renders its last-known state with
an "offline · data from …" banner, and check-offs made offline are queued and
replayed automatically once the connection returns — nothing else is
offline-capable by design (out of scope for this phase). A service worker
update ships silently in the background; when one is ready, a small "Reload"
banner appears rather than swapping the app under you mid-session.

Icons are generated from the brand palette by `web/scripts/generate-icons.mjs`
(re-run only if the ember/parchment colours change); no image-processing
dependency is needed for it.

## Hearth View (kitchen wall)

`/hearth` is the always-on wall surface — designed for a Raspberry Pi driving a
21.5" Full-HD touchscreen (**1920×1080 landscape**, touch-only, read at arm's
length) running Chromium in kiosk mode. It renders full-bleed **outside** the
normal app chrome (no sidebar, top bar, or mobile nav) and composes the calendar
mirror (2.2), To Do tasks (2.3), and the meal plan into one glanceable
noticeboard.

**Layout.** A **week view** by default: seven day columns, each merging that
day's calendar events (native + mirrored M365, family feed included), the
planned supper, and tasks due that day. A **now/next strip** across the top shows
today's current-or-next event, tonight's supper, and how many tasks are due
today. A **month view** is one tap away (the week/month toggle), and the arrows
page between weeks/months (a "back to today" control appears once you've paged
away).

**Colour / attribution.** Each member's events carry their avatar colour
(ember / taupe / sage / sky). **Family-calendar events** (the shared M365 feed,
which carries no member attribution) render as the household's own **shared amber
band** — deliberately distinct from any member colour, so the family layer reads
as "belongs to the whole house".

**Interactions (glance-and-tap only).** Tap a task to mark it done (writes
through to Microsoft To Do; a gentle toast — never a stack trace — appears if
Microsoft can't be reached). Tap a planned meal to open a **large-type recipe
reading overlay** for cooking. Drag a supper's grip handle to **swap/move it to
another day** (the one edit gesture; persists via the meal-plan API). Everything
else is read-only — no event editing, no forms, no auth flows on the wall.

**Freshness & staleness.** Data auto-refreshes via TanStack Query polling (tasks
~30s, events ~60s, meals ~120s, sync-health ~60s) plus refetch on reconnect, and
survives Wi-Fi blips without blanking (the last-known view stays up, with an
"as of HH:MM" stamp). Per-feed staleness comes from `GET /api/v1/m365/status`:
a member whose feed has gone silent has their items greyed and a footer note
("<member> — last synced 2h ago"); a feed needing re-auth reads "reconnect from
your phone" — the wall **never** starts an auth flow itself.

**Always-on care.** The whole surface drifts a few pixels over four minutes
(pure CSS, disabled under `prefers-reduced-motion`) so a static layout never
burns fixed edges into the panel, and it dims after a few minutes of inactivity
(any touch wakes it). Query pages paged away from are capped (`gcTime`) so the
cache can't grow unbounded during an all-day session.

**Kiosk session (phase-1, pragmatic).** The wall runs a normal logged-in
session — log in once on the device; there is **no** device-token machinery yet
(a later phase, by explicit decision). The JWT TTL is `JWT_TTL_SECONDS` (default
`604800` = **7 days**), so **the wall needs a re-login roughly weekly**. To cut
that chore on a trusted in-home device, raise `JWT_TTL_SECONDS` (e.g. `2592000`
for 30 days) — it is the only knob involved; do not build a separate device
auth path for this phase. Kiosk OS plumbing (autostart Chromium in `--kiosk`
at `http://<host>/hearth`, screen-blanking policy) is deployment config, outside
the app.

## Testing

Integration tests hit a real PostgreSQL database (`tests/setup.ts` runs
migrations and truncates every table before each test) and run in a single
fork to avoid parallel DB conflicts. **`DATABASE_URL` must be exported into
the shell manually before `npm test`** — it is not picked up from `.env`
automatically by the test run:

```bash
export DATABASE_URL=postgres://heorth:<password>@localhost:5432/heorth
npm test
```

`tests/setup.ts` also defaults `JWT_SECRET`/`HOUSEHOLD_NAME`/`ADMIN_EMAIL`/
`ADMIN_PASSWORD`/`FEOH_BASE_URL`/`FEOH_API_KEY` if unset, so only the
database connection needs to be supplied. Feoh-satellite tests
(`tests/feoh-proxy.test.ts`) never make a real network call — they install
an in-process fake Feoh (`tests/fake-feoh.ts`) via `setFeohRuntime`.
`tests/setup.ts` also blanks the `M365_*` group so the integration is disabled
in the suite regardless of a local `.env`; M365 tests that need it enabled
install an in-process fake Graph (`tests/fake-graph.ts`) via `setM365Runtime`.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).
