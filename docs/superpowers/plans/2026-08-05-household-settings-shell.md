# Household Settings Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make household settings read-only-viewable by adults, and turn the `/household` page into a registry-driven set of real routes so a feature area can contribute a settings tab and its page.

**Architecture:** A pure-data registry (`web/src/lib/settings-tabs.ts`, mirroring the existing `PROVIDERS` registry) declares each tab's id, label, access predicate and panel component. `/household` becomes a TanStack Router layout with one dynamic child route `/household/$tab` plus an index route redirecting to `/household/members`. Two backend changes make the new UI gates real: `/auth/keys` gains a role check, and `GET /m365/status` returns the household-wide `connections` array to adults.

**Tech Stack:** Node 22 + TypeScript, Hono, Drizzle, PostgreSQL (backend, Vitest against real Postgres); React 18.3 + TanStack Router 1.114 + TanStack Query 5 + i18next 26 + Vitest/Testing Library (web).

**Spec:** `docs/superpowers/specs/2026-08-05-household-settings-shell-design.md`

## Global Constraints

- Backend responses use `ok`/`err` from `@wyrhta/core/http`; guards come from `src/wiring.ts`.
- `requireJwt` sets the `principal` context key (verified in `@wyrhta/core/dist/auth/guards.js`), so `requireRole(...)` composes after it.
- Backend tests hit real Postgres. `DATABASE_URL` MUST end in `_test`; `tests/setup.ts` enforces it (it refuses the primary `heorth` database). Target `heorth_test` in the meta repo's `deploy/` dev cluster — container `wyrhta-dev-db-1`, host port **5432**, owner role `heorth`. Build the URL from the deploy stack's own secret; never hardcode or commit a password:

  ```bash
  PW=$(grep "^HEORTH_DB_PASSWORD=" ../deploy/.env | cut -d= -f2-)
  export DATABASE_URL="postgres://heorth:${PW}@localhost:5432/heorth_test"
  ```

  Heorth's own `.env` names a `kith` user; that credential fails auth and is not the one for tests.
- Backend test seeding is `seedTestHousehold()` from `tests/helpers.ts` — it returns `{ admin, adult, child }`, each `{ user, jwt }`. Auth headers via `authHeaders(jwt)`.
- `t()` keys are **type-checked** against `web/src/i18n/locales/en.json` (see `web/src/i18n/i18next.d.ts`). A `string`-typed key will NOT compile — use `ParseKeys<'translation'>` from `i18next`.
- Every new i18n key MUST be added to BOTH `en.json` and `de.json` — `web/src/i18n/catalog-parity.test.ts` fails on any key-set mismatch.
- Web money/date formatting, PWA and offline behaviour are untouched by this plan.
- Commit after every task. Do not add AI co-author trailers.
- Run `npm run typecheck` (repo root) and `cd web && npx tsc --noEmit` as appropriate before each commit.

## File Structure

**Backend**
- Modify `src/household/routes.ts` — add a role guard to the three `/auth/keys` routes.
- Modify `src/m365/routes.ts` — widen the `connections` branch of `GET /status` to adults.
- Modify `tests/household-routes.test.ts` — child/adult key-route coverage.
- Modify `tests/m365-routes.test.ts` — adult/child `connections` coverage.

**Web — the registry and its panels**
- Create `web/src/lib/settings-tabs.ts` — the extension point. Owns the `SettingsTab` interface, `byRole()`, `SETTINGS_TABS`, `DEFAULT_SETTINGS_TAB`, `findSettingsTab()`.
- Create `web/src/lib/settings-tabs.test.ts` — unit tests for `byRole` and `findSettingsTab`.
- Create `web/src/components/household/members-panel.tsx` — extracted from `household.tsx`; owns the member dialog, mutations and `MembersTable`.
- Modify `web/src/components/household/household-settings.tsx` — `readOnly` prop.
- Modify `web/src/components/household/connections-panel.tsx` — `readOnly` prop.
- Modify `web/src/components/household/api-keys-panel.tsx` — `readOnly` prop.

**Web — routing and chrome**
- Modify `web/src/pages/household.tsx` — becomes the layout (tab strip + `Outlet`).
- Create `web/src/components/household/settings-tab-panel.tsx` — the `$tab` route component.
- Modify `web/src/app.tsx` — index + `$tab` child routes under `householdRoute`.
- Modify `web/src/components/layout/sidebar.tsx` — nav target.
- Modify `web/src/components/layout/app-shell.tsx` — prefix-aware page title.
- Modify `web/src/pages/household.test.tsx` — converted to a memory-router harness.
- Modify `web/src/i18n/locales/en.json`, `de.json` — `settings.household.readOnlyHint`.

**Task order rationale.** Backend first (independent). Then panels gain `readOnly` while the page still works exactly as today. Then the members extraction — verified green by the **untouched** existing page tests, which is the regression net. Only then the registry, then routing (which rewrites those tests), then nav/title. This deviates slightly from the spec's risk note (which suggested converting the test harness before extracting): extracting first is strictly safer, because the old tests prove the extraction before the harness they rely on changes.

---

### Task 1: Role-gate `/auth/keys`

API keys are self-scoped, but the three routes carry only `requireJwt`, which constrains the auth *method* and checks no role. A child can mint and revoke their own API keys today. The registry excludes children from the keys tab, so the server must agree.

**Files:**
- Modify: `src/household/routes.ts:135,140,148`
- Test: `tests/household-routes.test.ts`

**Interfaces:**
- Consumes: `requireRole` from `src/wiring.ts` (already imported at line 4).
- Produces: `/auth/keys` GET/POST/DELETE return 403 for `child`.

- [ ] **Step 1: Write the failing test**

Add to `tests/household-routes.test.ts`, inside the existing `describe('household & members routes', ...)`:

```ts
  it('key management is admin/adult only; a child gets 403', async () => {
    const { adult, child } = await seedTestHousehold();

    const childList = await app.request('/api/v1/auth/keys', { headers: authHeaders(child.jwt) });
    expect(childList.status).toBe(403);

    const childCreate = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'kid-agent' }),
    });
    expect(childCreate.status).toBe(403);

    const childRevoke = await app.request('/api/v1/auth/keys/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE', headers: authHeaders(child.jwt),
    });
    expect(childRevoke.status).toBe(403);

    // An adult keeps full self-service: create, list, revoke.
    const created = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'adult-agent' }),
    });
    expect(created.status).toBe(201);
    const { data } = await created.json() as { data: { id: string } };

    const adultList = await app.request('/api/v1/auth/keys', { headers: authHeaders(adult.jwt) });
    expect(adultList.status).toBe(200);

    const revoked = await app.request(`/api/v1/auth/keys/${data.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(revoked.status).toBe(200);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
# DATABASE_URL must already be exported — see Global Constraints
npx vitest run tests/household-routes.test.ts -t 'key management is admin/adult only'
```

Expected: FAIL — the child requests return 200/201 instead of 403.

- [ ] **Step 3: Add the role guard**

In `src/household/routes.ts`, add `requireRole('admin', 'adult')` after `requireJwt` on all three routes:

```ts
authRouter.get('/keys', requireJwt, requireRole('admin', 'adult'), async (c) => {
```

```ts
authRouter.post('/keys', requireJwt, requireRole('admin', 'adult'), async (c) => {
```

```ts
authRouter.delete('/keys/:id', requireJwt, requireRole('admin', 'adult'), async (c) => {
```

Leave the handler bodies untouched. Add this comment above the `GET`:

```ts
// Keys are self-scoped (each handler uses `auth.userId`), but the role gate is
// still required: children get no programmatic credential for the household API.
// `requireJwt` sets `principal`, which `requireRole` reads — so this composes.
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/household-routes.test.ts
```

Expected: PASS, including the pre-existing `key-management rejects API-key auth (JWT only)` test.

- [ ] **Step 5: Commit**

```bash
git add src/household/routes.ts tests/household-routes.test.ts
git commit -m "fix(household): role-gate API key management to admin and adult"
```

---

### Task 2: `GET /m365/status` returns `connections` to adults

**Files:**
- Modify: `src/m365/routes.ts` (the `GET /status` handler and its route-table doc comment at lines ~33-45)
- Test: `tests/m365-routes.test.ts`

**Interfaces:**
- Produces: for an `adult` session, `GET /api/v1/m365/status` response `data` includes `connections: PublicM365Connection[]`. A `child` session still receives only `connection` + `feeds`.

- [ ] **Step 1: Write the failing test**

Add to `tests/m365-routes.test.ts` inside `describe('m365 routes (enabled)', ...)`:

```ts
  it('GET /status gives the household-wide connections to an adult but not to a child', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult, child } = await seedTestHousehold();
    const state = await signConnectState(adult.user.id);
    await enabledApp().request(`/api/v1/m365/callback?code=abc&state=${encodeURIComponent(state)}`);

    const asAdult = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(adult.jwt) });
    const adultBody = await asAdult.json() as { data: { connections?: { accountUpn: string }[] } };
    expect(adultBody.data.connections).toHaveLength(1);
    expect(adultBody.data.connections![0]!.accountUpn).toBe('member@contoso.test');

    const asChild = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(child.jwt) });
    const childBody = await asChild.json() as { data: { connections?: unknown[]; connection: unknown | null } };
    expect(childBody.data.connections).toBeUndefined();
    expect(childBody.data.connection).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
# DATABASE_URL must already be exported — see Global Constraints
npx vitest run tests/m365-routes.test.ts -t 'household-wide connections to an adult'
```

Expected: FAIL — `adultBody.data.connections` is `undefined`.

- [ ] **Step 3: Widen the branch**

In `src/m365/routes.ts`, replace the admin check in the `GET /status` handler:

```ts
  // The household-wide list is visible to admins AND adults: it carries no token
  // material (`toPublic` strips `refreshTokenEncrypted`) — only memberId,
  // accountUpn, status, timestamps, granted `scopes` (static config, identical
  // for every member) and the classified lastRefreshError. Same reasoning as
  // `feeds[]` above: an adult co-parent must be able to see that another
  // member's link is dead. Children stay scoped to their own connection.
  if (auth.role === 'admin' || auth.role === 'adult') {
    const [connection, connections] = await Promise.all([
      rt.store.getConnection(auth.userId),
      rt.store.listConnections(),
    ]);
    return ok(c, { connection, connections, feeds });
  }
```

Then update the route-table doc comment near the top of the file, changing

```
 *  GET    /status      (auth)  → acting member's connection (admin ALSO sees
 *                                every connection under `connections`);
```

to

```
 *  GET    /status      (auth)  → acting member's connection (admin AND adult
 *                                ALSO see every connection under
 *                                `connections`; children do not);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/m365-routes.test.ts
```

Expected: PASS — including the two pre-existing `/status` tests.

- [ ] **Step 5: Commit**

```bash
git add src/m365/routes.ts tests/m365-routes.test.ts
git commit -m "feat(m365): expose the household-wide connection list to adults"
```

---

### Task 3: `HouseholdSettings` gains `readOnly`

**Files:**
- Modify: `web/src/components/household/household-settings.tsx`
- Modify: `web/src/i18n/locales/en.json`, `web/src/i18n/locales/de.json`
- Test: `web/src/components/household/household-settings.test.tsx`

**Interfaces:**
- Produces: `HouseholdSettings` accepts `{ readOnly?: boolean }` (default `false`). When `true`: all three fields `disabled`, no Save button, hint text rendered.
- Produces: i18n key `settings.household.readOnlyHint`.

- [ ] **Step 1: Add the i18n keys**

In `web/src/i18n/locales/en.json`, inside `settings.household` (after `"locale"`):

```json
      "readOnlyHint": "Only admins can change these.",
```

In `web/src/i18n/locales/de.json`, same position:

```json
      "readOnlyHint": "Nur Admins können diese Angaben ändern.",
```

- [ ] **Step 2: Write the failing test**

Append inside the existing `describe('HouseholdSettings', ...)` block in `web/src/components/household/household-settings.test.tsx`. The suite renders bare (no provider) and drives `useHouseholdMock` per test — so the mock MUST be primed first:

```tsx
  it('renders read-only: fields disabled, no save button, hint shown', () => {
    useHouseholdMock.mockReturnValue({ data: { data: household({}) } });
    render(<HouseholdSettings readOnly />);

    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Timezone')).toBeDisabled();
    expect(screen.getByLabelText('Locale')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText('Only admins can change these.')).toBeInTheDocument();
  });

  it('stays editable by default', () => {
    useHouseholdMock.mockReturnValue({ data: { data: household({}) } });
    render(<HouseholdSettings />);

    expect(screen.getByLabelText('Name')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
```

Also fix the now-false comment above that `describe` block — it currently reads "non-admins never render this component at all, so it no longer takes (or needs) a `canManage` prop." Replace it with:

```tsx
// `readOnly` is presentation only — `PATCH /household` stays admin-gated
// server-side. Adults get this panel read-only through the settings-tab
// registry, which a later task in this branch adds.
```

Phrase it exactly like that — tense-neutral. An earlier draft said "Adults DO render this component now (see `settings-tabs.ts`)", which is false at this commit: `household.tsx` still gates the mount on `canManage`, and `settings-tabs.ts` does not exist until Task 7.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd web && npx vitest run src/components/household/household-settings.test.tsx -t 'renders read-only'
```

Expected: FAIL — `readOnly` is not a valid prop and the fields are enabled.

- [ ] **Step 4: Implement the prop**

In `web/src/components/household/household-settings.tsx`, change the signature:

```tsx
interface Props {
  /** Presentation only — `PATCH /household` is admin-gated server-side. */
  readOnly?: boolean;
}

export default function HouseholdSettings({ readOnly = false }: Props) {
```

Add `disabled={readOnly}` to the three controls and gate the button:

```tsx
        <Input id="hhname" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} /></div>
```

```tsx
        <select id="tz" className={SELECT_CLASS} value={timezone} disabled={readOnly}
          onChange={(e) => setTimezone(e.target.value)}>
```

```tsx
        <select id="locale" className={SELECT_CLASS} value={locale} disabled={readOnly}
          onChange={(e) => setLocale(e.target.value)}>
```

Replace the Save button with:

```tsx
      {readOnly
        ? <p className="text-sm text-ash">{t('settings.household.readOnlyHint')}</p>
        : <Button onClick={save} disabled={update.isPending}>{t('common.save')}</Button>}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && npx vitest run src/components/household/household-settings.test.tsx src/i18n/catalog-parity.test.ts
```

Expected: PASS, including the pre-existing editable cases and catalog parity.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/household/household-settings.tsx web/src/components/household/household-settings.test.tsx web/src/i18n/locales/en.json web/src/i18n/locales/de.json
git commit -m "feat(web): add a read-only mode to the household settings form"
```

---

### Task 4: `ConnectionsPanel` gains `readOnly`

**Files:**
- Modify: `web/src/components/household/connections-panel.tsx`
- Test: `web/src/components/household/connections-panel.test.tsx`

**Interfaces:**
- Produces: `ConnectionsPanel` accepts `{ readOnly?: boolean }` (default `false`). When `true`, the "Sync now" button is not rendered. Tables render identically.

- [ ] **Step 1: Write the failing test**

The file's `renderPanel()` helper (line 42) currently takes no arguments. Give it an optional props argument — this is a signature change every existing caller keeps working through, because the parameter is optional:

```tsx
function renderPanel(props: { readOnly?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={qc}>
      <ConnectionsPanel {...props} />
    </QueryClientProvider>,
  );
  return { ...view, invalidateSpy };
}
```

Then append inside the existing `describe('ConnectionsPanel', ...)` block:

```tsx
  it('hides the sync trigger when read-only', () => {
    renderPanel({ readOnly: true });
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument();
    // The read-only view still shows the data it exists to show.
    expect(screen.getByText('anna@example.com')).toBeInTheDocument();
  });

  it('shows the sync trigger by default', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npx vitest run src/components/household/connections-panel.test.tsx -t 'hides the sync trigger'
```

Expected: FAIL — the button is present (and `readOnly` is not a valid prop).

- [ ] **Step 3: Implement the prop**

In `web/src/components/household/connections-panel.tsx`, change the signature:

```tsx
interface Props {
  /** Presentation only — `POST /m365/sync` is admin-gated server-side. */
  readOnly?: boolean;
}

export default function ConnectionsPanel({ readOnly = false }: Props) {
```

Gate the sync row:

```tsx
      {!readOnly && (
        <div className="flex justify-end">
          <Button size="sm" onClick={syncNow} disabled={syncing}>
            <RefreshCw className="h-4 w-4 mr-1" /> {t('settings.connectionsPanel.syncNow')}
          </Button>
        </div>
      )}
```

Also reframe the component's opening doc sentence. It currently says "Admin-only household-wide overview", which this task makes stale — but do NOT replace it with "Admin and adult", because that is false until Task 8 wires the registry up. Describe the component's contract instead, which is true at every commit:

```tsx
/**
 * Household-wide overview of Microsoft 365 connections and their feed health,
 * plus a manual "sync now" trigger. Who may mount this panel is the caller's
 * decision; `readOnly` hides the sync trigger for a viewer who may not trigger
 * a sync (`POST /m365/sync` is admin-gated server-side). Reads the raw
 * …
```

Keep the comment's remaining sentences unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && npx vitest run src/components/household/connections-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/household/connections-panel.tsx web/src/components/household/connections-panel.test.tsx
git commit -m "feat(web): add a read-only mode to the connections panel"
```

---

### Task 5: `ApiKeysPanel` accepts `readOnly`

Never registered read-only (adults get full self-service), but it must honour the prop rather than ignore it, so the registry's interface is not a lie.

**Files:**
- Modify: `web/src/components/household/api-keys-panel.tsx`
- Create: `web/src/components/household/api-keys-panel.test.tsx` (if absent; otherwise modify)

**Interfaces:**
- Produces: `ApiKeysPanel` accepts `{ readOnly?: boolean }` (default `false`). When `true`, neither the "New key" button nor the per-row revoke button renders.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/household/api-keys-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ApiKeysPanel from './api-keys-panel';

vi.mock('@/hooks/use-api-keys', () => ({
  useApiKeys: () => ({
    data: { data: [{ id: 'k1', name: 'agent', keyPrefix: 'he_abc', lastUsedAt: null }] },
  }),
  useCreateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-formatters', () => ({ useFormatters: () => ({ formatDate: (s: string) => s }) }));

afterEach(() => cleanup());

describe('ApiKeysPanel', () => {
  it('offers create and revoke by default', () => {
    render(<ApiKeysPanel />);
    expect(screen.getByRole('button', { name: /new key/i })).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();
  });

  it('hides create and revoke when read-only', () => {
    render(<ApiKeysPanel readOnly />);
    expect(screen.queryByRole('button', { name: /new key/i })).not.toBeInTheDocument();
    // The key itself is still listed; only the mutating controls are gone.
    expect(screen.getByText('agent')).toBeInTheDocument();
    // queryAllByRole, NOT getAllByRole: the `getAll*` variants THROW when there
    // are no matches, so `getAllByRole(...).toHaveLength(0)` can never pass.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npx vitest run src/components/household/api-keys-panel.test.tsx
```

Expected: FAIL on the read-only case — `readOnly` is not a valid prop and both buttons render.

- [ ] **Step 3: Implement the prop**

In `web/src/components/household/api-keys-panel.tsx`, change the signature:

```tsx
interface Props {
  /**
   * Never set by the registry today — adults get full self-service on their OWN
   * keys (the endpoint is self-scoped). Honoured anyway so the SettingsTab
   * contract holds for any future contributor.
   */
  readOnly?: boolean;
}

export default function ApiKeysPanel({ readOnly = false }: Props) {
```

Gate the create button:

```tsx
        {!readOnly && (
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> {t('settings.apiKeys.newKey')}</Button>
        )}
```

Gate the revoke cell:

```tsx
                <TableCell>
                  {!readOnly && (
                    <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleRevoke(k.id, k.name)} disabled={revoke.isPending}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npx vitest run src/components/household/api-keys-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/household/api-keys-panel.tsx web/src/components/household/api-keys-panel.test.tsx
git commit -m "feat(web): honour a read-only mode in the API keys panel"
```

---

### Task 6: Extract `MembersPanel` from the household page

Pure refactor. The existing `web/src/pages/household.test.tsx` must pass **completely unchanged** — that is this task's regression net, and the reason the extraction happens before the routing work rewrites those tests.

**Files:**
- Create: `web/src/components/household/members-panel.tsx`
- Modify: `web/src/pages/household.tsx`
- Modify: `web/src/pages/household.test.tsx` (Step 1 ONLY — one added test; the three existing tests must not be touched)

**Interfaces:**
- Produces: `MembersPanel` — default export, props `{ readOnly?: boolean }`. Owns `useMembers`, `useCreateMember`, `useUpdateMember`, `useSetMemberRole`, `useDeleteMember`, the add/edit dialog, and its own `ErrorState` for a failed members query.

- [ ] **Step 1: First, cover the behaviour this task MOVES**

The three existing page tests cover tab gating and the roster, but nothing covers the members-query **error path** — and that is precisely what moves: `household.tsx:27` currently does `retryOf(whoamiQuery, membersQuery)` at page level, and after extraction the members half lives in the panel. Without this test the move is unprotected.

Add to `web/src/pages/household.test.tsx`, and extend its imports with `fireEvent`:

```tsx
  it('shows the load error and retries when the members query fails', () => {
    const refetch = vi.fn();
    useWhoamiMock.mockReturnValue({ data: { data: { role: 'admin' } }, isError: false, refetch: vi.fn() });
    useMembersMock.mockReturnValue({ data: undefined, isError: true, refetch });

    render(<HouseholdPage />);

    expect(screen.getByText('We couldn’t load your household.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
```

Note the message uses a typographic apostrophe (`’`) — that is what `settings.loadError` contains in `en.json`. Run it and confirm it PASSES **before** the extraction (it documents current behaviour), then keep it passing after.

```bash
cd web && npx vitest run src/pages/household.test.tsx
```

- [ ] **Step 2: Create the panel**

Create `web/src/components/household/members-panel.tsx` with the logic moved verbatim out of `household.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import MembersTable from '@/components/household/members-table';
import MemberForm from '@/components/household/member-form';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useMembers, useCreateMember, useUpdateMember, useSetMemberRole, useDeleteMember } from '@/hooks/use-household';
import type { Member, Role } from '@/lib/types';
import { ApiError } from '@/api/client';

interface Props {
  /** Presentation only — every member mutation is admin-gated server-side. */
  readOnly?: boolean;
}

/**
 * The household member roster and its add/edit dialog. Uses the RAW
 * `useMembers()` (not `useHouseholdMembers()`) because this table is one of the
 * two places that must still show the maintenance admin.
 */
export default function MembersPanel({ readOnly = false }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const membersQuery = useMembers();
  const members = membersQuery.data?.data ?? [];
  const retry = retryOf(membersQuery);

  const createM = useCreateMember();
  const updateM = useUpdateMember();
  const setRole = useSetMemberRole();
  const deleteM = useDeleteMember();

  const [editing, setEditing] = useState<Member | null>(null);
  const [open, setOpen] = useState(false);

  const submit = async (input: Parameters<typeof createM.mutateAsync>[0]) => {
    try {
      if (editing) {
        const patch: { displayName?: string; avatarColor?: typeof input.avatarColor; email?: string; password?: string } = {
          displayName: input.displayName, avatarColor: input.avatarColor, email: input.email,
        };
        if (input.password) patch.password = input.password;
        await updateM.mutateAsync({ id: editing.id, input: patch });
      } else {
        await createM.mutateAsync(input);
      }
      setOpen(false);
      toast(t('settings.members.saved'), 'success');
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'CONFLICT' ? t('settings.members.emailTaken') : (e as Error).message;
      toast(msg || t('settings.members.saveFailed'), 'error');
    }
  };

  const changeRole = async (id: string, role: Role) => {
    try { await setRole.mutateAsync({ id, role }); toast(t('settings.members.roleUpdated'), 'success'); }
    catch (e) { toast((e as Error).message || t('settings.members.roleUpdateFailed'), 'error'); }
  };

  const remove = async (m: Member) => {
    if (!confirm(t('settings.members.removeConfirm', { name: m.displayName }))) return;
    try { await deleteM.mutateAsync(m.id); toast(t('settings.members.removed'), 'success'); }
    catch (e) {
      const msg = e instanceof ApiError && e.code === 'CONFLICT' ? t('settings.members.removeLastAdminError') : (e as Error).message;
      toast(msg || t('settings.members.removeFailed'), 'error');
    }
  };

  if (retry) return <ErrorState message={t('settings.loadError')} onRetry={retry} />;

  return (
    <>
      {!readOnly && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> {t('settings.members.addMember')}</Button>
        </div>
      )}
      <Card><CardContent className="p-2">
        <MembersTable members={members} canManage={!readOnly} onEdit={(m) => { setEditing(m); setOpen(true); }} onRole={changeRole} onDelete={remove} />
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('settings.members.editMember') : t('settings.members.addMember')}</DialogTitle>
            <DialogClose onClose={() => setOpen(false)} />
          </DialogHeader>
          <MemberForm member={editing ?? undefined} onSubmit={submit} onCancel={() => setOpen(false)} isLoading={createM.isPending || updateM.isPending} />
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Slim down the page to use it**

Replace `web/src/pages/household.tsx` entirely. The tab structure stays exactly as it is today — only the members content moves:

```tsx
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ApiKeysPanel from '@/components/household/api-keys-panel';
import HouseholdSettings from '@/components/household/household-settings';
import ConnectionsPanel from '@/components/household/connections-panel';
import MembersPanel from '@/components/household/members-panel';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useWhoami } from '@/hooks/use-household';

export default function HouseholdPage() {
  const { t } = useTranslation();
  const whoamiQuery = useWhoami();
  const canManage = whoamiQuery.data?.data.role === 'admin';
  const retry = retryOf(whoamiQuery);

  if (retry) return <ErrorState message={t('settings.loadError')} onRetry={retry} />;

  return (
    <Tabs defaultValue="members" className="space-y-4">
      <TabsList>
        <TabsTrigger value="members">{t('settings.tabs.members')}</TabsTrigger>
        {canManage && <TabsTrigger value="keys">{t('settings.tabs.apiKeys')}</TabsTrigger>}
        {canManage && <TabsTrigger value="settings">{t('settings.tabs.settings')}</TabsTrigger>}
        {canManage && <TabsTrigger value="connections">{t('settings.tabs.connections')}</TabsTrigger>}
      </TabsList>

      <TabsContent value="members">
        <MembersPanel readOnly={!canManage} />
      </TabsContent>

      {canManage && (
        <TabsContent value="keys">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('settings.tabs.apiKeys')}</CardTitle></CardHeader>
            <CardContent><ApiKeysPanel /></CardContent>
          </Card>
        </TabsContent>
      )}

      {canManage && (
        <TabsContent value="settings">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('nav.household')}</CardTitle></CardHeader>
            <CardContent><HouseholdSettings /></CardContent>
          </Card>
        </TabsContent>
      )}

      {canManage && (
        <TabsContent value="connections">
          <ConnectionsPanel />
        </TabsContent>
      )}
    </Tabs>
  );
}
```

- [ ] **Step 4: Run the page tests, unchanged since Step 1**

```bash
cd web && npx vitest run src/pages/household.test.tsx && npx tsc --noEmit
```

Expected: PASS — all four tests (the three originals plus the error-path test from Step 1), with no edit to the test file after Step 1. If any fail, the extraction changed behaviour; fix the panel, not the test.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/household/members-panel.tsx web/src/pages/household.tsx web/src/pages/household.test.tsx
git commit -m "refactor(web): extract MembersPanel out of the household page"
```

---

### Task 7: The settings-tab registry

**Files:**
- Create: `web/src/lib/settings-tabs.ts`
- Test: `web/src/lib/settings-tabs.test.ts`

**Interfaces:**
- Produces: `TabAccess { visible: boolean; readOnly: boolean }`; `SettingsTab { id, labelKey, access, card?, Panel }`; `byRole({ roles, readOnlyFor? })`; `SETTINGS_TABS`; `DEFAULT_SETTINGS_TAB = 'members'`; `findSettingsTab(id: string): SettingsTab | undefined`.
- Note: the spec named a separate `isSettingsTabId()` guard. It is subsumed by `findSettingsTab()` returning `undefined` — one lookup instead of two functions doing the same scan.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/settings-tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { byRole, findSettingsTab, SETTINGS_TABS, DEFAULT_SETTINGS_TAB } from './settings-tabs';
import type { Member, Role } from '@/lib/types';

function memberWith(role: Role, handle: string | null = 'someone'): Member {
  return {
    id: 'm1', createdAt: '', updatedAt: '', email: 'a@b.test', handle,
    role, displayName: 'Someone', avatarColor: 'ember',
  };
}

describe('byRole', () => {
  it('makes a tab visible only to the listed roles', () => {
    const access = byRole({ roles: ['admin', 'adult'] });
    expect(access(memberWith('admin')).visible).toBe(true);
    expect(access(memberWith('adult')).visible).toBe(true);
    expect(access(memberWith('child')).visible).toBe(false);
  });

  it('marks only the readOnlyFor roles read-only', () => {
    const access = byRole({ roles: ['admin', 'adult'], readOnlyFor: ['adult'] });
    expect(access(memberWith('admin')).readOnly).toBe(false);
    expect(access(memberWith('adult')).readOnly).toBe(true);
  });

  it('defaults readOnlyFor to nobody', () => {
    const access = byRole({ roles: ['admin', 'adult'] });
    expect(access(memberWith('adult')).readOnly).toBe(false);
  });
});

describe('SETTINGS_TABS', () => {
  it('gates the four tabs as designed', () => {
    const visibleTo = (role: Role) =>
      SETTINGS_TABS.filter((tab) => tab.access(memberWith(role)).visible).map((tab) => tab.id);

    expect(visibleTo('admin')).toEqual(['members', 'keys', 'settings', 'connections']);
    expect(visibleTo('adult')).toEqual(['members', 'keys', 'settings', 'connections']);
    expect(visibleTo('child')).toEqual(['members']);
  });

  it('makes settings and connections read-only for an adult but not an admin', () => {
    const readOnlyFor = (role: Role) =>
      SETTINGS_TABS.filter((tab) => tab.access(memberWith(role)).readOnly).map((tab) => tab.id);

    expect(readOnlyFor('adult')).toEqual(['members', 'settings', 'connections']);
    expect(readOnlyFor('admin')).toEqual([]);
  });

  it('keeps the default tab visible to every role so it is always a valid fallback', () => {
    const fallback = findSettingsTab(DEFAULT_SETTINGS_TAB);
    expect(fallback).toBeDefined();
    for (const role of ['admin', 'adult', 'child'] as Role[]) {
      expect(fallback!.access(memberWith(role)).visible).toBe(true);
    }
  });
});

describe('findSettingsTab', () => {
  it('resolves a known id and rejects an unknown one', () => {
    expect(findSettingsTab('settings')?.id).toBe('settings');
    expect(findSettingsTab('nope')).toBeUndefined();
    expect(findSettingsTab('')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npx vitest run src/lib/settings-tabs.test.ts
```

Expected: FAIL — cannot resolve `./settings-tabs`.

- [ ] **Step 3: Create the registry**

Create `web/src/lib/settings-tabs.ts`:

```ts
import type { ComponentType } from 'react';
import type { ParseKeys } from 'i18next';
import type { Member, Role } from '@/lib/types';
import MembersPanel from '@/components/household/members-panel';
import ApiKeysPanel from '@/components/household/api-keys-panel';
import HouseholdSettings from '@/components/household/household-settings';
import ConnectionsPanel from '@/components/household/connections-panel';

/** A catalog key, so `t(tab.labelKey)` type-checks like a literal would. */
type TranslationKey = ParseKeys<'translation'>;

export interface TabAccess {
  visible: boolean;
  readOnly: boolean;
}

/**
 * A contributed settings tab on /household. Add an entry to SETTINGS_TABS and
 * the tab, its URL (/household/<id>) and its panel all appear — no route or page
 * edit needed. Mirrors the PROVIDERS registry in `providers.ts`.
 *
 * `access` is PRESENTATION ONLY. It decides what is shown, never what is
 * permitted: the API's own role guards are the authorization boundary.
 */
export interface SettingsTab {
  /** URL segment under /household and the React key. Keep it slug-safe. */
  id: string;
  labelKey: TranslationKey;
  /**
   * Who may open this tab, and whether they get it read-only. A predicate over
   * the whole Member, NOT a role list: the maintenance admin is quarantined by
   * `handle` (see `maintenance-admin.ts` and profile.tsx), so a role list could
   * not express "admin except the maintenance admin".
   */
  access: (member: Member) => TabAccess;
  /**
   * Wrap the panel in a titled Card. Omit when the panel renders its own chrome
   * (members brings its own Card; connections is a multi-card layout).
   */
  card?: { titleKey: TranslationKey };
  Panel: ComponentType<{ readOnly: boolean }>;
}

/** The common case: gate on role alone. */
export function byRole({ roles, readOnlyFor = [] }: { roles: Role[]; readOnlyFor?: Role[] }): SettingsTab['access'] {
  return (member: Member): TabAccess => ({
    visible: roles.includes(member.role),
    readOnly: readOnlyFor.includes(member.role),
  });
}

export const SETTINGS_TABS = [
  {
    id: 'members',
    labelKey: 'settings.tabs.members',
    access: byRole({ roles: ['admin', 'adult', 'child'], readOnlyFor: ['adult', 'child'] }),
    Panel: MembersPanel,
  },
  {
    id: 'keys',
    labelKey: 'settings.tabs.apiKeys',
    access: byRole({ roles: ['admin', 'adult'] }),
    card: { titleKey: 'settings.tabs.apiKeys' },
    Panel: ApiKeysPanel,
  },
  {
    id: 'settings',
    labelKey: 'settings.tabs.settings',
    access: byRole({ roles: ['admin', 'adult'], readOnlyFor: ['adult'] }),
    card: { titleKey: 'nav.household' },
    Panel: HouseholdSettings,
  },
  {
    id: 'connections',
    labelKey: 'settings.tabs.connections',
    access: byRole({ roles: ['admin', 'adult'], readOnlyFor: ['adult'] }),
    Panel: ConnectionsPanel,
  },
] as const satisfies readonly SettingsTab[];

/**
 * The fallback tab. MUST stay visible to every role — an unknown or forbidden
 * tab id redirects here, so a role-gated default would loop.
 */
export const DEFAULT_SETTINGS_TAB = 'members';

/**
 * Resolve a `$tab` route param, which is an arbitrary string. `undefined` means
 * "no such tab" — this runtime check is the authority, not the param's type.
 */
export function findSettingsTab(id: string): SettingsTab | undefined {
  return SETTINGS_TABS.find((tab) => tab.id === id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npx vitest run src/lib/settings-tabs.test.ts && npx tsc --noEmit
```

Expected: PASS and a clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/settings-tabs.ts web/src/lib/settings-tabs.test.ts
git commit -m "feat(web): add the household settings-tab registry"
```

---

### Task 8: Route-per-tab — layout, `$tab` route, index redirect

The behaviour change lands here: adults gain all four tabs, and each tab gets its own URL.

**Files:**
- Create: `web/src/components/household/settings-tab-panel.tsx`
- Modify: `web/src/pages/household.tsx`
- Modify: `web/src/app.tsx:77,84-91`
- Modify: `web/src/pages/household.test.tsx` (converted to a memory-router harness)

**Interfaces:**
- Consumes: `SETTINGS_TABS`, `DEFAULT_SETTINGS_TAB`, `findSettingsTab` from Task 7.
- Produces: routes `/household` (index → redirect) and `/household/$tab`.

- [ ] **Step 1: Create the `$tab` route component**

Create `web/src/components/household/settings-tab-panel.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWhoami } from '@/hooks/use-household';
import { DEFAULT_SETTINGS_TAB, findSettingsTab } from '@/lib/settings-tabs';

/**
 * Renders the settings tab named by the `$tab` route param.
 *
 * An unknown id and a forbidden one are handled IDENTICALLY (redirect to the
 * default tab): a tab the member may not open must not be distinguishable from
 * one that does not exist.
 */
export default function SettingsTabPanel() {
  const { t } = useTranslation();
  const { tab } = useParams({ from: '/household/$tab' });
  const whoamiQuery = useWhoami();
  const member = whoamiQuery.data?.data;

  // Authorization is NOT evaluated until whoami resolves. Treating "no member
  // yet" as "not permitted" would bounce a deep link (/household/keys) back to
  // the default tab before the real role arrived.
  if (!member) return <div className="text-sm text-ash">{t('common.loading')}</div>;

  const entry = findSettingsTab(tab);
  const access = entry?.access(member);
  if (!entry || !access?.visible) {
    return <Navigate to="/household/$tab" params={{ tab: DEFAULT_SETTINGS_TAB }} replace />;
  }

  const { Panel, card } = entry;
  const panel = <Panel readOnly={access.readOnly} />;
  if (!card) return panel;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t(card.titleKey)}</CardTitle></CardHeader>
      <CardContent>{panel}</CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Turn the page into a layout**

Replace `web/src/pages/household.tsx` entirely:

```tsx
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useWhoami } from '@/hooks/use-household';
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS } from '@/lib/settings-tabs';

/**
 * Layout for /household: the role-filtered tab strip plus the active tab's
 * route. The tab list comes from SETTINGS_TABS, so a contributed tab needs no
 * edit here (see `settings-tabs.ts`).
 */
export default function HouseholdPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab } = useParams({ strict: false });
  const whoamiQuery = useWhoami();
  const member = whoamiQuery.data?.data;
  const retry = retryOf(whoamiQuery);

  if (retry) return <ErrorState message={t('settings.loadError')} onRetry={retry} />;
  if (!member) return <div className="text-sm text-ash">{t('common.loading')}</div>;

  const visible = SETTINGS_TABS.filter((entry) => entry.access(member).visible);

  return (
    <Tabs
      value={typeof tab === 'string' ? tab : DEFAULT_SETTINGS_TAB}
      onValueChange={(next) => navigate({ to: '/household/$tab', params: { tab: next } })}
      className="space-y-4"
    >
      <TabsList>
        {visible.map((entry) => (
          <TabsTrigger key={entry.id} value={entry.id}>{t(entry.labelKey)}</TabsTrigger>
        ))}
      </TabsList>
      <div className="mt-2"><Outlet /></div>
    </Tabs>
  );
}
```

- [ ] **Step 3: Wire the routes**

In `web/src/app.tsx`, add the import:

```tsx
import SettingsTabPanel from '@/components/household/settings-tab-panel';
import { DEFAULT_SETTINGS_TAB } from '@/lib/settings-tabs';
```

Add the two child routes immediately after the existing `householdRoute` declaration (line 77):

```tsx
// /household is a layout, not a leaf: it renders the tab strip plus the active
// tab's route. The index redirects so the URL always names a tab.
const householdIndexRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/household/$tab', params: { tab: DEFAULT_SETTINGS_TAB } });
  },
});
const householdTabRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: '$tab',
  component: SettingsTabPanel,
});
```

Then give `householdRoute` its children in the route tree — replace the bare `householdRoute` in the `authRoute.addChildren([...])` list with:

```tsx
    householdRoute.addChildren([householdIndexRoute, householdTabRoute]),
```

- [ ] **Step 4: Convert the page tests to a memory-router harness**

Replace `web/src/pages/household.test.tsx` entirely. The harness mirrors the existing local pattern in `web/src/components/pwa/update-banner.test.tsx:19-27`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import {
  createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider, redirect,
} from '@tanstack/react-router';
import HouseholdPage from './household';
import SettingsTabPanel from '@/components/household/settings-tab-panel';
import { DEFAULT_SETTINGS_TAB } from '@/lib/settings-tabs';

const useWhoamiMock = vi.fn();
const useMembersMock = vi.fn();

vi.mock('@/hooks/use-household', () => ({
  useWhoami: () => useWhoamiMock(),
  useMembers: () => useMembersMock(),
  useCreateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetMemberRole: () => ({ mutateAsync: vi.fn() }),
  useDeleteMember: () => ({ mutateAsync: vi.fn() }),
}));

// Each panel's own behaviour is covered by its own suite; stubbed here so this
// file only exercises the layout's tab gating and the routing.
vi.mock('@/components/household/connections-panel', () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => <div>connections-panel-stub:{String(!!readOnly)}</div>,
}));
vi.mock('@/components/household/api-keys-panel', () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => <div>api-keys-panel-stub:{String(!!readOnly)}</div>,
}));
vi.mock('@/components/household/household-settings', () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => <div>household-settings-stub:{String(!!readOnly)}</div>,
}));

const members = [
  { id: 'a', role: 'admin' as const, displayName: 'Admin', email: 'admin@example.com', avatarColor: 'ember' as const },
  { id: 'b', role: 'adult' as const, displayName: 'Anna', email: 'anna@example.com', avatarColor: 'sage' as const },
];

function setRole(role: 'admin' | 'adult' | 'child') {
  useWhoamiMock.mockReturnValue({
    data: { data: { id: 'b', handle: 'anna', role, displayName: 'Anna' } },
    isError: false, refetch: vi.fn(),
  });
  useMembersMock.mockReturnValue({ data: { data: members }, isError: false, refetch: vi.fn() });
}

/** whoami still in flight: no data, no error. */
function setWhoamiPending() {
  useWhoamiMock.mockReturnValue({ data: undefined, isError: false, refetch: vi.fn() });
  useMembersMock.mockReturnValue({ data: { data: members }, isError: false, refetch: vi.fn() });
}

/** Mounts the real /household layout + $tab child route at `path`. */
function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const householdRoute = createRoute({ getParentRoute: () => rootRoute, path: '/household', component: HouseholdPage });
  const indexRoute = createRoute({
    getParentRoute: () => householdRoute,
    path: '/',
    beforeLoad: () => { throw redirect({ to: '/household/$tab', params: { tab: DEFAULT_SETTINGS_TAB } }); },
  });
  const tabRoute = createRoute({ getParentRoute: () => householdRoute, path: '$tab', component: SettingsTabPanel });
  const routeTree = rootRoute.addChildren([householdRoute.addChildren([indexRoute, tabRoute])]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return { router, ...render(<RouterProvider router={router} />) };
}

afterEach(() => {
  cleanup();
  useWhoamiMock.mockReset();
  useMembersMock.mockReset();
});

describe('HouseholdPage tab gating', () => {
  it('shows all four tabs to an admin', async () => {
    setRole('admin');
    renderAt('/household/members');

    expect(await screen.findByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  });

  it('shows all four tabs to an adult too', async () => {
    setRole('adult');
    renderAt('/household/members');

    expect(await screen.findByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  });

  it('shows only the Members tab to a child', async () => {
    setRole('child');
    renderAt('/household/members');

    expect(await screen.findByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'API keys' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connections' })).not.toBeInTheDocument();
  });

  it('renders the Members content read-only for an adult', async () => {
    setRole('adult');
    renderAt('/household/members');

    expect(await screen.findByText('Anna')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add member/i })).not.toBeInTheDocument();
  });
});

describe('HouseholdPage read-only propagation', () => {
  it('passes readOnly=true to the settings panel for an adult', async () => {
    setRole('adult');
    renderAt('/household/settings');
    expect(await screen.findByText('household-settings-stub:true')).toBeInTheDocument();
  });

  it('passes readOnly=false to the settings panel for an admin', async () => {
    setRole('admin');
    renderAt('/household/settings');
    expect(await screen.findByText('household-settings-stub:false')).toBeInTheDocument();
  });

  it('passes readOnly=true to the connections panel for an adult', async () => {
    setRole('adult');
    renderAt('/household/connections');
    expect(await screen.findByText('connections-panel-stub:true')).toBeInTheDocument();
  });

  it('leaves the API keys panel writable for an adult', async () => {
    setRole('adult');
    renderAt('/household/keys');
    expect(await screen.findByText('api-keys-panel-stub:false')).toBeInTheDocument();
  });
});

describe('HouseholdPage routing', () => {
  it('redirects /household to the default tab', async () => {
    setRole('admin');
    const { router } = renderAt('/household');
    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });

  it('redirects an unknown tab to the default tab', async () => {
    setRole('admin');
    const { router } = renderAt('/household/does-not-exist');
    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });

  it('redirects a tab the member may not open to the default tab', async () => {
    setRole('child');
    const { router } = renderAt('/household/keys');
    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });

  it('does NOT redirect a deep link while whoami is still loading', async () => {
    setWhoamiPending();
    const { router } = renderAt('/household/keys');

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/household/keys');
  });

  // The test above only proves the LAYOUT holds the line: its `if (!member)`
  // returns before <Outlet />, so SettingsTabPanel never mounts and a broken
  // guard inside it would pass vacuously. This mounts the panel under a parent
  // that always renders its Outlet, so the panel's own guard is what is tested.
  it('SettingsTabPanel itself does not redirect while whoami is loading', async () => {
    setWhoamiPending();
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const householdRoute = createRoute({
      getParentRoute: () => rootRoute, path: '/household', component: () => <Outlet />,
    });
    const tabRoute = createRoute({
      getParentRoute: () => householdRoute, path: '$tab', component: SettingsTabPanel,
    });
    const routeTree = rootRoute.addChildren([householdRoute.addChildren([tabRoute])]);
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/household/keys'] }) });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/household/keys');
  });

  // Same harness, but with a resolved role — proves the panel DOES redirect a
  // forbidden tab once it knows the role, so the test above is not just
  // asserting that the panel never redirects at all.
  it('SettingsTabPanel redirects a forbidden tab once the role is known', async () => {
    setRole('child');
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const householdRoute = createRoute({
      getParentRoute: () => rootRoute, path: '/household', component: () => <Outlet />,
    });
    const tabRoute = createRoute({
      getParentRoute: () => householdRoute, path: '$tab', component: SettingsTabPanel,
    });
    const routeTree = rootRoute.addChildren([householdRoute.addChildren([tabRoute])]);
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/household/keys'] }) });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe('/household/members'));
  });
});
```

Extend this file's router import with `Outlet` for the two tests above.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && npx vitest run src/pages/household.test.tsx && npx tsc --noEmit
```

Expected: PASS on all twelve cases and a clean typecheck. If the `whoami`-pending case redirects, the guard in `settings-tab-panel.tsx` is checking `access` before `member` — fix the order.

- [ ] **Step 6: Run the whole web suite**

```bash
cd web && npm test
```

Expected: PASS. `catalog-parity` and every panel suite must still be green.

- [ ] **Step 7: Commit**

```bash
git add web/src/app.tsx web/src/pages/household.tsx web/src/pages/household.test.tsx web/src/components/household/settings-tab-panel.tsx
git commit -m "feat(web): give every household settings tab its own route"
```

---

### Task 9: Navigation target and page title

Both follow from `/household` no longer being a leaf.

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx:42`
- Modify: `web/src/components/layout/app-shell.tsx:24`
- Test: `web/src/components/layout/app-shell.test.tsx` (create if absent)

**Interfaces:**
- Produces: nav item points at `/household/members`; the header title resolves for any `/household/*` path.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/layout/page-title.test.ts`. First extract the lookup so it is testable — in `web/src/components/layout/app-shell.tsx`, replace the inline lookup with an exported helper:

```tsx
/**
 * Resolve the header title for a path. Exact match first, then longest matching
 * prefix — /household is a layout now, so /household/members must still resolve
 * to "Household" instead of falling through to the app name.
 */
type PageTitleKey = NavLabelKey | 'nav.homeTitle';

export function titleKeyFor(pathname: string): PageTitleKey | undefined {
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  return Object.entries(PAGE_TITLES)
    .filter(([path]) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
}
```

`PAGE_TITLES` is already declared as `Record<string, NavLabelKey | 'nav.homeTitle'>` at `app-shell.tsx:9` and `NavLabelKey` is already imported at line 7 — reuse that union as `PageTitleKey` rather than widening or re-typing the map.

Then the test:

```ts
import { describe, it, expect } from 'vitest';
import { titleKeyFor } from './app-shell';
import { navItems } from './sidebar';

describe('titleKeyFor', () => {
  it('resolves an exact route', () => {
    expect(titleKeyFor('/calendar')).toBe('nav.calendar');
    expect(titleKeyFor('/')).toBe('nav.homeTitle');
  });

  it('resolves a nested household tab to the household title', () => {
    expect(titleKeyFor('/household')).toBe('nav.household');
    expect(titleKeyFor('/household/members')).toBe('nav.household');
    expect(titleKeyFor('/household/connections')).toBe('nav.household');
  });

  it('returns undefined for an unknown path', () => {
    expect(titleKeyFor('/nope')).toBeUndefined();
  });

  it('points the household nav item at a concrete tab so a click costs no redirect', () => {
    const household = navItems.find((item) => item.labelKey === 'nav.household');
    expect(household?.to).toBe('/household/members');
    // …but keeps /household as its active range, or the item would go dim on
    // every tab except Members. See `activePrefix` in sidebar.tsx.
    expect(household?.activePrefix).toBe('/household');
  });

  it('treats every household tab as active for the household nav item', () => {
    const household = navItems.find((item) => item.labelKey === 'nav.household')!;
    expect(isNavItemActive(household, '/household/members')).toBe(true);
    expect(isNavItemActive(household, '/household/settings')).toBe(true);
    expect(isNavItemActive(household, '/household')).toBe(true);
    expect(isNavItemActive(household, '/householding')).toBe(false);
  });

  it('still matches non-prefixed items exactly as before', () => {
    const home = navItems.find((item) => item.labelKey === 'nav.thisWeek')!;
    expect(isNavItemActive(home, '/')).toBe(true);
    expect(isNavItemActive(home, '/calendar')).toBe(false);
  });
});
```

Import `isNavItemActive` from `./sidebar` alongside `navItems`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npx vitest run src/components/layout/page-title.test.ts
```

Expected: FAIL — `titleKeyFor` is not exported, and the nav item still points at `/household`.

- [ ] **Step 3: Apply both changes**

In `app-shell.tsx`, use the helper in the component:

```tsx
  const titleKey = titleKeyFor(router.state.location.pathname);
  const title = titleKey ? t(titleKey) : 'Heorth';
```

In `sidebar.tsx`, the nav target changes AND the active check must be widened. `sidebar.tsx:58` currently reads `const active = exact ? pathname === to : pathname.startsWith(to)` — with `to` pointing at `/household/members`, `/household/settings` would no longer match and the item would go dim on every tab but Members. Add an `activePrefix` escape hatch and extract the predicate so it can be tested:

```tsx
interface NavItem {
  to: string;
  labelKey: NavLabelKey;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  /**
   * Path range that counts as "on this item", when `to` is deeper than the
   * section it represents. /household is a layout whose index only redirects, so
   * the item links straight to a tab but must stay lit on all of them.
   */
  activePrefix?: string;
}

/** Exported for testing: is `pathname` within this item's active range? */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  const base = item.activePrefix ?? item.to;
  return pathname === base || pathname.startsWith(`${base}/`);
}
```

Note this also tightens the old behaviour: `startsWith(to)` matched `/householding` for `to: '/household'`; the `===` / `${base}/` form does not. Then the nav entry:

```tsx
  { to: '/household/members', labelKey: 'nav.household', icon: Home, activePrefix: '/household' },
```

And in the `navItems.map(...)` body, replace the inline check:

```tsx
        {navItems.map((item) => {
          const { to, labelKey, icon: Icon } = item;
          const active = isNavItemActive(item, pathname);
```

`mobile-nav.tsx` also consumes `navItems`, but its "More" sheet renders plain links with no active state (`mobile-nav.tsx:63-70`), so it needs no change — verify this rather than assuming it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && npx vitest run src/components/layout/page-title.test.ts && npx tsc --noEmit
```

Expected: PASS and a clean typecheck.

- [ ] **Step 5: Verify the whole suite, both sides**

```bash
cd web && npm test
cd .. && npm run typecheck && npm run build
# DATABASE_URL must already be exported — see Global Constraints
npm test
```

Expected: all green. Report any failure with its output rather than proceeding.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/layout/sidebar.tsx web/src/components/layout/app-shell.tsx web/src/components/layout/page-title.test.ts
git commit -m "fix(web): link the household nav at its default tab and resolve nested titles"
```

---

## Manual verification

After Task 9, run the app (`/run-local` skill or `npm run dev` in both roots) and check:

1. Sign in as an admin → `/household` lands on `/household/members`, all four tabs present, settings editable, "Sync now" visible.
2. Click each tab → the URL changes to `/household/<id>`; reload the page → the same tab is still active.
3. Header title reads "Household" on every tab.
4. Sign in as an adult → all four tabs present; Settings fields greyed out with the hint and no Save; Connections shows the member table with no "Sync now"; API keys can create and revoke.
5. As an adult, visit `/household/does-not-exist` → redirected to `/household/members`.
6. Sign in as a child → only Members; visiting `/household/keys` redirects to `/household/members`; `curl` the same child JWT against `GET /api/v1/auth/keys` → 403.

## Deviations from the spec, and why

- **`isSettingsTabId()` is not implemented.** `findSettingsTab()` returning `undefined` is the same check and the lookup is needed anyway. One function, not two scans.
- **The members tab has no `card` entry.** Today's members tab is `<Card><CardContent className="p-2">` with no header; a registry `card` would add a title it never had. `MembersPanel` keeps its own Card so the appearance is byte-identical.
- **Task order inverts the spec's risk note.** The spec suggested converting the test harness before extracting `MembersPanel`; this plan extracts first, verified by the existing tests plus one added error-path test (Task 6 Step 1) — the three original tests are never edited in that task. That is a stronger regression net than extracting against a harness rewritten in the same change.
- **`sidebar.tsx` gains an `activePrefix` field and an exported `isNavItemActive`.** Not in the spec, which mentioned only retargeting the link. Retargeting alone would break active highlighting on every household tab except Members, so the predicate change is required, not optional.

## Review

The plan was reviewed independently by Codex (read-only, plan-vs-spec-vs-code) on 2026-08-05 and corrected accordingly:

- **Accepted (MEDIUM):** the sidebar active-state break described above — the original plan's prose wrongly claimed the item "still highlights on any /household/* path".
- **Accepted (LOW):** the `whoami`-pending test was vacuous, because the layout returns before `<Outlet />` so `SettingsTabPanel` never mounted. Task 8 now also mounts the panel under an always-rendering parent, plus a positive counterpart proving it *does* redirect once the role is known.
- **Accepted (LOW):** Task 6's regression net was thinner than claimed — the members-query error path moves into the panel and nothing covered it. Now covered before the move.
- **Fixed:** the header said React 19; the project is on React 18.3.

Separately verified by prototyping the registry's exact type structure under `npx tsc --noEmit` (exit 0): `as const satisfies readonly SettingsTab[]`, `ParseKeys<'translation'>` with every literal key used, and `ComponentType<{ readOnly: boolean }>` accepting panels declared with `readOnly?: boolean`. Codex independently confirmed the TanStack Router 1.114 call shapes (`path: '$tab'`, both `useParams` overloads, `Navigate`, `redirect({ to, params })`) and that Task 5's `getAllByRole('button')` assertion holds because closed dialogs render `null`.
