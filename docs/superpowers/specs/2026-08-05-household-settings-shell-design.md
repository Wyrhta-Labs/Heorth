# Household settings shell — read-only adult view + contributed settings tabs

Date: 2026-08-05
Status: approved design, reviewed (Codex, independent), ready for planning

## Problem

Three things were asked for:

1. The household settings currently visible only to admins must be **viewable
   read-only by adult members**.
2. The household page needs an **extension point** so a feature area can
   contribute a settings tab and its corresponding page.
3. Feoh should use that extension point to provide its first setting: the
   household **currency**.

(3) turned out to depend on an architectural decision that is far larger than
this work — see *Scope split* below. This spec covers (1) and (2) only.

## Scope split

The currency setting needs an owner, and the household table lives in
`@wyrhta/core` (a pinned GitHub-tag dependency) with no `currency` column, so
there is no obvious place to put it. The decision taken was that finance owns
it — and that **Feoh should be re-absorbed into Heorth as an in-process
feature**, reversing the extraction recorded in `cda6410 refactor(feoh): remove
in-process finance module and drop its tables`.

That reversal is its own project. The work therefore splits three ways:

| | Project | Status |
|---|---|---|
| **P1** | Household settings shell — read-only adult view + settings-tab extension point | **this spec** |
| **P2** | Re-absorb Feoh into Heorth (revert the extraction, migrate schema + data, delete proxy/roster/satellite-client, rewrite the ADR in the meta repo) | separate spec, next |
| **P3** | Currency setting contributed through P1's extension point by the re-absorbed finance module; fixes the hardcoded `USD` in `web/src/lib/format.ts` | after P2 |

P1 is self-contained and unblocked. It deliberately ships the extension point
with the four **existing** tabs migrated onto it rather than with zero
consumers — that is what validates the interface before P3 uses it.

## Non-goals

- Any currency handling, and any change to `formatMoney`'s hardcoded `USD`.
- Any change to Feoh, the finance proxy, or the satellite seam.
- Child-role access to anything it cannot already reach.
- Any change to `@wyrhta/core`.
- A dedicated response DTO for `/m365/status` connections — see §4, declined.

## Design

### 1. The registry — `web/src/lib/settings-tabs.ts`

New module, mirroring the existing `PROVIDERS` registry in
`web/src/lib/providers.ts`. Pure data: a contributing area adds one entry and
touches nothing else.

```ts
export interface TabAccess {
  visible: boolean;
  readOnly: boolean;
}

export interface SettingsTab {
  /** URL segment and React key: 'members', 'currency', … */
  id: string;
  /** i18n key for the TabsTrigger label. */
  labelKey: string;
  /**
   * Who may open this tab, and whether they get it read-only. A predicate over
   * the whole member — NOT a role list. See the note below on why.
   */
  access: (member: Member) => TabAccess;
  /** Wrap the panel in a titled Card, or render it bare. */
  card?: { titleKey: string };
  Panel: ComponentType<{ readOnly: boolean }>;
}

/** The common case: gate on role alone. */
export function byRole(spec: { roles: Role[]; readOnlyFor?: Role[] }): SettingsTab['access'];

export const SETTINGS_TABS = [ /* the four entries below, in tab order */ ]
  as const satisfies readonly SettingsTab[];

/** Runtime narrowing for the `$tab` route param, which is an arbitrary string. */
export function isSettingsTabId(id: string): boolean;
```

**Why `access` is a predicate, not a `Role[]`.** Role is not the only access axis
in this codebase: the maintenance admin is quarantined by **handle**, not role
(`src/household/maintenance-admin.ts`), and `web/src/pages/profile.tsx:34`
already hides provider-connection UI by comparing against
`MAINTENANCE_ADMIN_HANDLE`. A `roles: Role[]` field cannot express "admin except
the maintenance admin", so a future contributed tab that creates an ownership
binding would have no way to say what it needs. One predicate replaces the two
fields (`roles` + `readOnlyFor`) rather than adding a third, and `byRole()` keeps
the ordinary entries as one-liners.

Initial entries, all expressed via `byRole`. Only the **bold** cells change
existing behaviour:

| id | roles | readOnlyFor | card |
|---|---|---|---|
| `members` | admin, adult, child | adult, child | yes (`settings.tabs.members`) |
| `keys` | admin, **adult** | — | yes (`settings.tabs.apiKeys`) |
| `settings` | admin, **adult** | **adult** | yes (`nav.household`) |
| `connections` | admin, **adult** | **adult** | no |

`members`' `readOnlyFor` reproduces today's behaviour exactly: the panel maps
`readOnly` onto `MembersTable`'s existing `canManage={!readOnly}` and hides the
"Add member" button, which is what `canManage = role === 'admin'` already did.

Two deliberate asymmetries, both resolved during design:

- **`keys` is full self-service for adults, not read-only.** `GET /auth/keys` is
  **self-scoped** — it lists the acting member's own keys, not household data.
  Hiding the tab from adults meant an adult had no path to an API key at all. A
  read-only view would have shown an adult their own keys while forbidding
  create/revoke, which is a self-service feature half-disabled rather than
  transparency. Adults get the tab with create/revoke enabled; children stay
  excluded — and §4 makes that exclusion real on the server.
- **`connections` is read-only for adults and needs a backend change** — see §4.

### 2. Routing — a real route per tab

`/household` becomes a layout with one **dynamic** child route,
`/household/$tab`, plus an index route redirecting `/household` →
`/household/members`.

One dynamic route rather than N routes generated from the registry, because
generated routes would break TanStack Router's literal-path typing. With `$tab`,
the *route path* stays type-checked in `<Link to="/household/$tab"
params={{ tab: 'currency' }} />` and a contributed tab needs no `app.tsx` edit at
all. This buys nothing for the tab **id** itself: the param is an arbitrary
string, so `isSettingsTabId()` narrows it at runtime — that check is the
authority, not the types.

- **`web/src/pages/household.tsx`** becomes the layout: filter `SETTINGS_TABS` by
  `access(member).visible`, render `TabsList`/`TabsTrigger` from the result,
  render `<Outlet />`. Keeps the existing `ErrorState`/`retryOf` handling for the
  `whoami` and members queries.
- **`web/src/components/household/settings-tab-panel.tsx`** (new) is the `$tab`
  route component: look the `tab` param up in the registry, compute
  `const { readOnly } = tab.access(member)`, wrap in `Card` when `card` is set,
  render `<tab.Panel readOnly={readOnly} />`.
- **Authorization must not be evaluated before `whoami` resolves.** `role` is
  derived from `whoamiQuery.data`; while that query is pending there is no
  member, and treating "no member" as "not permitted" would bounce a deep link to
  `/household/keys` back to `/household/members` before the user's real role
  arrived. So: while `whoamiQuery.isPending`, render a loading shell and redirect
  nothing. Only once `whoamiQuery.data` exists is `access()` consulted.
- **Unknown `tab` id, or one whose `access().visible` is false** → navigate to
  `/household/members` with `replace: true`. Same handling for both: a forbidden
  tab must not be distinguishable from a nonexistent one, and `members` is
  visible to every role so the fallback is always valid.
- **Role gating lives in the component, not `beforeLoad`.** `whoami` is a React
  Query resource; a loader guard would need the query client threaded into the
  route tree. The page already reads it via `useWhoami()` — keep it there. The
  registry's `access()` is **presentation only**; §4 is where the actual
  authorization lives.
- `TabsTrigger` keeps its `<button>`; the layout drives `Tabs`' controlled
  `value` from the route param and `onValueChange` → `navigate()`. Visuals are
  unchanged and `web/src/components/ui/tabs.tsx` is untouched. Accepted
  tradeoff: a trigger is not an anchor, so no middle-click-to-new-tab — the URLs
  themselves are linkable, which is what P3 needs.
- `TabsContent` is no longer used on this page; the `Outlet` renders the panel.

### 3. Panels

Each panel takes `{ readOnly }` so the registry, not the panel, decides policy.

- **`household-settings.tsx`** — gains `readOnly`: every `Input`/`select` gets
  `disabled`, the Save button is not rendered, and a hint line
  ("Only admins can change these.") is shown. One render path, not two: the
  `SELECT_CLASS` already carries `disabled:` styling. The `save` handler stays
  unreachable rather than being conditionally defined.
- **`connections-panel.tsx`** — gains `readOnly`: hides the "Sync now" button
  (`POST /m365/sync` is admin-only server-side). The table and feed health render
  identically.
- **`api-keys-panel.tsx`** — accepts `readOnly` to conform to the interface but
  is never registered read-only; it is honoured anyway (hide create, hide
  revoke) so the prop is not a lie.
- **`members-panel.tsx`** (new) — the member dialog, the `submit`/`changeRole`/
  `remove` handlers and `MembersTable` move here out of `household.tsx`, which
  drops from ~127 lines to a small layout.

### 4. Backend — two changes

**a. `GET /api/v1/m365/status` returns `connections` to adults.** Today
`src/m365/routes.ts` returns the household-wide array only when
`auth.role === 'admin'`; extend that to `adult`. Children continue to receive
only their own `connection`.

Precisely what an adult thereby gains: `toPublic()` (`src/m365/store.ts:12`)
strips **only** `refreshTokenEncrypted`, so each entry carries `id`, `memberId`,
`accountUpn`, `createdAt`, `updatedAt`, `scopes`, `status`,
`lastRefreshSuccessAt`, `lastRefreshError`. No token material, and the same
reasoning already written in that handler for why `feeds[]` is household-visible
applies. The only field that is arguably more than "who is linked and is it
healthy" is `scopes` — a static space-delimited string identical for every
member, sourced from `DELEGATED_SCOPES`. A narrower route DTO
(`{ memberId, accountUpn, status, lastRefreshSuccessAt, lastRefreshError }`) was
considered and **declined for P1** as scope creep: admins already receive these
fields today, and the web type narrows them at the client. Recorded here so the
choice is deliberate rather than overlooked.

The maintenance-admin quarantine is **not** implicated: it is a write gate
(`assertNotMaintenanceAdmin`), and `src/m365/routes.ts:41-44` documents that role
is not the quarantine anchor. Widening a read does not touch it.

**b. `/auth/keys` gets a role check.** `GET`/`POST`/`DELETE` on
`src/household/routes.ts:135,140,148` are guarded by `requireJwt`, which
constrains the *auth method* (a JWT session, not an API key) and checks **no
role**. A child can therefore mint and revoke their own API keys today, even
though the UI has always hidden the tab. Add `requireRole('admin', 'adult')` to
all three so the registry's exclusion of children is a real boundary rather than
a presentation-only fiction.

Nothing else needs touching: `GET /household` and `GET /household/options` are
already any-role, and `PATCH /household` and `POST /m365/sync` are already
`requireRole('admin')`.

### 5. Navigation and page title

Both follow from `/household` no longer being a leaf, and both were missed on the
first pass:

- `web/src/components/layout/sidebar.tsx:42` links `to: '/household'`. Point it at
  `/household/members` (or `/household/$tab` with `params`) so an ordinary nav
  click does not eat a redirect. The mobile nav uses the same `NAV_ITEMS`, so one
  edit covers both.
- `web/src/components/layout/app-shell.tsx:24` resolves the header title with
  `PAGE_TITLES[router.state.location.pathname]`, an exact-path lookup — so
  `/household/members` would fall through to the literal `'Heorth'`. Make the
  lookup prefix-aware for `/household/*` (falling back to the longest matching
  prefix), keeping every other route's exact match unchanged.

### 6. i18n

New keys in both `en` and `de`:

- `settings.household.readOnlyHint` — the "Only admins can change these." line.

Existing tab-label keys are reused verbatim by the registry.

### 7. Tests

**Backend** (`tests/`, real Postgres):

- an adult session receives `connections` from `GET /m365/status`; a child does
  not;
- a child gets 403 from `GET`, `POST` and `DELETE /auth/keys`; an adult still
  succeeds on all three.

**Web** — `web/src/pages/household.test.tsx` currently renders
`<HouseholdPage />` directly (line 41). That cannot survive a layout that uses
`Outlet`, the route param and `useNavigate`, so the file must be **converted to a
memory-router harness**, following the existing local pattern in
`web/src/components/pwa/update-banner.test.tsx:19-27` (`createRootRoute` +
`createRoute` + `createMemoryHistory` + `RouterProvider`). Its `setRole()` helper
is typed `'admin' | 'adult'` and needs `'child'`. This is the largest test change
in P1 and should be its own step in the plan.

Cases:

- admin sees all four triggers; adult sees all four; child sees only Members;
- adult on `settings`: name/timezone/locale disabled, no Save button, hint shown;
- adult on `keys`: create and revoke available;
- adult on `connections`: no "Sync now";
- `/household` redirects to `/household/members`;
- a nonexistent `$tab` redirects to `/household/members`;
- a `$tab` the member may not open (child → `keys`) redirects to
  `/household/members`;
- **while `whoami` is pending, a deep link to `/household/keys` is NOT
  redirected** — the regression test for the race in §2.

Panel-level suites (`household-settings.test.tsx`, `connections-panel.test.tsx`)
get a `readOnly` case each.

## Risks

- **Members-panel extraction is the largest source diff** and is pure refactor.
  Its behaviour is covered by `household.test.tsx`, which is being rewritten in
  the same change — so the two must not be done in one step, or a regression
  could hide behind the new harness. Convert the harness first with behaviour
  unchanged, then extract.
- **`access()` is presentation only.** It is not a security boundary; the API
  role checks are. Stated in the interface doc comment so a contributed tab does
  not mistake the predicate for enforcement.
- **A contributed tab that forgets `access`** would not compile — the field is
  required, not optional, for that reason.

## Review

Reviewed independently by Codex (read-only, spec-vs-code) on 2026-08-05.
Accepted and folded in: the `/auth/keys` role gap (§4b), the `whoami` redirect
race (§2), the `Role[]`-vs-predicate modelling of tab access (§1), the
nav/page-title fallout (§5), the test-harness conversion (§7), and the precise
field list behind "no token material" (§4a). Declined with reasoning: a
dedicated `/m365/status` connection DTO (§4a).
