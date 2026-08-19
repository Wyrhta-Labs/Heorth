# Heorth

The flagship self-hosted household system in the Wyrhta Labs stack: household
membership, calendar, meal planning, finance (envelopes/accounts/double-entry
transactions, ADR 0007), and a media/book library, built with Node.js 22 +
TypeScript, Hono, Drizzle ORM, PostgreSQL 18, Zod, and Vitest.

## Quick start

Requires Node.js 22 and Docker (or your own PostgreSQL 18).

```bash
cp .env.example .env
# Fill in EVERY placeholder. .env.example documents what each value is and how
# to generate the secrets; nothing has a usable default on purpose.
```

Two settings deserve a second look before you expose this to anything:

- **`CORS_ORIGIN`** ships as `*`, which is right for localhost and wrong
  everywhere else — Heorth holds household, calendar, and finance data.
- **`DATABASE_URL`** must never point at a database you care about while the
  test suite runs: `tests/setup.ts` truncates every table between tests and
  accepts only a database whose name ends in `_test`.

`npm install` fetches `@wyrhta/core` straight from its **git tag** rather than
from a registry, and builds it during install — so you need `git` on your PATH
and a working toolchain, and the first install is slower than a normal one. See
[ADR 0010](https://github.com/Wyrhta-Labs/wyrhta/blob/main/docs/decisions/0010-core-stays-a-git-dependency-that-builds-on-install.md)
for why.

### Which way to run it

| | Use |
|---|---|
| `docker-compose.yml` (this repo) | **Start here.** Heorth plus its own PostgreSQL, nothing else. This is the supported path for running Heorth on its own. |
| [`deploy/`](https://github.com/Wyrhta-Labs/wyrhta) in the meta repo | The whole household stack — Heorth, KithLedger, heorth-mcp and one shared PostgreSQL. Use it when you want the services talking to each other. |

The two are alternatives, not layers. Do not run both against the same
database.

Finance (`src/modules/feoh/`, ADR 0007) and inventory (`src/modules/inventory/`)
are both built-in, **always-on** modules — no env var gates them. `feoh` was
briefly behind a `FEOH_ENABLED` kill switch; that switch was removed
2026-08-17, so `/api/v1/feoh/*` is always mounted.

```bash
npm install
npm run docker:up      # API + PostgreSQL 18 via docker-compose.yml
# or, with your own Postgres running and DATABASE_URL pointed at it:
npm run dev             # API only (tsx watch src/index.ts)
npm run dev:all          # API + web dev server concurrently
```

Other scripts (`package.json`): `build` / `build:web` (compile), `start`
(run compiled output), `typecheck`, `db:generate` / `db:migrate` / `db:push`
/ `db:studio` (Drizzle, run via `tsx`), `docker:down`, `docker:reset`.

On boot, `bootstrap()` (`src/index.ts`) runs migrations and seeds the
household + admin user (both idempotent).

## API surface

REST is mounted under `/api/v1`, one router per module (`src/modules/index.ts`
lists `ALL_MODULES`):

| Prefix | Module | Notes |
|---|---|---|
| `/api/v1/household`, `/api/v1/members`, `/api/v1/auth` | `src/household/` | Household singleton (`GET /household/options` serves the allowed timezone/locale values a `PATCH` accepts), member CRUD/roles, login, `he_` API keys |
| `/api/v1/events` | `src/modules/calendar/` | Calendar with server-side recurrence expansion |
| `/api/v1/recipes`, `/api/v1/meals` | `src/modules/meals/` | Recipes, weekly meal plan, shopping list |
| `/api/v1/library` | `src/modules/library/` | Book/media library; Trakt + LibraryThing connectors |
| `/api/v1/tasks` | `src/modules/tasks/` | Household tasks backed by Microsoft To Do — list/complete/create + per-member list allowlist (writes need M365 enabled) |
| `/api/v1/inventory` | `src/modules/inventory/` | Household inventory: items with lifecycle fields (purchase, warranty, decommission/reactivation), search/filter/paginate — a standalone, always-on `HeorthModule`; no dependency on feoh |
| `/api/v1/feoh/*` | `src/modules/feoh/` | Finance: envelopes, accounts, double-entry transactions, recurring bills + occurrences, item costs/TCO, account ledger + reconciliation (ADR 0007) — a `HeorthModule`, always on (see [Finance](#finance) below) |
| `/api/v1/m365/*` | `src/m365/` | Microsoft 365 connection flow — **only mounted when configured** (see below); absent otherwise |

**Heorth serves REST only.** The MCP surface moved out of this service into
its own container, `Wyrhta-Labs/heorth-mcp` (ADR 0008) — a pure REST client
that talks to the endpoints above with a member's `he_` API key. Heorth no
longer mounts `/mcp`, and modules no longer contribute in-process MCP tools;
`HeorthModule.register(app)` mounts routers and nothing else. Any behaviour a
tool needs must therefore be reachable over REST.

The React web UI (`web/`) is served as static files from `web/dist` for any
unmatched non-API route.

## Finance

Finance (envelopes, accounts, double-entry transactions, recurring bills) is
a built-in `HeorthModule` (`src/modules/feoh/`, ADR 0007) — it was briefly
extracted to an independent Feoh satellite service and was merged back
in-process, and is now **always on** (the earlier `FEOH_ENABLED` kill switch
was removed 2026-08-17 — routes mount at `/api/v1/feoh/*`
unconditionally).

Beyond the core ledger primitives, three surfaces round out the feature:

- **Recurring occurrences** — a bill's cadence projects into due-date entries
  (`GET /api/v1/feoh/occurrences`) with derived status (`planned`/`overdue`/
  `paid`/`skipped`/`unknown`); linking, skipping, unskipping, and overriding
  an occurrence persist a row only once it's touched. `nextOpen` (the
  earliest non-paid/skipped date) is **not** returned by the API — it's
  cheap to derive client-side from the listing.
- **Item costs / TCO** — `POST /api/v1/feoh/item-costs` links a transaction
  to an inventory item as a cost (purchase/disposal/repair/maintenance/
  accessory); `GET /api/v1/feoh/item-costs/:itemId` returns the rolled-up
  total-cost-of-ownership breakdown plus a per-year rate.
- **Account ledger + Kassensturz** — `GET /api/v1/feoh/accounts/:id/ledger`
  is a paginated, running-balance ledger per account; `POST
  /api/v1/feoh/accounts/:id/reconcile` books an adjusting transaction between
  a physically counted balance and the ledger balance (asset accounts only).

Writes (accounts/envelopes/transactions/bills/import/occurrences/item-costs/
reconcile) require `admin` or `adult` role (children can't edit finances) and
are rejected for a maintenance-admin acting principal
(`src/household/maintenance-admin.ts`). `transactions.createdBy` and
expense-split `memberId` reference Heorth's `users` table directly — there is
no separate parties/roster boundary.

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
  range/week/dashboard queries alongside native events — but are
  **read-only everywhere**: update/move/delete of a mirrored event
  is rejected (`EVENT_READ_ONLY`), and the web renders them with a subtle
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
  silent drop. Task feeds
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

## KithLedger reminders (optional integration)

Heorth can show KithLedger's upcoming reminders on the Hearth wall. The module
(`src/modules/kith/`) is a **stateless live proxy** — no mirror table, no
database — exposing one route, `GET /api/v1/kith/reminders?from&to`, which
windows KithLedger's `GET /api/v1/reminders` on the effective due date
(`snoozedUntil` when snoozed) and passes the rows through unchanged.

**Optional as a group**, the same contract as `M365_*`: both variables present
→ the module mounts and `GET /api/v1/features` reports `kithledger: true`; both
absent → nothing mounts (`/api/v1/kith/*` falls through to the catch-all `404`);
partial presence is a startup error.

```
# KithLedger — both or neither (partial config is a startup error)
KITH_BASE_URL=http://kithledger:4002
KITH_API_KEY=<a HOUSEHOLD-kinded kl_ key — see below>

# Optional within the group; 'household' is the only accepted value.
KITH_API_KEY_KIND=household
```

### Which principal this feed presents (ADR 0004 §2)

KithLedger keeps ADR 0004's three principals as three separate credentials, and
a `kl_` key carries its **kind**:

| kind | scope |
| --- | --- |
| `member` | that account's full personal scope (`household` + owned + shared-to), and may write |
| `household` | the `household`-visible slice **only**, read-only, member-less by design |
| `ops` | no data access at all |

The reminders feed is an **always-on dashboard surface with no logged-in
member** — `requireAuth` authenticates the Heorth caller, but that identity is
never forwarded upstream, and every member sees the same wall. Its correct
principal is therefore the **household** key, and that is the only kind
`KITH_API_KEY` may hold. Nothing in this module writes: `KithClient` issues
GETs only, and KithLedger refuses a non-GET from a household key anyway.

A read made **on a specific member's behalf** would need a member JWT from
`POST /api/v1/auth/satellite-token` (`aud: kithledger`, 5-minute TTL — see
"Token exchange" below), not this key. Heorth has no such call path today, so
none is built.

Note that nothing in a key's text reveals its kind — they all read `kl_…` — and
KithLedger's key listing requires a local-account JWT that Heorth does not hold.
`KITH_API_KEY_KIND` is therefore the operator's **declaration**, pinned to the
one legal value so a deliberate `member`/`ops` entry fails at boot with the
procedure below. A `member` key pasted in *without* changing the declaration
cannot be detected from here — it simply works, too widely, which is why the
migration below matters. What *is* detected is a key KithLedger refuses (an
unknown/revoked key, or an `ops` key): those surface as
`502 KITH_CREDENTIAL_REJECTED` with a `kith.credential.rejected` audit event,
distinct from `502 KITH_UNAVAILABLE`, so a misconfigured credential never reads
as an outage.

### Migrating an existing `KITH_API_KEY` to a household key

Deployments predating this split hold a `member` key (KithLedger's migration
`0006` backfilled every pre-existing key as `member`), which means the always-on
wall reads with the full personal scope of KithLedger's local admin account
**and could write**. Replace it:

1. In **KithLedger**, as the local admin (JWT, not an API key — a key cannot
   mint a key), mint the dashboard credential:
   ```
   POST /api/v1/auth/keys
     { "name": "heorth-hearth-wall", "kind": "household" }
   → 201 { "data": { "id": "…", "key": "kl_…", "kind": "household", … } }
   ```
   The `key` value is shown **once**.
2. Put that value in `deploy/`'s `.env` as `KITH_API_KEY` (and optionally set
   `KITH_API_KEY_KIND=household` to state it), then restart Heorth. Nothing else
   changes: same variable, same route, same response shape.
3. Confirm the wall still lists reminders, then **revoke the old member key** in
   KithLedger (`DELETE /api/v1/auth/keys/:id`) so the wide credential stops
   existing. Do not skip this — leaving it revocable-but-live is the whole risk
   this migration removes.

**Expect fewer reminders afterwards.** A household key cannot see anyone's
`private` items, nor `shared`-subset items whose share list it is not on (it is
member-less, so it is on none of them) — and ADR 0004 §3.4 makes counts respect
the same filter, so they are absent from `meta.total` too, not just from the
rows. Only reminders whose `visibility` is `household` reach the wall. Since
`household` is KithLedger's create-time default, most reminders are unaffected;
what disappears is exactly what someone deliberately marked private or shared to
a subset — which is the point, since the wall is a screen anyone in the room can
read. A member who wants such a reminder on the wall changes its visibility to
`household` in KithLedger. The wall degrades quietly: a narrowed or empty list
is an ordinary `200` with fewer chips, never an error or an empty-state banner.

## Satellite identity — signing keys and JWKS (optional)

Heorth is the household's identity provider for satellite services
(KithLedger first). The trust model is **asymmetric keys + JWKS**: Heorth signs
satellite tokens with a *private* key and publishes the *public* keys, so a
satellite can only ever **verify** and is structurally unable to mint tokens.
A shared signing secret was explicitly rejected.

The satellite key is **separate from `JWT_SECRET`**. `JWT_SECRET` signs member
login tokens *and* derives the M365 refresh-token encryption key
(`src/m365/crypto.ts`); it never leaves this service and nothing here touches
it. Member login is unchanged.

Key loading lives in `src/satellite/keys.ts`; the endpoint is
`src/routes/jwks.ts`. `@wyrhta/core` (≥ v0.2.0) supplies the primitives
(`loadPrivateKey`, `publicKeyFromPrivate`, `toJwks`) — core reads no env and no
files, so this area is the seam that turns validated env into key material.

### The endpoint

```
GET /.well-known/jwks.json      → 200 {"keys": [ ... ]}
```

**Unauthenticated by design** — that is the point of a public key set; a
satellite fetches it with no credentials. It is mounted outside `/api/v1`, so
no auth guard and no `/api/*` catch-all applies, and it is the one Heorth
response that is **not** wrapped in the `ok()` `{ data: ... }` envelope: a JWKS
is a wire-format contract read by off-the-shelf JWKS clients, which expect the
bare `{ "keys": [...] }`. It sends `Cache-Control: public, max-age=300`.

The body is built by core's `toJwks`, which emits **public members only** — no
private component, no `JWT_SECRET`, nothing else about the deployment can
appear there (`tests/satellite-jwks.test.ts` asserts this explicitly).

### Configuration

**Optional as a group**, the same contract as `M365_*` / `KITH_*`. With none of
these set — the default — Heorth starts and behaves exactly as today and the
endpoint returns `{"keys": []}`, the standard way to say "nothing is
published". Partial presence is a startup error.

| Variable | Required | Notes |
| --- | --- | --- |
| `SATELLITE_SIGNING_KEY` | with `_KID` | Private key material: PKCS#8 PEM or JWK JSON |
| `SATELLITE_SIGNING_KID` | with `_KEY` | Key id, stamped into signed tokens and into the JWKS |
| `SATELLITE_SIGNING_ALG` | no | `EdDSA` (default, recommended) or `RS256` |
| `SATELLITE_SIGNING_KEY_SECONDARY` | with `_KID_SECONDARY` | Rotation-overlap key — **published, never signs**. Accepts private *or* public material |
| `SATELLITE_SIGNING_KID_SECONDARY` | with `_KEY_SECONDARY` | Its key id; must differ from the active `kid` |
| `SATELLITE_SIGNING_ALG_SECONDARY` | no | `EdDSA` (default) or `RS256` — may differ from the active key's |
| `SATELLITE_AUDIENCES` | no | Comma-separated allowlist of satellites tokens may be minted for, e.g. `kithledger`. Empty by default → every exchange is refused. Requires the active key |

Ed25519 (`EdDSA`) is the recommended default: small keys, small signatures, no
parameter choices to get wrong. `RS256` is supported for satellites whose JWT
library cannot do Ed25519.

A PEM's newlines do not survive a single-line `.env`, so key material may use
the conventional `\n`-escaped form — `normalizeMaterial` restores the real
newlines. JWK JSON is single-line already and needs no escaping.

Generate an Ed25519 key pair:

```bash
openssl genpkey -algorithm ed25519 -out satellite.key      # PKCS#8 private
openssl pkey -in satellite.key -pubout -out satellite.pub  # SPKI public
# single-line form for .env:
awk 'BEGIN{ORS="\\n"} {print}' satellite.key
```

Only `SATELLITE_SIGNING_KEY` is a secret; the public half is meant to be
published and can live anywhere.

### Token exchange — `POST /api/v1/auth/satellite-token`

How member identity reaches a satellite (ADR 0009). A caller presenting a
credential Heorth already accepts trades it for a short-lived, audience-bound
member token for **one** named satellite. Only Heorth can mint these:
heorth-mcp deliberately holds no signing key, so a compromise of the translator
cannot forge a member.

```
POST /api/v1/auth/satellite-token     Authorization: Bearer <he_ key | member JWT>
     { "audience": "kithledger" }
  → 200 { "data": { "token": "<jwt>", "expires_in": 300, "audience": "kithledger" } }
```

The token carries `sub` (member id), `role`, `iss: heorth`, `aud: <satellite>`,
`iat` and `exp`, and is signed with the **active satellite key** — verify it
against `/.well-known/jwks.json`, selecting the key by the token header's
`kid`, and pass `leewaySeconds: 60` (ADR 0009, open question 3).

- **TTL is 5 minutes**, fixed. `expires_in` is returned so a caller can
  schedule renewal without parsing the token.
- `sub` and `role` come from the **authenticated principal**, never from the
  request body — the exchanged token grants no more than its bearer already
  had, and a `child` caller gets a `child` token.
- The audience must be listed in `SATELLITE_AUDIENCES`; anything else is
  `400 UNKNOWN_AUDIENCE`. Registering a satellite is a deliberate deployment
  change, so tokens cannot be minted for a service nobody decided to trust.
- With no signing key configured, the endpoint answers
  `503 SATELLITE_SIGNING_UNAVAILABLE`. It never falls back to `JWT_SECRET`.
- **Rate-limited** per source IP (60 requests / 15 min), in front of the auth
  guard. The budget is wider than `POST /auth/token`'s because the caller is a
  machine: heorth-mcp is one source IP for the whole household and each member
  needs a mint every 5 minutes.
- **Audited**: every mint logs `auth.satellite_token.issued` and every refusal
  logs `auth.satellite_token.refused` (member, audience, credential type,
  reason). Never the token itself. Volume is bounded — a caching client (ADR
  0009) reaches Heorth only on a cache miss.

Clients should cache the token **in memory only**, keyed by the presenting
credential *and* the audience, and evict at `exp - 30s`. A coarser cache key
would let one member act as another.

### Rotating the satellite signing key

Two key slots exist so a rotation is never a flag-day. The **active** key is
the only one that signs; the **secondary** slot is published in the JWKS but
never signs. Because JWKS entries carry a `kid` and signed tokens carry that
same `kid` in their header, a verifier always picks the right key, and both
keys are valid at once for as long as the overlap lasts.

Overlap must be at least the **satellite token TTL** (so no token in flight is
orphaned) plus the satellites' **JWKS cache lifetime** (300 s from this
endpoint, plus whatever the satellite caches on its side). A day is a
comfortable margin for a household deployment.

Order of operations — never skip step 2's wait, that is the whole point:

1. **Generate** the new key pair and pick a fresh `kid`. Use a `kid` that sorts
   and reads unambiguously, e.g. `sat-2026-09`; never reuse a retired one.
2. **Pre-publish** the new key in the *secondary* slot, leaving the old key
   active:
   ```
   SATELLITE_SIGNING_KEY=<old private>          SATELLITE_SIGNING_KID=sat-2026-08
   SATELLITE_SIGNING_KEY_SECONDARY=<new public> SATELLITE_SIGNING_KID_SECONDARY=sat-2026-09
   ```
   Restart Heorth and confirm `GET /.well-known/jwks.json` lists **both**
   `kid`s. Wait out the JWKS cache lifetime so every satellite has fetched the
   new document *before* any token is signed with the new key.
3. **Promote**: swap the slots so the new key signs and the old one is only
   published.
   ```
   SATELLITE_SIGNING_KEY=<new private>          SATELLITE_SIGNING_KID=sat-2026-09
   SATELLITE_SIGNING_KEY_SECONDARY=<old public> SATELLITE_SIGNING_KID_SECONDARY=sat-2026-08
   ```
   Restart. New tokens now carry `kid: sat-2026-09`; tokens already issued
   under `sat-2026-08` keep verifying against the still-published old key.
   Note the secondary slot takes **public** material, so the old *private* key
   can be deleted from the host at this point — it is never needed again.
4. **Wait** out the overlap window (≥ token TTL + cache lifetime).
5. **Retire**: unset `SATELLITE_SIGNING_KEY_SECONDARY` /
   `SATELLITE_SIGNING_KID_SECONDARY` and restart. The JWKS drops back to one
   key, and any token still bearing the old `kid` now fails with
   `UNKNOWN_KEY_ID` — which is the intended end state.
6. **Destroy** the retired private key material from backups and secret stores.

**Emergency revocation** (a private key is believed compromised) skips the
overlap: jump straight to step 3 with the compromised key left *out* of both
slots. Every token signed by it stops verifying at once — accept that
outstanding satellite sessions break, because that is the point.

Keys are loaded once and cached for the process lifetime, so **every step above
needs a restart**; there is no hot-reload path, deliberately — key material
changing under a running process is a debugging hazard, not a feature.

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
banner appears rather than swapping the app under you mid-session. **Except on
`/hearth`** — see the Hearth View section below for why the wall never shows
that banner.

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
your phone" — the wall **never** starts an auth flow itself. `status`'s
`feeds[]` array is **household-visible to any authenticated session** (not just
admins) — a feed status carries no secrets (feed key, last success time, a
classified error, failure count), and the wall composes every member's events,
so a non-admin kiosk session must be able to see when *another* member's feed
has gone dead. **Admin login is not required** for the wall to show accurate
staleness. Only connection details (account UPN, the full connections list)
stay scoped to the acting member / admin-only.

**Always-on care.** The whole surface drifts a few pixels over four minutes
(pure CSS, disabled under `prefers-reduced-motion`) so a static layout never
burns fixed edges into the panel, and it dims after a few minutes of inactivity
(any touch wakes it). Query pages paged away from are capped (`gcTime`) so the
cache can't grow unbounded during an all-day session.

**Software updates.** The wall never shows the app's "Reload" update banner
(nobody is standing in front of it to tap Reload) and never swaps the app out
from under an active glance. Instead, when a new deploy ships, the wall applies
the update itself the next time it goes idle (the same idle-dim signal used for
screen-burn care above) — the brief reload flash then lands while nobody is
reading the screen. This is the least-intrusive of the options considered
(banner-on-wall, immediate silent reload, reload-at-idle); see
`web/src/components/pwa/update-banner.tsx` for the implementation.

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
automatically by the test run.

**The database name must end in `_test`.** The suite `TRUNCATE`s every
application table between tests, so `tests/setup.ts` enforces an allowlist and
refuses anything else — including your primary `heorth` database. This is not a
style preference: the check replaced an earlier one that let a name like
`heorth` through, and pointing `DATABASE_URL` at a live database silently wiped
it.

You do **not** need your development database for this. Because `tests/setup.ts`
runs the migrations itself, an empty throwaway Postgres is enough, and it keeps
the suite's `TRUNCATE`s away from anything you care about:

```bash
docker run -d --rm --name heorth-test-db \
  -e POSTGRES_USER=heorth -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=heorth_test \
  -p 55499:5432 postgres:18-alpine
until docker exec heorth-test-db pg_isready -U heorth -d heorth_test; do sleep 1; done

DATABASE_URL=postgres://heorth:testpw@localhost:55499/heorth_test npm test

docker rm -f heorth-test-db
```

Port 55499 is arbitrary — pick anything free that is not your development
cluster's port. To reuse an existing server instead, create a separate database
on it and point at that:

```bash
export DATABASE_URL=postgres://heorth:<password>@localhost:5432/heorth_test
npm test
```

The web suite (`cd web && npm test`) is jsdom-only and needs no database.

`tests/setup.ts` also defaults `JWT_SECRET`/`HOUSEHOLD_NAME`/`ADMIN_EMAIL`/
`ADMIN_PASSWORD` if unset, so only the database connection needs to be
supplied. Finance is always on, so suites exercising it (e.g.
`tests/feoh-accounts.test.ts`) import `src/app.js` directly — no env var
toggling or dynamic re-import required.
`tests/setup.ts` also blanks the `M365_*` group so the integration is disabled
in the suite regardless of a local `.env`; M365 tests that need it enabled
install an in-process fake Graph (`tests/fake-graph.ts`) via `setM365Runtime`.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).
