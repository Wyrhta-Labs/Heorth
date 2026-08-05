# Household settings shell — read-only adult view + contributed settings tabs

Date: 2026-08-05
Status: approved design, ready for planning

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

## Design

### 1. The registry — `web/src/lib/settings-tabs.ts`

New module, mirroring the existing `PROVIDERS` registry in
`web/src/lib/providers.ts`. Pure data: a contributing area adds one entry and
touches nothing else.

```ts
export interface SettingsTab {
  /** URL segment and React key: 'members', 'currency', … */
  id: string;
  /** i18n key for the TabsTrigger label. */
  labelKey: string;
  /** Roles that may open the tab at all. */
  roles: Role[];
  /** Of those roles, the ones that get the panel read-only. */
  readOnlyFor?: Role[];
  /** Wrap the panel in a titled Card, or render it bare. */
  card?: { titleKey: string };
  Panel: ComponentType<{ readOnly: boolean }>;
}

/** The four entries in the table below, in tab order. */
export const SETTINGS_TABS: SettingsTab[];
```

Initial entries. Only the **bold** cells change existing behaviour:

| id | `roles` | `readOnlyFor` | `card` |
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
  `requireJwt` and **self-scoped** — it lists the acting member's own keys, not
  household data. Hiding the tab from adults meant an adult had no path to an
  API key at all. A read-only view would have shown an adult their own keys while
  forbidding create/revoke, which is a self-service feature half-disabled rather
  than transparency. Adults get the tab with create/revoke enabled; children stay
  excluded.
- **`connections` is read-only for adults and needs a backend change** — see §4.

### 2. Routing — a real route per tab

`/household` becomes a layout with one **dynamic** child route,
`/household/$tab`, plus an index route redirecting `/household` →
`/household/members`.

One dynamic route rather than N routes generated from the registry, because
generated routes would break TanStack Router's literal-path typing: with `$tab`,
`<Link to="/household/$tab" params={{ tab: 'currency' }} />` stays type-safe, and
a contributed tab needs no `app.tsx` edit at all.

- **`web/src/pages/household.tsx`** becomes the layout: role-filter
  `SETTINGS_TABS`, render `TabsList`/`TabsTrigger` from the result, render
  `<Outlet />`. Keeps the existing `ErrorState`/`retryOf` handling for the
  `whoami` query.
- **`web/src/components/household/settings-tab-panel.tsx`** (new) is the `$tab`
  route component: look the `tab` param up in the registry, compute
  `readOnly = tab.readOnlyFor?.includes(role) ?? false`, wrap in `Card` when
  `card` is set, render `<tab.Panel readOnly={readOnly} />`.
- **Unknown `tab` id, or one whose `roles` excludes the acting role** → navigate
  to `/household/members` with `replace: true`. Same handling for both: a
  forbidden tab must not be distinguishable from a nonexistent one, and
  `members` is visible to every role so the fallback is always valid.
- **Role gating lives in the component, not `beforeLoad`.** `whoami` is a React
  Query resource; a loader guard would need the query client threaded into the
  route tree. The page already reads `whoami` via `useWhoami()` — keep it there.
  The backend remains the actual authority: every gate below is mirrored by a
  route-level role check on the API.
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

### 4. Backend — one change

`GET /api/v1/m365/status` (`src/m365/routes.ts`) currently returns the
household-wide `connections` array only when `auth.role === 'admin'`. Extend that
to `adult`. The array carries the account UPN and link status, never token
material — the same reasoning already written in that handler for why `feeds[]`
is household-visible. Children continue to receive only their own `connection`.

Nothing else needs touching: `GET /household` and `GET /household/options` are
already any-role, `PATCH /household` is already `requireRole('admin')`, and
`/auth/keys` is already self-scoped to the acting member.

### 5. i18n

New keys in both `en` and `de`:

- `settings.household.readOnlyHint` — the "Only admins can change these." line.

Existing tab-label keys are reused verbatim by the registry.

### 6. Tests

**Backend** (`tests/`, real Postgres):

- an adult session receives `connections` from `GET /m365/status`;
- a child session does not.

**Web** (`web/src/pages/household.test.tsx`, extending the existing
`setRole()` helper):

- admin sees all four triggers; adult sees all four; child sees only Members;
- adult on `settings`: name/timezone/locale are disabled, no Save button, hint
  present;
- adult on `keys`: create and revoke are available;
- adult on `connections`: no "Sync now";
- `/household` redirects to `/household/members`;
- a nonexistent `$tab` redirects to `/household/members`;
- a `$tab` the role may not open (child → `keys`) redirects to
  `/household/members`.

Panel-level suites (`household-settings.test.tsx`,
`connections-panel.test.tsx`) get a `readOnly` case each.

## Risks

- **Members-panel extraction is the largest diff** and is pure refactor. Its
  existing test coverage in `household.test.tsx` must keep passing unchanged
  apart from the routing wrapper.
- **The registry's `readOnly` is presentation only.** It is not a security
  boundary; the API role checks are. The spec states this explicitly so a future
  contributed tab does not mistake the prop for enforcement.
- **A contributed tab that forgets `roles`** would be invisible to everyone. The
  field is required (not optional) in the interface for that reason.
