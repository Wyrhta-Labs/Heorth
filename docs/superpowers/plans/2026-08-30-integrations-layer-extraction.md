# Integrations Layer Extraction (Google Provider, Phases 1+3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a provider-neutral `src/integrations/` layer out of `src/m365/` so a second calendar/task provider can slot in beside Microsoft 365, and fix the two behaviour defects that block it — the shared task list resolved by display name, and full-resync truncating the mirrors.

**Architecture:** `src/m365/` today owns both the Microsoft Graph implementation *and* the generic machinery around it (connections, per-feed sync state, token encryption, the sync runner, the scheduler, the routes). The generic half moves to `src/integrations/`, gains a `provider` scope, and exposes a registry that providers register into. `src/m365/` keeps only Graph. Most moves are done behind a re-export shim so the build and the full suite stay green at each task boundary; the shims are deleted in Task 8.

**The one exception, found during execution:** a shim aliases *symbols*, so it cannot cover the column rename and constraint change in Task 3. **Tasks 3 and 4 are one green boundary and one review unit** — see the correction note in Task 3, Step 5. Every other task boundary is green on its own.

**Tech Stack:** Node.js 22, TypeScript (ESM, `.js` import specifiers), Hono, Drizzle ORM, PostgreSQL 18, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-google-calendar-tasks-provider-design.md`

This plan implements **Phase 1** and **Phase 3** of that spec. Phase 2 (the Google provider itself) gets its own plan once this one lands.

## Global Constraints

Copied from `AGENTS.md` and the spec. Every task's requirements implicitly include this section.

- **ESM import specifiers end in `.js`** in `src/`, even for TypeScript files.
- **Schema must be registered in BOTH barrels:** `src/db/schema/drizzle-schema.ts` (drizzle-kit, **no** `.js`) and `src/db/schema/index.ts` (runtime, **with** `.js`).
- **Generate migrations** with `npm run db:generate -- --name <name>`. **Never hand-edit the snapshots in `src/db/migrations/meta/`.** Appending data-migration SQL (`UPDATE …`) to the generated `.sql` file is expected and permitted — that is not a snapshot.
- **Tests hit a real Postgres** and truncate every table per test. `DATABASE_URL` **must** name a database ending in `_test`; `tests/setup.ts` enforces an allowlist. Default: `postgres://heorth:changeme@localhost:15432/heorth_test`.
- **Never call a real external service from a test.** Fakes install through the `set*Runtime()` seam.
- **The scheduler and sync runners never run under tests** (guarded on `VITEST`).
- **Never classify a query failure by reading `e.code`.** Use `pgErrorCode` / `isPgError` from `@wyrhta/core/db`, which walk the `DrizzleQueryError` cause chain.
- **Store absolute UTC instants.** A source timezone is display metadata only.
- **Never log or return token material**, anywhere.
- **Optional integrations are gated as a GROUP, never per variable** — all present → configured; all absent → no-op module; partial → startup error. Changing a group means touching the schema group, the `superRefine` check, **and** the `config.<group>` object in `src/config/env.ts`.
- **No AI co-author trailers in commit messages.**
- **Commit messages and all produced text in English.**

### Commands

```bash
export DATABASE_URL=postgres://heorth:changeme@localhost:15432/heorth_test
npm run typecheck                              # must pass at every task boundary
npm test                                       # full backend suite
npx vitest run tests/<file>.test.ts            # one file
npx vitest run tests/<file>.test.ts -t "name"  # one test
cd web && npm test                             # web suite (Task 14 only)
```

## Two refinements to the spec

Recorded here because an executor reading only the spec would be surprised:

1. **The spec's "no assertion changes" rule gains two allowed field renames.** The spec says Phase 1's suites must pass with only import-path, route-path and feed-key-fixture edits. Two column renames make that impossible as written: `accountUpn` → `accountLabel` and `deltaToken` → `syncToken`. Those two identifier renames in test bodies are **allowed and expected**. Anything beyond those four categories means the refactor leaked — stop and report rather than adjusting the test.

2. **The spec's single `0023_integrations_layer` migration is split into three.** Each is then independently correct and independently reversible, and no task leaves the DB and the code disagreeing:
   - `0023_integrations_layer` — table renames, `provider` column, `account_label`, `sync_token` (Task 3)
   - `0024_prefixed_feed_keys` — the feed-key rewrite, landing in the same task as the helper change (Task 5)
   - `0025_household_list_flag` — allowlist `provider` + `is_household` (Task 12)

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/integrations/schema.ts` | `integration_connections`, `integration_sync_state` |
| `src/integrations/crypto.ts` | Refresh-token encryption (moved verbatim) |
| `src/integrations/store.ts` | `IntegrationStore` — provider-scoped connections + sync state |
| `src/integrations/feed-keys.ts` | Provider-prefixed feed-key helpers |
| `src/integrations/sync-runner.ts` | `syncOneFeed` with a provider-supplied classifier |
| `src/integrations/registry.ts` | Provider registration + lookup |
| `src/integrations/scheduler.ts` | One poll loop across all registered providers |
| `src/integrations/routes.ts` | `/api/v1/integrations/*` |
| `src/integrations/index.ts` | Public surface + `integrationsModule` |
| `tests/integrations-store.test.ts` | Provider-scoped store behaviour |
| `tests/integrations-routes.test.ts` | Route surface + role rules |
| `tests/integrations-migration.test.ts` | Feed-key rewrite correctness |
| `tests/tasks-household-list.test.ts` | Designation-by-flag |

**Deleted, by the task that does it**

- **Task 8:** `src/m365/schema.ts`, `store.ts`, `crypto.ts`, `feed-keys.ts` — the four shims.
- **Task 9:** `src/m365/routes.ts`; `src/m365/state.ts` is *moved* (`git mv`) to `src/integrations/state.ts`, not deleted.
- **Task 10:** `src/m365/scheduler.ts`.

> **Corrected 2026-08-30, during execution.** An earlier version listed all eight files under Task 8, which was wrong twice over. It attributed Task 9's and Task 10's deletions to Task 8, and it listed **`src/m365/sync-runner.ts` as deleted — that file must survive.** Task 6 leaves the Graph error classifier in it, and `src/m365/task-provider.ts` imports `classify` from there at three call sites (lines 107, 193, 221). Deleting it would break the Graph task provider's error mapping.
>
> `src/m365/sync-runner.ts` keeps its name after Task 6 even though it no longer runs anything — renaming it to `classify.ts` would be tidier but is pure churn mid-refactor. Task 15 notes the stale name in AGENTS.md.

**Modified**

`src/m365/{index,runtime,delegated,calendar-sync,task-sync,calendar-provider,task-provider}.ts`, `src/modules/tasks/{store,service,provider,routes,schema}.ts`, `src/modules/calendar/mirror-store.ts`, `src/modules/{calendar,tasks}/providers/types.ts`, `src/modules/index.ts`, `src/config/env.ts`, `src/db/schema/{drizzle-schema,index}.ts`, `src/index.ts`, `tests/setup.ts`, `web/src/{api,hooks,lib}/*`, `AGENTS.md`, `README.md`

---

### Task 1: Reconcile instead of truncate — task mirror

`applyTaskPull` implements `fullResync` as `DELETE WHERE feed_key` then re-insert, so every mirror row's uuid changes. `GET /api/v1/tasks` returns those ids and the web holds them, so a `/:id/complete` between a fetch and a click 404s. Today that window opens weekly; the Google provider would open it every tick.

This task is independent of everything else in the plan. It goes first because it is small, valuable on its own, and must not be entangled with the file moves.

**Files:**
- Modify: `src/modules/tasks/store.ts:38-88` (the doc comment and `applyTaskPull`)
- Test: `tests/m365-tasks-sync.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `applyTaskPull(source: string, feed: TaskFeed, result: TaskPullResult): Promise<{ upserted: number; deleted: number }>` — unchanged signature, changed `fullResync` semantics: reconcile rather than replace.

- [ ] **Step 1: Write the failing tests**

Append to `tests/m365-tasks-sync.test.ts`. Match the existing imports in that file; add `taskMirror` and `applyTaskPull` if not already imported.

```ts
describe('applyTaskPull fullResync reconciles instead of truncating', () => {
  const feed = { feedKey: 'todo:member:x:list1', memberId: '', listId: 'list1', listName: 'List' };

  function task(externalId: string, title: string, memberId: string) {
    return {
      externalId, title, notes: null, dueAt: null, completedAt: null,
      status: 'open' as const, listId: 'list1', listName: 'List', memberId,
    };
  }

  it('preserves the row id of a task that survives a full resync', async () => {
    const { adult } = await seedTestHousehold();
    const f = { ...feed, memberId: adult.user.id };

    await applyTaskPull('m365', f, {
      upserts: [task('t1', 'Buy milk', adult.user.id)],
      deletions: [], nextToken: null, fullResync: true,
    });
    const before = await db.select().from(taskMirror).where(eq(taskMirror.externalId, 't1'));
    const idBefore = before[0]!.id;

    // Same task re-delivered by a second full snapshot, with an edited title.
    await applyTaskPull('m365', f, {
      upserts: [task('t1', 'Buy oat milk', adult.user.id)],
      deletions: [], nextToken: null, fullResync: true,
    });
    const after = await db.select().from(taskMirror).where(eq(taskMirror.externalId, 't1'));

    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(idBefore);          // the id survived
    expect(after[0]!.title).toBe('Buy oat milk'); // and the update applied
  });

  it('deletes rows absent from a full snapshot, with no tombstone', async () => {
    const { adult } = await seedTestHousehold();
    const f = { ...feed, memberId: adult.user.id };

    await applyTaskPull('m365', f, {
      upserts: [task('t1', 'Keep me', adult.user.id), task('t2', 'Delete me', adult.user.id)],
      deletions: [], nextToken: null, fullResync: true,
    });

    // t2 is simply not in the next snapshot — no deletions[] entry.
    const res = await applyTaskPull('m365', f, {
      upserts: [task('t1', 'Keep me', adult.user.id)],
      deletions: [], nextToken: null, fullResync: true,
    });

    const rows = await db.select().from(taskMirror).where(eq(taskMirror.feedKey, f.feedKey));
    expect(rows.map((r) => r.externalId)).toEqual(['t1']);
    expect(res.deleted).toBe(1);
  });

  it('empties the feed when a full snapshot is empty', async () => {
    const { adult } = await seedTestHousehold();
    const f = { ...feed, memberId: adult.user.id };

    await applyTaskPull('m365', f, {
      upserts: [task('t1', 'Gone soon', adult.user.id)],
      deletions: [], nextToken: null, fullResync: true,
    });
    await applyTaskPull('m365', f, {
      upserts: [], deletions: [], nextToken: null, fullResync: true,
    });

    const rows = await db.select().from(taskMirror).where(eq(taskMirror.feedKey, f.feedKey));
    expect(rows).toHaveLength(0);
  });

  it('does not touch another feed', async () => {
    const { adult } = await seedTestHousehold();
    const a = { ...feed, memberId: adult.user.id };
    const b = { ...feed, feedKey: 'todo:member:x:list2', memberId: adult.user.id, listId: 'list2' };

    await applyTaskPull('m365', a, {
      upserts: [task('t1', 'Feed A', adult.user.id)], deletions: [], nextToken: null, fullResync: true,
    });
    await applyTaskPull('m365', b, {
      upserts: [task('t9', 'Feed B', adult.user.id)], deletions: [], nextToken: null, fullResync: true,
    });
    await applyTaskPull('m365', a, {
      upserts: [], deletions: [], nextToken: null, fullResync: true,
    });

    const rowsB = await db.select().from(taskMirror).where(eq(taskMirror.feedKey, b.feedKey));
    expect(rowsB).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/m365-tasks-sync.test.ts -t "reconciles instead of truncating"
```

Expected: FAIL. The id-preservation test fails on `expect(after[0]!.id).toBe(idBefore)` because the truncate re-inserted the row with a fresh uuid. The `res.deleted` assertion fails with `0`, because the current code reports nothing deleted on a `fullResync`.

- [ ] **Step 3: Rewrite `applyTaskPull`**

Replace the body at `src/modules/tasks/store.ts:38-88`. Note `notInArray` must be added to the `drizzle-orm` import on line 1.

```ts
/**
 * Apply one feed's pull to the mirror.
 *  - `fullResync`: `upserts` IS the complete current contents of the feed.
 *    Rows are RECONCILED, not replaced: everything present is upserted, then
 *    everything absent is deleted. This is what keeps `task_mirror.id` stable
 *    for a task that survives the resync — the previous implementation deleted
 *    the whole feed and re-inserted it, changing every uuid. `GET /api/v1/tasks`
 *    hands those ids to the web, which then calls `/:id/complete` with one, so
 *    churning them turns into an intermittent 404.
 *  - otherwise: upsert `upserts` (by feed + externalId) and delete `deletions`.
 *
 * A provider with no delta API (Google Tasks) sets `fullResync` on EVERY pull;
 * the reconcile is what detects a deletion structurally, with no tombstone.
 */
export async function applyTaskPull(
  source: string,
  feed: TaskFeed,
  result: TaskPullResult,
): Promise<{ upserted: number; deleted: number }> {
  return db.transaction(async (tx) => {
    let upserted = 0;
    for (const t of result.upserts) {
      await tx.insert(taskMirror).values(toRow(source, feed, t)).onConflictDoUpdate({
        target: [taskMirror.feedKey, taskMirror.externalId],
        set: {
          memberId: t.memberId,
          listId: feed.listId,
          listName: feed.listName,
          title: t.title,
          notes: t.notes,
          dueAt: t.dueAt ? new Date(t.dueAt) : null,
          completedAt: t.completedAt ? new Date(t.completedAt) : null,
          status: t.status,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      upserted += 1;
    }

    let deleted = 0;
    if (result.fullResync) {
      // Reconcile: anything in the feed that this snapshot did not carry is gone
      // at the source. An EMPTY snapshot legitimately empties the feed, so the
      // seen-list being empty must delete everything rather than short-circuit.
      const seen = result.upserts.map((t) => t.externalId);
      const rows = await tx
        .delete(taskMirror)
        .where(seen.length > 0
          ? and(eq(taskMirror.feedKey, feed.feedKey), notInArray(taskMirror.externalId, seen))
          : eq(taskMirror.feedKey, feed.feedKey))
        .returning({ id: taskMirror.id });
      deleted = rows.length;
    } else if (result.deletions.length > 0) {
      const rows = await tx
        .delete(taskMirror)
        .where(and(
          eq(taskMirror.feedKey, feed.feedKey),
          inArray(taskMirror.externalId, result.deletions),
        ))
        .returning({ id: taskMirror.id });
      deleted = rows.length;
    }

    return { upserted, deleted };
  });
}
```

- [ ] **Step 4: Run the new tests, then the whole file**

```bash
npx vitest run tests/m365-tasks-sync.test.ts
```

Expected: PASS, including the pre-existing tests. If a pre-existing test fails, read it before changing it — the likely cause is an assertion on `deleted` counts, which now reports reconcile deletions where it previously reported `0`. That is the intended new behaviour; updating such an assertion is correct here (this task is a deliberate behaviour change, not the refactor).

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm run typecheck && npm test
```

Expected: PASS. `weorc-*` suites exercise `applyTaskPull` indirectly and must stay green — they link by `(feedKey, externalId)`, so stable ids can only help them.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tasks/store.ts tests/m365-tasks-sync.test.ts
git commit -m "fix(tasks): reconcile the task mirror on full resync instead of truncating

A full resync deleted the whole feed and re-inserted it, changing every
task_mirror.id. GET /api/v1/tasks hands those ids to the web, so a
/:id/complete issued between a fetch and a click could 404.

Reconcile instead: upsert everything the snapshot carries, then delete
everything it does not. Same end state, stable ids. An empty snapshot still
correctly empties the feed."
```

---

### Task 2: Reconcile instead of truncate — calendar mirror

The same defect in `applyMirrorPull`, with one extra constraint: the existing `deletions` cascade (matching `externalId` **or** `seriesMasterId`) and `masterPurges` (matching `externalId` only) must keep their current semantics. Those two channels are skipped on `fullResync` today because the feed was wholesale replaced; with reconcile they stay skipped, because a snapshot that omits a row already deletes it.

**Files:**
- Modify: `src/modules/calendar/mirror-store.ts:31-104` (`applyMirrorPull`)
- Test: `tests/m365-calendar-sync.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1 (different module, same idea).
- Produces: `applyMirrorPull(source: string, feedKey: string, result: PullResult): Promise<{ upserted: number; deleted: number }>` — unchanged signature, reconcile semantics on `fullResync`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/m365-calendar-sync.test.ts`, matching that file's existing imports (`db`, `calendarMirrorEvents`, `applyMirrorPull`, `eq`).

```ts
describe('applyMirrorPull fullResync reconciles instead of truncating', () => {
  const feedKey = 'calendar:member:recon';

  function ev(externalId: string, title: string, seriesMasterId: string | null = null) {
    return {
      externalId, title,
      start: { utc: '2026-03-01T09:00:00.000Z', timeZone: 'Europe/Berlin' },
      end: { utc: '2026-03-01T10:00:00.000Z', timeZone: 'Europe/Berlin' },
      allDay: false, location: null, organizer: null, memberId: null, seriesMasterId,
    };
  }

  it('preserves the row id of an event that survives a full resync', async () => {
    await applyMirrorPull('m365', feedKey, {
      upserts: [ev('e1', 'Standup')],
      deletions: [], masterPurges: [], nextToken: null, fullResync: true,
    });
    const before = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.externalId, 'e1'));
    const idBefore = before[0]!.id;

    await applyMirrorPull('m365', feedKey, {
      upserts: [ev('e1', 'Standup (moved)')],
      deletions: [], masterPurges: [], nextToken: null, fullResync: true,
    });
    const after = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.externalId, 'e1'));

    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(idBefore);
    expect(after[0]!.title).toBe('Standup (moved)');
  });

  it('drops events that aged out of the re-windowed snapshot', async () => {
    await applyMirrorPull('m365', feedKey, {
      upserts: [ev('old', 'Last month'), ev('cur', 'This month')],
      deletions: [], masterPurges: [], nextToken: null, fullResync: true,
    });

    // The window rolled forward: 'old' is no longer in range, so it is absent.
    const res = await applyMirrorPull('m365', feedKey, {
      upserts: [ev('cur', 'This month')],
      deletions: [], masterPurges: [], nextToken: null, fullResync: true,
    });

    const rows = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.feedKey, feedKey));
    expect(rows.map((r) => r.externalId)).toEqual(['cur']);
    expect(res.deleted).toBe(1);
  });

  it('still cascades a series deletion over seriesMasterId on an incremental pull', async () => {
    await applyMirrorPull('m365', feedKey, {
      upserts: [ev('occ1', 'Weekly', 'master1'), ev('occ2', 'Weekly', 'master1'), ev('solo', 'Solo')],
      deletions: [], masterPurges: [], nextToken: null, fullResync: true,
    });

    // The source tombstones only the master id.
    await applyMirrorPull('m365', feedKey, {
      upserts: [], deletions: ['master1'], masterPurges: [], nextToken: null, fullResync: false,
    });

    const rows = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.feedKey, feedKey));
    expect(rows.map((r) => r.externalId)).toEqual(['solo']);
  });

  it('still purges an alive master by externalId only, sparing its occurrences', async () => {
    await applyMirrorPull('m365', feedKey, {
      upserts: [ev('master1', 'Weekly'), ev('occ1', 'Weekly', 'master1')],
      deletions: [], masterPurges: [], nextToken: null, fullResync: true,
    });

    await applyMirrorPull('m365', feedKey, {
      upserts: [], deletions: [], masterPurges: ['master1'], nextToken: null, fullResync: false,
    });

    const rows = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.feedKey, feedKey));
    expect(rows.map((r) => r.externalId)).toEqual(['occ1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/m365-calendar-sync.test.ts -t "reconciles instead of truncating"
```

Expected: the first two tests FAIL (id churn; `res.deleted` is `0`). The last two — the cascade and purge tests — should already PASS; they are written now as regression guards so Step 3 cannot silently break them.

- [ ] **Step 3: Rewrite `applyMirrorPull`**

Replace the body at `src/modules/calendar/mirror-store.ts:31-104`. Add `notInArray` to the `drizzle-orm` import on line 1. **Ordering matters:** upserts run first, then the reconcile delete, then the incremental channels — so a same-pull upsert can never be eaten, and the reconcile's "not seen" set is computed against the snapshot, not against partially-written state.

```ts
/**
 * Apply one feed's pull to the mirror.
 *  - `fullResync`: `upserts` IS the complete current contents of the feed (a
 *    freshly-windowed snapshot, or a 410 recovery). Rows are RECONCILED, not
 *    replaced: everything present is upserted, then everything absent is
 *    deleted. Reconciling rather than truncating keeps `calendar_mirror_events.id`
 *    stable across a resync. Because a re-windowed snapshot contains only events
 *    inside the window, this also correctly drops events that aged out of the
 *    window's past edge — which is what the previous truncate achieved.
 *  - otherwise: upsert `upserts` (by feed + externalId), delete `deletions`
 *    (cascading over `seriesMasterId`) and `masterPurges` (externalId only).
 * Returns the row count now stored for the feed's changed set (for logging).
 */
export async function applyMirrorPull(
  source: string,
  feedKey: string,
  result: PullResult,
): Promise<{ upserted: number; deleted: number }> {
  return db.transaction(async (tx) => {
    let upserted = 0;
    for (const e of result.upserts) {
      await tx.insert(calendarMirrorEvents).values(toRow(source, feedKey, e)).onConflictDoUpdate({
        target: [calendarMirrorEvents.feedKey, calendarMirrorEvents.externalId],
        set: {
          memberId: e.memberId,
          title: e.title,
          startAt: new Date(e.start.utc),
          endAt: new Date(e.end.utc),
          allDay: e.allDay,
          location: e.location,
          organizer: e.organizer,
          sourceTimeZone: e.start.timeZone,
          seriesMasterId: e.seriesMasterId,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      upserted += 1;
    }

    let deleted = 0;

    if (result.fullResync) {
      // Reconcile against the snapshot. `deletions` / `masterPurges` are NOT
      // consulted here: an event the snapshot omits is already deleted below,
      // and a snapshot cannot be trusted to repeat tombstones from before the
      // gap that caused the resync.
      const seen = result.upserts.map((e) => e.externalId);
      const rows = await tx
        .delete(calendarMirrorEvents)
        .where(seen.length > 0
          ? and(
              eq(calendarMirrorEvents.feedKey, feedKey),
              notInArray(calendarMirrorEvents.externalId, seen),
            )
          : eq(calendarMirrorEvents.feedKey, feedKey))
        .returning({ id: calendarMirrorEvents.id });
      deleted = rows.length;
      return { upserted, deleted };
    }

    // Incremental pull. Two channels with different blast radii:
    //  - `deletions` (genuine @removed tombstones): a deleted series is
    //    tombstoned by its MASTER id only, so the delete matches externalId OR
    //    seriesMasterId (the cascade).
    //  - `masterPurges` (still-ALIVE series masters, never displayable): delete
    //    by externalId ONLY. The cascade must not apply — an incremental delta
    //    re-delivers the master without re-delivering the series' unchanged
    //    occurrences, and those mirrored rows must survive.
    if (result.deletions.length > 0) {
      const rows = await tx
        .delete(calendarMirrorEvents)
        .where(and(
          eq(calendarMirrorEvents.feedKey, feedKey),
          or(
            inArray(calendarMirrorEvents.externalId, result.deletions),
            inArray(calendarMirrorEvents.seriesMasterId, result.deletions),
          ),
        ))
        .returning({ id: calendarMirrorEvents.id });
      deleted = rows.length;
    }
    if (result.masterPurges.length > 0) {
      const rows = await tx
        .delete(calendarMirrorEvents)
        .where(and(
          eq(calendarMirrorEvents.feedKey, feedKey),
          inArray(calendarMirrorEvents.externalId, result.masterPurges),
        ))
        .returning({ id: calendarMirrorEvents.id });
      deleted += rows.length;
    }

    return { upserted, deleted };
  });
}
```

> **Behaviour note for the reviewer:** upserts now run *before* deletions on the incremental path, where previously deletions ran first "so they can never eat same-pull upserts". The guarantee is preserved by a different mechanism: a tombstoned id is deleted after being written, so the delete still wins. If a provider ever delivered the same `externalId` in both `upserts` and `deletions`, the outcome is the same as before — deleted.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/m365-calendar-sync.test.ts
```

Expected: PASS, all four new tests and every pre-existing one.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/calendar/mirror-store.ts tests/m365-calendar-sync.test.ts
git commit -m "fix(calendar): reconcile the event mirror on full resync instead of truncating

Same defect and same fix as the task mirror: a full resync replaced the feed
wholesale and churned every calendar_mirror_events.id.

The seriesMasterId cascade and the masterPurges channel keep their exact
semantics on the incremental path, now covered by explicit regression tests."
```

---

### Task 3: The integrations schema and the first migration

Move the two tables out of `src/m365/schema.ts` under provider-neutral names, add the `provider` scope, and rename the two columns whose names were Microsoft-specific. `src/m365/schema.ts` becomes a re-export shim so nothing else has to change yet and the suite stays green.

**Files:**
- Create: `src/integrations/schema.ts`
- Modify: `src/m365/schema.ts` (becomes a shim), `src/db/schema/drizzle-schema.ts`, `src/db/schema/index.ts`
- Create: `src/db/migrations/0023_integrations_layer.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `integrationConnections` — columns `id, createdAt, updatedAt, provider, memberId, accountLabel, refreshTokenEncrypted, scopes, status, lastRefreshSuccessAt, lastRefreshError`
  - `integrationSyncState` — columns `id, createdAt, updatedAt, feedKey, syncToken, lastSuccessAt, lastFullSyncAt, lastError, consecutiveFailures`
  - Types `IntegrationConnectionRow`, `IntegrationSyncStateRow`, `IntegrationConnectionStatus`
  - Const `INTEGRATION_CONNECTION_STATUSES = ['active', 'needs_reauth', 'error']`

- [ ] **Step 1: Create `src/integrations/schema.ts`**

```ts
import { pgTable, text, uuid, timestamp, integer, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Connection status for the "wife-debuggable" wall badge:
 *  - `active`        — last refresh succeeded.
 *  - `needs_reauth`  — refresh token rejected; the member must reconnect on their
 *                      phone. The wall greys out that feed rather than re-authing.
 *  - `error`         — a transient failure (network/upstream 5xx); retried on poll.
 */
export const INTEGRATION_CONNECTION_STATUSES = ['active', 'needs_reauth', 'error'] as const;
export type IntegrationConnectionStatus = (typeof INTEGRATION_CONNECTION_STATUSES)[number];

/**
 * Per-member delegated connection to ONE external provider. A member may hold
 * one connection per provider (`unique(provider, member_id)`) — that is what
 * makes M365 and Google usable side by side, and it is why this table is no
 * longer `m365_connections`.
 *
 * The refresh token is stored ENCRYPTED AT REST (`src/integrations/crypto.ts`);
 * it is never returned over the API — see the store's public projection.
 */
export const integrationConnections = pgTable('integration_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  // Provider discriminator: 'm365' | 'google'. Matches the `source` column on
  // the two mirror tables.
  provider: text('provider').notNull().default('m365'),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Human-readable account identity for display. M365 stores the userPrincipalName;
  // Google stores the account email. Deliberately NOT `account_upn` — that name
  // only made sense while Microsoft was the only provider.
  accountLabel: text('account_label').notNull(),
  // AES-256-GCM ciphertext of the OAuth refresh token (iv:tag:ct base64).
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  // Space-delimited granted scopes as returned by the token endpoint.
  scopes: text('scopes').notNull().default(''),
  status: text('status').notNull().default('active'),
  lastRefreshSuccessAt: timestamp('last_refresh_success_at', { withTimezone: true }),
  lastRefreshError: text('last_refresh_error'),
}, (t) => [
  // One connection per member PER PROVIDER.
  unique('integration_conn_provider_member_unique').on(t.provider, t.memberId),
  index('integration_conn_member_idx').on(t.memberId),
]);

/**
 * Generic per-feed sync state, shared by every provider and both surfaces
 * (calendar + tasks). `feedKey` is the discriminator and carries a provider
 * segment — see `src/integrations/feed-keys.ts`.
 */
export const integrationSyncState = pgTable('integration_sync_state', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  feedKey: text('feed_key').notNull(),
  // Opaque incremental-sync token, whatever the provider's flavour: a Graph
  // delta URL, a Google syncToken. Never exposed over the API — a Graph delta
  // URL embeds the mailbox.
  syncToken: text('sync_token'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  // When the feed last did a FULL (freshly-windowed) sync — the initial pull, a
  // token-invalidation recovery, or a deterministic periodic re-window.
  // Incremental replay ticks do NOT update this. Null means "never" (forces a
  // full sync on the next tick).
  lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
}, (t) => [
  unique('integration_sync_feed_unique').on(t.feedKey),
]);

export type IntegrationConnectionRow = typeof integrationConnections.$inferSelect;
export type IntegrationSyncStateRow = typeof integrationSyncState.$inferSelect;
```

- [ ] **Step 2: Turn `src/m365/schema.ts` into a shim**

Replace the whole file. This keeps `store.ts`, `routes.ts`, `index.ts` and the tests compiling until Task 8 deletes it.

```ts
/**
 * TEMPORARY SHIM — the tables moved to `src/integrations/schema.ts` when the
 * provider-neutral integrations layer was extracted. This file exists only so
 * the extraction can land in reviewable steps; it is deleted in the task that
 * rewires `src/m365/` onto the new layer. Do not add anything here.
 */
export {
  integrationConnections as m365Connections,
  integrationSyncState as m365SyncState,
  INTEGRATION_CONNECTION_STATUSES as M365_CONNECTION_STATUSES,
} from '../integrations/schema.js';
export type {
  IntegrationConnectionRow as M365ConnectionRow,
  IntegrationSyncStateRow as M365SyncStateRow,
  IntegrationConnectionStatus as M365ConnectionStatus,
} from '../integrations/schema.js';
```

- [ ] **Step 3: Repoint both schema barrels**

In `src/db/schema/drizzle-schema.ts`, replace the line `export * from '../../m365/schema';` with:

```ts
export * from '../../integrations/schema';
```

In `src/db/schema/index.ts`, replace `export * from '../../m365/schema.js';` with:

```ts
export * from '../../integrations/schema.js';
```

Both must change — the shim re-exports aliases, and exporting it from the barrel would register the same tables twice under two names.

- [ ] **Step 4: Generate the migration**

```bash
npm run db:generate -- --name integrations_layer
```

Expected: `src/db/migrations/0023_integrations_layer.sql`.

**Inspect it before continuing.** Drizzle cannot tell a rename from a drop-plus-create, and will very likely emit `DROP TABLE m365_connections` + `CREATE TABLE integration_connections`, **which would destroy every stored connection.** If it did, replace the generated SQL body with explicit renames (leave `meta/` untouched):

```sql
ALTER TABLE "m365_connections" RENAME TO "integration_connections";
ALTER TABLE "integration_connections" RENAME COLUMN "account_upn" TO "account_label";
ALTER TABLE "integration_connections" ADD COLUMN "provider" text DEFAULT 'm365' NOT NULL;
ALTER TABLE "integration_connections" DROP CONSTRAINT "m365_conn_member_unique";
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_conn_provider_member_unique" UNIQUE("provider","member_id");
ALTER INDEX "m365_conn_member_idx" RENAME TO "integration_conn_member_idx";

ALTER TABLE "m365_sync_state" RENAME TO "integration_sync_state";
ALTER TABLE "integration_sync_state" RENAME COLUMN "delta_token" TO "sync_token";
ALTER TABLE "integration_sync_state" DROP CONSTRAINT "m365_sync_feed_unique";
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_feed_unique" UNIQUE("feed_key");
```

Existing rows take `provider = 'm365'` from the column default, so no separate backfill statement is needed.

- [ ] **Step 5: Apply the migration and run the suite**

```bash
npm run typecheck && npm test
```

> **Corrected 2026-08-30, during execution.** An earlier version of this step said "Expected: PASS". **That was wrong, and it is worth understanding why.** The shim aliases the two *tables*, but `src/m365/store.ts` also references a renamed *column* (`accountUpn`) and the changed *unique constraint* — its `onConflictDoUpdate` targets `m365Connections.memberId`, which is no longer a unique key on its own now that the constraint is `unique(provider, member_id)`. **A table alias cannot paper over a column rename.** So this task is NOT independently green:
>
> Expected after this task: **6 typecheck errors** — 5 in `src/m365/store.ts`, 1 in `src/m365/sync-runner.ts` (`.deltaToken`). Both files are replaced by Task 4 and Task 6.
>
> **Tasks 3 and 4 therefore form a single green boundary and a single review unit.** Run Task 4 immediately after this one, and fold the one-word `.deltaToken` → `.syncToken` fix in `src/m365/sync-runner.ts` into Task 4 so the combined boundary reaches green.

Test edits allowed in this task — **two renames only**, in `tests/m365-store.test.ts` and any other suite naming the renamed columns:
- `accountUpn:` → `accountLabel:`
- `deltaToken` → `syncToken` (including inside a string literal, e.g. `toHaveProperty('deltaToken')` — leaving it would make the assertion silently vacuous)

Nothing else may change. `tests/setup.ts` truncates and re-migrates, so the rename is exercised on every run.

> **Drizzle will mis-generate this migration.** Observed on 2026-08-30: it misdetected the column rename as `account_upn` → `provider` and added a spurious `NOT NULL account_label` with no default. Step 4's instruction to read and replace the generated SQL is not a precaution — it is required.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/schema.ts src/m365/schema.ts src/db/schema/ src/db/migrations/ tests/
git commit -m "refactor(integrations): move the connection and sync-state tables out of m365

m365_connections becomes integration_connections with a provider column and
unique(provider, member_id), so a member can hold an M365 and a Google
connection at once. m365_sync_state becomes integration_sync_state.

account_upn becomes account_label (Google has no UPN) and delta_token becomes
sync_token (it was never Graph-specific). src/m365/schema.ts is a temporary
re-export shim so this lands without touching every importer at once."
```

---

### Task 4: Move crypto verbatim and make the store provider-scoped

**Files:**
- Create: `src/integrations/crypto.ts`, `src/integrations/store.ts`
- Modify: `src/m365/crypto.ts`, `src/m365/store.ts` (both become shims)
- Test: `tests/integrations-store.test.ts` (create)

**Interfaces:**
- Consumes: `integrationConnections`, `integrationSyncState`, `IntegrationConnectionRow`, `IntegrationSyncStateRow`, `IntegrationConnectionStatus` (Task 3).
- Produces:
  - `encryptToken(plaintext: string): string`, `decryptToken(stored: string): string`
  - `class IntegrationStore`, constructed `new IntegrationStore(provider: string, db?: DB)`
  - Methods: `upsertConnection({ memberId, accountLabel, refreshToken, scopes })`, `getConnection(memberId)`, `listConnections()`, `getRefreshToken(memberId)`, `recordRefreshSuccess(memberId, rotated?)`, `recordRefreshError(memberId, message, status?)`, `deleteConnection(memberId)`, `getSyncState(feedKey)`, `listSyncState()` (**all** providers — the Hearth View needs household-wide staleness), `recordSyncSuccess(feedKey, syncToken, fullResync?)`, `recordSyncFailure(feedKey, message)`
  - `type PublicIntegrationConnection = Omit<IntegrationConnectionRow, 'refreshTokenEncrypted'>`

> **CRITICAL — do not touch the HKDF strings.** `'heorth-m365-v1'` and `'heorth-m365-tokens'` are **inputs to the encryption key**, not documentation. Renaming them to say `integration` makes every stored refresh token undecryptable and forces every member to reconnect. They move **verbatim**.

- [ ] **Step 1: Create `src/integrations/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';

/**
 * Refresh-token encryption at rest for every integration provider.
 *
 * A deliberate SIBLING of the Library's credential crypto
 * (`src/modules/library/crypto.ts`) — same AES-256-GCM `iv:tag:ct` envelope and
 * the same HKDF-over-`JWT_SECRET` derivation, with its own salt and info string
 * so the two areas derive independent keys from the same secret.
 *
 * !!! THE SALT AND INFO STRINGS BELOW STILL SAY `m365`. THAT IS DELIBERATE. !!!
 * They are INPUTS TO THE KEY, not labels. This file was moved here from
 * `src/m365/crypto.ts`; changing either string would derive a different key and
 * make every already-stored refresh token undecryptable, forcing every member to
 * reconnect. They are frozen. Google tokens are encrypted with this same key —
 * same process, same secret, same threat model, so a per-provider derivation
 * would add a second thing to get wrong and buy nothing.
 *
 * Token material is NEVER logged.
 */

const ALGO = 'aes-256-gcm';

const KEY = Buffer.from(
  hkdfSync('sha256', config.jwtSecret, Buffer.from('heorth-m365-v1'), 'heorth-m365-tokens', 32),
);

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed integration token ciphertext');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 2: Make `src/m365/crypto.ts` a shim**

```ts
/**
 * TEMPORARY SHIM — moved to `src/integrations/crypto.ts`. Deleted in the task
 * that rewires `src/m365/` onto the integrations layer.
 */
export { encryptToken, decryptToken } from '../integrations/crypto.js';
```

- [ ] **Step 3: Write the failing store test**

Create `tests/integrations-store.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { IntegrationStore } from '../src/integrations/store.js';
import { integrationConnections } from '../src/integrations/schema.js';
import { seedTestHousehold } from './helpers.js';

const m365 = new IntegrationStore('m365');
const google = new IntegrationStore('google');

describe('IntegrationStore', () => {
  it('keeps one connection per member PER PROVIDER', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r-m365', scopes: '',
    });
    await google.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r-google', scopes: '',
    });

    const rows = await db.select().from(integrationConnections)
      .where(eq(integrationConnections.memberId, adult.user.id));
    expect(rows).toHaveLength(2);

    expect(await m365.getRefreshToken(adult.user.id)).toBe('r-m365');
    expect(await google.getRefreshToken(adult.user.id)).toBe('r-google');
  });

  it('scopes reads to its own provider', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r1', scopes: '',
    });

    expect(await m365.getConnection(adult.user.id)).not.toBeNull();
    expect(await google.getConnection(adult.user.id)).toBeNull();
    expect(await google.listConnections()).toHaveLength(0);
  });

  it('upsert is idempotent within a provider', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r1', scopes: '',
    });
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r2', scopes: '',
    });

    const rows = await db.select().from(integrationConnections)
      .where(and(
        eq(integrationConnections.memberId, adult.user.id),
        eq(integrationConnections.provider, 'm365'),
      ));
    expect(rows).toHaveLength(1);
    expect(await m365.getRefreshToken(adult.user.id)).toBe('r2');
  });

  it('encrypts the refresh token at rest and never exposes it', async () => {
    const { adult } = await seedTestHousehold();
    const secret = 'super-secret-refresh-token';
    const pub = await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: secret, scopes: 'User.Read',
    });
    expect(pub).not.toHaveProperty('refreshTokenEncrypted');

    const [row] = await db.select().from(integrationConnections)
      .where(eq(integrationConnections.memberId, adult.user.id));
    expect(row!.refreshTokenEncrypted).not.toContain(secret);
    expect(row!.refreshTokenEncrypted.split(':')).toHaveLength(3);
  });

  it('deletes only its own provider connection', async () => {
    const { adult } = await seedTestHousehold();
    await m365.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r1', scopes: '',
    });
    await google.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r2', scopes: '',
    });

    expect(await google.deleteConnection(adult.user.id)).toBe(true);
    expect(await google.getConnection(adult.user.id)).toBeNull();
    expect(await m365.getConnection(adult.user.id)).not.toBeNull();
  });

  it('listSyncState returns every provider feed (household-wide staleness)', async () => {
    await m365.recordSyncSuccess('m365:calendar:family', 'tok-1');
    await google.recordSyncSuccess('google:calendar:member:x:cal1', 'tok-2');

    const keys = (await m365.listSyncState()).map((r) => r.feedKey);
    expect(keys).toContain('m365:calendar:family');
    expect(keys).toContain('google:calendar:member:x:cal1');
  });

  it('records sync success, failure counters, and lastFullSyncAt only on full syncs', async () => {
    const key = 'm365:calendar:family';
    await m365.recordSyncSuccess(key, 'tok-1');
    let st = await m365.getSyncState(key);
    expect(st!.syncToken).toBe('tok-1');
    expect(st!.consecutiveFailures).toBe(0);
    expect(st!.lastFullSyncAt).toBeNull();

    await m365.recordSyncSuccess(key, 'tok-2', true);
    st = await m365.getSyncState(key);
    expect(st!.lastFullSyncAt).not.toBeNull();

    await m365.recordSyncFailure(key, 'needs_reauth');
    await m365.recordSyncFailure(key, 'needs_reauth');
    st = await m365.getSyncState(key);
    expect(st!.consecutiveFailures).toBe(2);
    expect(st!.lastError).toBe('needs_reauth');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
npx vitest run tests/integrations-store.test.ts
```

Expected: FAIL — `Cannot find module '../src/integrations/store.js'`.

- [ ] **Step 5: Create `src/integrations/store.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db/index.js';
import { encryptToken, decryptToken } from './crypto.js';
import {
  integrationConnections, integrationSyncState,
  type IntegrationConnectionRow, type IntegrationSyncStateRow, type IntegrationConnectionStatus,
} from './schema.js';

/** A connection safe to return over the API — never carries token material. */
export type PublicIntegrationConnection = Omit<IntegrationConnectionRow, 'refreshTokenEncrypted'>;

function toPublic(row: IntegrationConnectionRow): PublicIntegrationConnection {
  const { refreshTokenEncrypted: _omit, ...pub } = row;
  return pub;
}

export interface UpsertConnectionInput {
  memberId: string;
  accountLabel: string;
  refreshToken: string;
  scopes: string;
}

/**
 * Persistence for delegated connections and per-feed sync state.
 *
 * An instance is bound to ONE provider at construction, and every connection
 * method is scoped to it — that scoping is what lets M365 and Google coexist
 * without either seeing the other's rows. Sync state is NOT provider-scoped on
 * read: feed keys already carry a provider segment, and the Hearth View needs
 * household-wide staleness across every provider from a single call.
 *
 * Refresh tokens are encrypted on write and decrypted only inside this store
 * (see {@link getRefreshToken}); callers hold plaintext transiently for a token
 * exchange and never persist it themselves.
 */
export class IntegrationStore {
  constructor(
    private readonly provider: string,
    private readonly db: DB = defaultDb,
  ) {}

  private mine() {
    return eq(integrationConnections.provider, this.provider);
  }

  private mineFor(memberId: string) {
    return and(this.mine(), eq(integrationConnections.memberId, memberId));
  }

  // --- connections ----------------------------------------------------------

  /** Idempotent per-(provider, member) upsert. Encrypts the refresh token at rest. */
  async upsertConnection(input: UpsertConnectionInput): Promise<PublicIntegrationConnection> {
    const encrypted = encryptToken(input.refreshToken);
    const [row] = await this.db
      .insert(integrationConnections)
      .values({
        provider: this.provider,
        memberId: input.memberId,
        accountLabel: input.accountLabel,
        refreshTokenEncrypted: encrypted,
        scopes: input.scopes,
        status: 'active',
        lastRefreshSuccessAt: new Date(),
        lastRefreshError: null,
      })
      .onConflictDoUpdate({
        target: [integrationConnections.provider, integrationConnections.memberId],
        set: {
          accountLabel: input.accountLabel,
          refreshTokenEncrypted: encrypted,
          scopes: input.scopes,
          status: 'active',
          lastRefreshSuccessAt: new Date(),
          lastRefreshError: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toPublic(row!);
  }

  async getConnection(memberId: string): Promise<PublicIntegrationConnection | null> {
    const [row] = await this.db.select().from(integrationConnections)
      .where(this.mineFor(memberId)).limit(1);
    return row ? toPublic(row) : null;
  }

  async listConnections(): Promise<PublicIntegrationConnection[]> {
    const rows = await this.db.select().from(integrationConnections)
      .where(this.mine()).orderBy(integrationConnections.accountLabel);
    return rows.map(toPublic);
  }

  /** Decrypt the stored refresh token for a member (auth-client internal use). */
  async getRefreshToken(memberId: string): Promise<string | null> {
    const [row] = await this.db.select().from(integrationConnections)
      .where(this.mineFor(memberId)).limit(1);
    return row ? decryptToken(row.refreshTokenEncrypted) : null;
  }

  /** Persist a rotated refresh token + record a successful refresh. */
  async recordRefreshSuccess(memberId: string, rotatedRefreshToken?: string): Promise<void> {
    await this.db.update(integrationConnections).set({
      status: 'active',
      lastRefreshSuccessAt: new Date(),
      lastRefreshError: null,
      updatedAt: new Date(),
      ...(rotatedRefreshToken ? { refreshTokenEncrypted: encryptToken(rotatedRefreshToken) } : {}),
    }).where(this.mineFor(memberId));
  }

  async recordRefreshError(
    memberId: string, message: string, status: IntegrationConnectionStatus = 'error',
  ): Promise<void> {
    await this.db.update(integrationConnections).set({
      status, lastRefreshError: message, updatedAt: new Date(),
    }).where(this.mineFor(memberId));
  }

  async deleteConnection(memberId: string): Promise<boolean> {
    const rows = await this.db.delete(integrationConnections)
      .where(this.mineFor(memberId)).returning({ id: integrationConnections.id });
    return rows.length > 0;
  }

  // --- sync state -----------------------------------------------------------
  // Keyed by feedKey, which already carries the provider segment.

  async getSyncState(feedKey: string): Promise<IntegrationSyncStateRow | null> {
    const [row] = await this.db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.feedKey, feedKey)).limit(1);
    return row ?? null;
  }

  /**
   * All per-feed sync state rows, ACROSS EVERY PROVIDER. Deliberately not
   * provider-scoped: the health surface and the Hearth View staleness badges
   * need every feed the household has, and a feed key already says which
   * provider it belongs to.
   */
  async listSyncState(): Promise<IntegrationSyncStateRow[]> {
    return this.db.select().from(integrationSyncState).orderBy(integrationSyncState.feedKey);
  }

  /**
   * Record a successful sync tick: store the new sync token, clear errors.
   * `fullResync` marks this tick as a fresh full (windowed / whole-feed) sync —
   * stamps `lastFullSyncAt` so the runner can decide when the feed is next due
   * for a deterministic re-window. Incremental ticks leave it untouched.
   */
  async recordSyncSuccess(
    feedKey: string, syncToken: string | null, fullResync = false,
  ): Promise<IntegrationSyncStateRow> {
    const now = new Date();
    const [row] = await this.db.insert(integrationSyncState).values({
      feedKey, syncToken, lastSuccessAt: now, lastError: null, consecutiveFailures: 0,
      lastFullSyncAt: fullResync ? now : null,
    }).onConflictDoUpdate({
      target: integrationSyncState.feedKey,
      set: {
        syncToken, lastSuccessAt: now, lastError: null,
        consecutiveFailures: 0, updatedAt: now,
        ...(fullResync ? { lastFullSyncAt: now } : {}),
      },
    }).returning();
    return row!;
  }

  /** Record a failed sync tick: increment the consecutive-failure counter. */
  async recordSyncFailure(feedKey: string, message: string): Promise<IntegrationSyncStateRow> {
    const existing = await this.getSyncState(feedKey);
    const failures = (existing?.consecutiveFailures ?? 0) + 1;
    const [row] = await this.db.insert(integrationSyncState).values({
      feedKey, lastError: message, consecutiveFailures: failures,
    }).onConflictDoUpdate({
      target: integrationSyncState.feedKey,
      set: { lastError: message, consecutiveFailures: failures, updatedAt: new Date() },
    }).returning();
    return row!;
  }
}
```

- [ ] **Step 6: Make `src/m365/store.ts` a shim**

`M365Store` had no provider argument, so the shim binds `'m365'`. `accountUpn` is mapped to `accountLabel` here so existing callers (`routes.ts`) compile untouched until Task 8.

```ts
import { IntegrationStore, type PublicIntegrationConnection } from '../integrations/store.js';

/**
 * TEMPORARY SHIM — the store moved to `src/integrations/store.ts` and gained a
 * provider scope. Deleted in the task that rewires `src/m365/` onto the
 * integrations layer.
 */
export type PublicM365Connection = PublicIntegrationConnection;

export class M365Store extends IntegrationStore {
  constructor() {
    super('m365');
  }

  /** Back-compat: the old input field was `accountUpn`. */
  override async upsertConnection(input: {
    memberId: string; accountUpn?: string; accountLabel?: string;
    refreshToken: string; scopes: string;
  }): Promise<PublicIntegrationConnection> {
    return super.upsertConnection({
      memberId: input.memberId,
      accountLabel: input.accountLabel ?? input.accountUpn ?? '',
      refreshToken: input.refreshToken,
      scopes: input.scopes,
    });
  }
}
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run tests/integrations-store.test.ts && npm run typecheck && npm test
```

Expected: PASS. `tests/m365-store.test.ts` still passes through the shim; its `accountUpn:` input keys keep working, and its `.deltaToken` reads were already renamed in Task 3.

- [ ] **Step 8: Commit**

```bash
git add src/integrations/ src/m365/crypto.ts src/m365/store.ts tests/integrations-store.test.ts
git commit -m "refactor(integrations): provider-scoped store, crypto moved verbatim

IntegrationStore binds a provider at construction and scopes every connection
method to it, so M365 and Google rows never see each other. Sync state stays
unscoped on read because feed keys carry the provider and the Hearth View needs
household-wide staleness in one call.

The HKDF salt and info strings still say m365 ON PURPOSE: they are inputs to
the encryption key, and changing them would make every stored refresh token
undecryptable."
```

---

### Task 5: Provider-prefixed feed keys

**Files:**
- Create: `src/integrations/feed-keys.ts`
- Modify: `src/m365/feed-keys.ts` (shim), `src/modules/tasks/store.ts` (import)
- Create: `src/db/migrations/0024_prefixed_feed_keys.sql` (hand-written data migration)
- Test: `tests/integrations-migration.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `feedKeys.calendarMember(provider, memberId)`, `feedKeys.calendarFamily(provider)`, `feedKeys.calendarList(provider, memberId, calendarId)`, `feedKeys.todoMember(provider, memberId, listId)` — all returning `provider:`-prefixed strings.

`calendarList` is added now, unused, because Phase 2's Google calendar allowlist needs it and defining the whole convention in one place is the point of the file.

- [ ] **Step 1: Create `src/integrations/feed-keys.ts`**

```ts
/**
 * Canonical feed-key convention for `integration_sync_state.feedKey`.
 *
 * A feed key uniquely identifies one incremental-sync stream. Every key starts
 * with its provider, which is what stops an M365 feed and a Google feed for the
 * same member from colliding on the table's unique(feed_key).
 *
 *  - `<provider>:calendar:member:<memberId>`             — a member's default calendar
 *  - `<provider>:calendar:member:<memberId>:<calendarId>` — one named calendar
 *  - `<provider>:calendar:family`                        — the shared household feed
 *  - `<provider>:todo:member:<memberId>:<listId>`        — one task list
 *
 * Keys are OPAQUE: build them here, compare them whole, never parse them back
 * apart. The provider segment exists for uniqueness, not for reading.
 */
export const feedKeys = {
  calendarMember: (provider: string, memberId: string): string =>
    `${provider}:calendar:member:${memberId}`,
  calendarList: (provider: string, memberId: string, calendarId: string): string =>
    `${provider}:calendar:member:${memberId}:${calendarId}`,
  calendarFamily: (provider: string): string => `${provider}:calendar:family`,
  todoMember: (provider: string, memberId: string, listId: string): string =>
    `${provider}:todo:member:${memberId}:${listId}`,
} as const;
```

- [ ] **Step 2: Make `src/m365/feed-keys.ts` a shim that binds `'m365'`**

```ts
import { feedKeys as generic } from '../integrations/feed-keys.js';

/**
 * TEMPORARY SHIM — the convention moved to `src/integrations/feed-keys.ts` and
 * gained a provider argument. This binds `'m365'` so existing call sites compile
 * unchanged. Deleted in the task that rewires `src/m365/`.
 */
export const feedKeys = {
  calendarMember: (memberId: string): string => generic.calendarMember('m365', memberId),
  calendarFamily: (): string => generic.calendarFamily('m365'),
  todoMember: (memberId: string, listId: string): string =>
    generic.todoMember('m365', memberId, listId),
} as const;
```

`src/modules/tasks/store.ts` imports `feedKeys` from `'../../m365/feed-keys.js'` on line 3 — leave it for now; Task 11 repoints it.

- [ ] **Step 3: Write the failing migration test**

Create `tests/integrations-migration.test.ts`. `tests/setup.ts` migrates before the suite, so this asserts the *shape* the migration must leave behind: no unprefixed keys can survive, and a prefixed key round-trips.

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { integrationSyncState } from '../src/integrations/schema.js';
import { feedKeys } from '../src/integrations/feed-keys.js';

describe('feed-key prefix migration', () => {
  it('rewrites legacy unprefixed keys to their m365 form', async () => {
    // Simulate rows written before the prefix convention existed.
    await db.insert(integrationSyncState).values([
      { feedKey: 'calendar:member:abc', syncToken: 't1' },
      { feedKey: 'calendar:family', syncToken: 't2' },
      { feedKey: 'todo:member:abc:list1', syncToken: 't3' },
    ]);

    // Re-run the data migration's statements against the seeded rows.
    await db.execute(sql`
      UPDATE integration_sync_state
         SET feed_key = 'm365:' || feed_key
       WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%'
    `);

    const rows = await db.select().from(integrationSyncState);
    const keys = rows.map((r) => r.feedKey).sort();
    expect(keys).toEqual([
      'm365:calendar:family',
      'm365:calendar:member:abc',
      'm365:todo:member:abc:list1',
    ]);
    // Tokens must survive the rewrite — losing one silently forces a full resync.
    expect(rows.find((r) => r.feedKey === 'm365:calendar:family')!.syncToken).toBe('t2');
  });

  it('is idempotent — a second run does not double-prefix', async () => {
    await db.insert(integrationSyncState).values([
      { feedKey: feedKeys.calendarFamily('m365'), syncToken: 't1' },
    ]);

    await db.execute(sql`
      UPDATE integration_sync_state
         SET feed_key = 'm365:' || feed_key
       WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%'
    `);

    const rows = await db.select().from(integrationSyncState);
    expect(rows.map((r) => r.feedKey)).toEqual(['m365:calendar:family']);
  });

  it('builds prefixed keys from the helpers', () => {
    expect(feedKeys.calendarMember('m365', 'abc')).toBe('m365:calendar:member:abc');
    expect(feedKeys.calendarFamily('google')).toBe('google:calendar:family');
    expect(feedKeys.todoMember('google', 'abc', 'l1')).toBe('google:todo:member:abc:l1');
    expect(feedKeys.calendarList('google', 'abc', 'c1')).toBe('google:calendar:member:abc:c1');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
npx vitest run tests/integrations-migration.test.ts
```

Expected: FAIL — `Cannot find module '../src/integrations/feed-keys.js'` before Step 1 is applied; after Step 1, the third test passes and the first two exercise the SQL directly.

- [ ] **Step 5: Write the data migration**

Drizzle generates nothing here (no schema change), so create `src/db/migrations/0024_prefixed_feed_keys.sql` by hand and register it. Check how the migrator discovers files — if `src/db/migrations/meta/_journal.json` lists entries, add one for `0024_prefixed_feed_keys` matching the shape of the `0023` entry, keeping `idx` sequential.

```sql
-- Feed keys gained a provider segment so an M365 feed and a Google feed for the
-- same member cannot collide on unique(feed_key). Existing rows predate the
-- convention and are all Microsoft.
--
-- Guarded by the LIKE so the statement is idempotent: an already-prefixed key
-- starts with 'm365:' and matches neither pattern.
UPDATE integration_sync_state
   SET feed_key = 'm365:' || feed_key
 WHERE feed_key LIKE 'calendar:%' OR feed_key LIKE 'todo:%';
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/integrations-migration.test.ts && npm run typecheck && npm test
```

Expected: PASS. Suites that build feed keys through the `m365/feed-keys.js` shim now produce prefixed strings; any test with a **hardcoded** unprefixed key string needs the prefix added. That is the spec's allowed "feed-key-fixture edit" category — nothing else.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/feed-keys.ts src/m365/feed-keys.ts src/db/migrations/ tests/integrations-migration.test.ts
git commit -m "refactor(integrations): prefix feed keys with their provider

A feed key now starts with its provider, so google:calendar:member:<id> and
m365:calendar:member:<id> can coexist under integration_sync_state's
unique(feed_key). Adds calendarList() for the Google calendar allowlist that
phase 2 introduces.

0024 rewrites existing keys in place, guarded by a LIKE so re-running it cannot
double-prefix. Sync tokens are preserved: dropping one would silently force a
full resync of that feed."
```

---

### Task 6: Provider-agnostic sync runner

`syncOneFeed` is documented as provider-agnostic but its `classify()` does `e instanceof GraphError`. That is the one real seam violation in the existing code, and it must be fixed before a second provider can use the runner.

**Files:**
- Create: `src/integrations/sync-runner.ts`
- Modify: `src/m365/sync-runner.ts` (shim + Graph classifier)
- Test: `tests/integrations-sync-runner.test.ts` (create)

**Interfaces:**
- Consumes: `IntegrationStore` (Task 4).
- Produces:
  - `interface FeedSyncResult { feedKey: string; status: 'ok' | 'skipped' | 'error'; upserted?: number; deleted?: number; reason?: string }`
  - `interface RunnableFeed { feedKey: string; memberId: string | null }`
  - `interface FeedPullOutcome { nextToken: string | null; fullResync: boolean; upserted: number; deleted: number }`
  - `interface SyncDeps { store: IntegrationStore; classifyError: (e: unknown) => string; fullResyncIntervalMs: number }`
  - `isFullResyncDue(lastFullSyncAt: Date | null, now: Date, intervalMs: number): boolean`
  - `syncOneFeed(deps: SyncDeps, feed: RunnableFeed, pullAndApply): Promise<FeedSyncResult>`
  - `DEFAULT_FULL_RESYNC_INTERVAL_MS` (7 days in ms)

- [ ] **Step 1: Write the failing test**

Create `tests/integrations-sync-runner.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { IntegrationStore } from '../src/integrations/store.js';
import {
  syncOneFeed, isFullResyncDue, DEFAULT_FULL_RESYNC_INTERVAL_MS,
} from '../src/integrations/sync-runner.js';
import { seedTestHousehold } from './helpers.js';

const store = new IntegrationStore('m365');

/** A classifier with no knowledge of Graph — proves the seam is real. */
const classifyError = (e: unknown): string =>
  e instanceof Error && e.message.startsWith('boom') ? 'test_reason' : 'error';

const deps = { store, classifyError, fullResyncIntervalMs: DEFAULT_FULL_RESYNC_INTERVAL_MS };

const ok = { nextToken: 'tok', fullResync: false, upserted: 2, deleted: 0 };

describe('syncOneFeed', () => {
  it('skips a member feed with no connection, without calling the provider', async () => {
    const { adult } = await seedTestHousehold();
    let called = false;
    const res = await syncOneFeed(deps, { feedKey: 'm365:todo:member:x:l', memberId: adult.user.id },
      async () => { called = true; return ok; });

    expect(res).toEqual({ feedKey: 'm365:todo:member:x:l', status: 'skipped', reason: 'no_connection' });
    expect(called).toBe(false);
  });

  it('skips a needs_reauth connection and records the failure', async () => {
    const { adult } = await seedTestHousehold();
    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r', scopes: '',
    });
    await store.recordRefreshError(adult.user.id, 'rejected', 'needs_reauth');

    let called = false;
    const res = await syncOneFeed(deps, { feedKey: 'm365:todo:member:y:l', memberId: adult.user.id },
      async () => { called = true; return ok; });

    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('needs_reauth');
    expect(called).toBe(false);
    expect((await store.getSyncState('m365:todo:member:y:l'))!.consecutiveFailures).toBe(1);
  });

  it('runs an app-only feed (memberId null) with no connection check', async () => {
    const res = await syncOneFeed(deps, { feedKey: 'm365:calendar:family', memberId: null },
      async () => ok);

    expect(res).toEqual({
      feedKey: 'm365:calendar:family', status: 'ok', upserted: 2, deleted: 0,
    });
    expect((await store.getSyncState('m365:calendar:family'))!.syncToken).toBe('tok');
  });

  it('classifies an error through the injected classifier, never Graph', async () => {
    const res = await syncOneFeed(deps, { feedKey: 'm365:calendar:family', memberId: null },
      async () => { throw new Error('boom-upstream'); });

    expect(res.status).toBe('error');
    expect(res.reason).toBe('test_reason');
    expect((await store.getSyncState('m365:calendar:family'))!.lastError).toBe('test_reason');
  });

  it('forces a full resync when the feed has never done one', async () => {
    let sawForce: boolean | null = null;
    await syncOneFeed(deps, { feedKey: 'm365:calendar:family', memberId: null },
      async (_token, force) => { sawForce = force; return { ...ok, fullResync: true }; });

    expect(sawForce).toBe(true);
    expect((await store.getSyncState('m365:calendar:family'))!.lastFullSyncAt).not.toBeNull();
  });

  it('honours a provider-supplied resync interval', () => {
    const now = new Date('2026-03-02T00:00:00Z');
    const oneDayAgo = new Date('2026-03-01T00:00:00Z');
    expect(isFullResyncDue(null, now, 1000)).toBe(true);
    expect(isFullResyncDue(oneDayAgo, now, 7 * 24 * 3600 * 1000)).toBe(false);
    expect(isFullResyncDue(oneDayAgo, now, 60 * 1000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/integrations-sync-runner.test.ts
```

Expected: FAIL — `Cannot find module '../src/integrations/sync-runner.js'`.

- [ ] **Step 3: Create `src/integrations/sync-runner.ts`**

```ts
import type { IntegrationStore } from './store.js';

/**
 * Provider-agnostic per-feed sync machinery, shared by every provider and both
 * surfaces (calendar mirror + task mirror).
 *
 * A concrete runner enumerates its feeds, then for each calls {@link syncOneFeed}
 * with a `pullAndApply` closure that does the provider pull + mirror write. This
 * module owns everything AROUND that closure: the needs_reauth / no_connection
 * short-circuit, reading and advancing sync state, deciding when a full re-window
 * is due, recording success/failure, and never throwing for a per-feed error.
 *
 * It knows nothing about any upstream API. Error classification arrives through
 * {@link SyncDeps.classifyError} — previously this module did
 * `e instanceof GraphError`, which made "provider-agnostic" untrue.
 */

export interface FeedSyncResult {
  feedKey: string;
  status: 'ok' | 'skipped' | 'error';
  upserted?: number;
  deleted?: number;
  /** Short classified reason when status is 'skipped' or 'error'. */
  reason?: string;
}

/** The minimum a runner must tell {@link syncOneFeed} about a feed. */
export interface RunnableFeed {
  feedKey: string;
  /**
   * Member whose delegated connection backs this feed, or null for a feed that
   * needs no per-member connection (the M365 app-only family mailbox). Used
   * ONLY for the connection health short-circuit.
   */
  memberId: string | null;
}

/** What a `pullAndApply` closure reports back after writing the mirror. */
export interface FeedPullOutcome {
  nextToken: string | null;
  fullResync: boolean;
  upserted: number;
  deleted: number;
}

/**
 * How often a feed must do a full (freshly-windowed / whole-feed) re-sync even
 * when its sync token is still valid. For a calendar this re-anchors the rolling
 * window; for tasks it re-pulls the whole list so drift from missed deltas
 * self-heals. Without it, a token replays its frozen scope forever until an
 * unpredictable upstream token-invalidation.
 *
 * Provider-supplied, because providers differ: a delta-capable provider wants
 * this rare, while a provider with no delta API (Google Tasks) pulls a full
 * snapshot every tick and effectively ignores it.
 */
export const DEFAULT_FULL_RESYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SyncDeps {
  store: IntegrationStore;
  /**
   * Map a thrown value to a SHORT, safe token for `integration_sync_state.lastError`.
   * MUST NOT return an upstream response body or any token material.
   */
  classifyError: (e: unknown) => string;
  fullResyncIntervalMs: number;
}

/** Whether a feed is due for a deterministic periodic re-window / full re-sync. */
export function isFullResyncDue(
  lastFullSyncAt: Date | null, now: Date, intervalMs: number,
): boolean {
  if (!lastFullSyncAt) return true; // never done a full sync → due
  return now.getTime() - lastFullSyncAt.getTime() >= intervalMs;
}

/**
 * Sync one feed. Isolated: never throws — always returns a result.
 *
 *  1. For a member-backed feed, short-circuit on connection state: a missing
 *     connection is skipped silently; a `needs_reauth` connection is recorded as
 *     a failure but NOT hot-retried upstream (no token refresh attempt).
 *  2. Otherwise read sync state, decide whether a periodic re-window is due, run
 *     the caller's `pullAndApply`, and record success — stamping `lastFullSyncAt`
 *     only when this pull was a full sync.
 *  3. Any error is classified to a short token and recorded as a failure.
 */
export async function syncOneFeed(
  deps: SyncDeps,
  feed: RunnableFeed,
  pullAndApply: (syncToken: string | null, forceFullResync: boolean) => Promise<FeedPullOutcome>,
): Promise<FeedSyncResult> {
  if (feed.memberId) {
    const conn = await deps.store.getConnection(feed.memberId);
    if (!conn) {
      return { feedKey: feed.feedKey, status: 'skipped', reason: 'no_connection' };
    }
    if (conn.status === 'needs_reauth') {
      await deps.store.recordSyncFailure(feed.feedKey, 'needs_reauth');
      return { feedKey: feed.feedKey, status: 'skipped', reason: 'needs_reauth' };
    }
  }

  try {
    const state = await deps.store.getSyncState(feed.feedKey);
    const forceFullResync = isFullResyncDue(
      state?.lastFullSyncAt ?? null, new Date(), deps.fullResyncIntervalMs,
    );
    const outcome = await pullAndApply(state?.syncToken ?? null, forceFullResync);
    await deps.store.recordSyncSuccess(feed.feedKey, outcome.nextToken, outcome.fullResync);
    return {
      feedKey: feed.feedKey, status: 'ok',
      upserted: outcome.upserted, deleted: outcome.deleted,
    };
  } catch (e) {
    const reason = deps.classifyError(e);
    await deps.store.recordSyncFailure(feed.feedKey, reason);
    return { feedKey: feed.feedKey, status: 'error', reason };
  }
}
```

- [ ] **Step 4: Replace `src/m365/sync-runner.ts` with the Graph classifier + a shim**

The Graph-specific `classify` stays in `src/m365/`, which is where a Graph type belongs.

```ts
import { GraphError } from './graph.js';
import { DEFAULT_FULL_RESYNC_INTERVAL_MS } from '../integrations/sync-runner.js';

/**
 * Classify a Graph failure into a SHORT, safe token for
 * `integration_sync_state.lastError`. Never returns an upstream response body or
 * token material. Passed to the generic runner as `classifyError` — the runner
 * itself has no Graph knowledge.
 */
export function classify(e: unknown): string {
  if (e instanceof GraphError) {
    // Check no_connection first: that error also carries status 401, so the
    // needs_reauth (status 401) branch would otherwise swallow it. On the sync
    // path this never matters (a missing connection short-circuits before any
    // Graph call), but a write-back reaches classify directly.
    if (e.code === 'no_connection') return 'no_connection';
    if (e.code === 'needs_reauth' || e.status === 401) return 'needs_reauth';
    return `graph_${e.status}`;
  }
  if (e instanceof TypeError) return 'network_error';
  return 'error';
}

/** M365's re-window cadence. Overridable for ops tuning; not a credential. */
export function m365FullResyncIntervalMs(): number {
  const raw = process.env['M365_FULL_RESYNC_INTERVAL_SECONDS'];
  if (!raw) return DEFAULT_FULL_RESYNC_INTERVAL_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_FULL_RESYNC_INTERVAL_MS;
}

// TEMPORARY SHIM — re-exported so calendar-sync.ts / task-sync.ts compile until
// they are rewired onto the integrations layer.
export {
  syncOneFeed, isFullResyncDue,
  type FeedSyncResult, type RunnableFeed, type FeedPullOutcome,
} from '../integrations/sync-runner.js';
```

> `syncOneFeed`'s signature changed (first argument is now `SyncDeps`, not `M365Runtime`), so this re-export is not source-compatible. Task 8 rewires the two call sites; until then `npm run typecheck` will flag `src/m365/calendar-sync.ts` and `src/m365/task-sync.ts`. **Fix those two call sites now**, in this task, by passing deps:

In both `src/m365/calendar-sync.ts` and `src/m365/task-sync.ts`, replace `syncOneFeed(rt, feed, ...)` with:

```ts
syncOneFeed(
  { store: rt.store, classifyError: classify, fullResyncIntervalMs: m365FullResyncIntervalMs() },
  feed,
  async (syncToken, forceFullResync) => { /* unchanged body */ },
)
```

adding `import { classify, m365FullResyncIntervalMs } from './sync-runner.js';` to each.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/integrations-sync-runner.test.ts && npm run typecheck && npm test
```

Expected: PASS. `tests/m365-calendar-sync.test.ts` and `tests/m365-tasks-sync.test.ts` drive the runners through `runCalendarSync` / `runTaskSync`, whose signatures did not change.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/sync-runner.ts src/m365/sync-runner.ts src/m365/calendar-sync.ts src/m365/task-sync.ts tests/integrations-sync-runner.test.ts
git commit -m "refactor(integrations): make the sync runner genuinely provider-agnostic

syncOneFeed classified failures with 'e instanceof GraphError' while claiming to
be provider-agnostic. Error classification and the full-resync interval are now
injected, so a provider supplies its own; the Graph classifier stays in
src/m365/ where a Graph type belongs.

The interval becomes provider-supplied because providers differ: a delta-capable
provider wants a rare re-window, while one with no delta API pulls a full
snapshot every tick."
```

---

### Task 7: The provider registry

**Files:**
- Create: `src/integrations/registry.ts`
- Test: `tests/integrations-registry.test.ts` (create)

**Interfaces:**
- Consumes: `IntegrationStore` (Task 4), `CalendarProvider` (`src/modules/calendar/providers/types.js`), `TaskProvider` (`src/modules/tasks/providers/types.js`).
- Produces:
  - `interface RegisteredProvider { id: string; store: IntegrationStore; classifyError: (e: unknown) => string; fullResyncIntervalMs: number; authorizeUrl: (state: string) => string; completeConnect: (code: string) => Promise<{ accountLabel: string; refreshToken: string; scopes: string }>; calendar: CalendarProvider | null; tasks: TaskProvider | null; runCalendarSync: () => Promise<FeedSyncResult[]>; runTaskSync: () => Promise<FeedSyncResult[]> }`
  - `registerProvider(p: RegisteredProvider): void`
  - `getProvider(id: string): RegisteredProvider | null`
  - `listProviders(): RegisteredProvider[]`
  - `clearProviders(): void` (test seam)
  - `getTaskProviderFor(source: string): TaskProvider | null`

- [ ] **Step 1: Write the failing test**

Create `tests/integrations-registry.test.ts`.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider, getProvider, listProviders, clearProviders, getTaskProviderFor,
} from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';

function fake(id: string, tasks: unknown = null) {
  return {
    id,
    store: new IntegrationStore(id),
    classifyError: () => 'error',
    fullResyncIntervalMs: 1000,
    authorizeUrl: (state: string) => `https://example.test/${id}?state=${state}`,
    completeConnect: async () => ({ accountLabel: `a@${id}`, refreshToken: 'r', scopes: '' }),
    calendar: null,
    tasks: tasks as never,
    runCalendarSync: async () => [],
    runTaskSync: async () => [],
  };
}

describe('provider registry', () => {
  beforeEach(() => clearProviders());

  it('registers and looks up by id', () => {
    registerProvider(fake('m365'));
    expect(getProvider('m365')!.id).toBe('m365');
    expect(getProvider('google')).toBeNull();
  });

  it('holds several providers at once, in registration order', () => {
    registerProvider(fake('m365'));
    registerProvider(fake('google'));
    expect(listProviders().map((p) => p.id)).toEqual(['m365', 'google']);
  });

  it('re-registering the same id replaces rather than duplicates', () => {
    registerProvider(fake('m365'));
    registerProvider(fake('m365'));
    expect(listProviders()).toHaveLength(1);
  });

  it('resolves a task provider by mirror row source', () => {
    const graphTasks = { source: 'm365' };
    const googleTasks = { source: 'google' };
    registerProvider(fake('m365', graphTasks));
    registerProvider(fake('google', googleTasks));

    expect(getTaskProviderFor('m365')).toBe(graphTasks);
    expect(getTaskProviderFor('google')).toBe(googleTasks);
    expect(getTaskProviderFor('caldav')).toBeNull();
  });

  it('returns null for a provider registered without a task surface', () => {
    registerProvider(fake('m365', null));
    expect(getTaskProviderFor('m365')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/integrations-registry.test.ts
```

Expected: FAIL — `Cannot find module '../src/integrations/registry.js'`.

- [ ] **Step 3: Create `src/integrations/registry.ts`**

```ts
import type { IntegrationStore } from './store.js';
import type { FeedSyncResult } from './sync-runner.js';
import type { CalendarProvider } from '../modules/calendar/providers/types.js';
import type { TaskProvider } from '../modules/tasks/providers/types.js';

/**
 * One registered external provider. Replaces the single global `setTaskProvider`
 * slot, which could only ever hold one implementation process-wide — the reason
 * M365 and Google could not previously coexist.
 *
 * A provider registers itself from its module's `register()` when its env group
 * is present. Nothing here knows about any specific upstream API: the provider
 * supplies its own transport, auth, error classification and sync cadence.
 */
export interface RegisteredProvider {
  /** Stable id, matching the `source` column on both mirror tables ('m365' | 'google'). */
  id: string;
  store: IntegrationStore;
  /** Maps a thrown value to a short safe reason token. Never token material. */
  classifyError: (e: unknown) => string;
  fullResyncIntervalMs: number;

  /** Consent URL for the connect redirect; `state` binds the member. */
  authorizeUrl: (state: string) => string;
  /**
   * Exchange the callback code and resolve the account identity. Throws on any
   * failure — the caller redirects with a generic error rather than surfacing
   * upstream detail, which may reference tokens.
   */
  completeConnect: (code: string) => Promise<{
    accountLabel: string; refreshToken: string; scopes: string;
  }>;

  /** Null when this provider does not offer that surface. */
  calendar: CalendarProvider | null;
  tasks: TaskProvider | null;

  runCalendarSync: () => Promise<FeedSyncResult[]>;
  runTaskSync: () => Promise<FeedSyncResult[]>;
}

// Insertion-ordered, so listProviders() is stable and the scheduler ticks
// providers in registration order.
const providers = new Map<string, RegisteredProvider>();

/** Register (or replace) a provider. Idempotent per id. */
export function registerProvider(p: RegisteredProvider): void {
  providers.set(p.id, p);
}

export function getProvider(id: string): RegisteredProvider | null {
  return providers.get(id) ?? null;
}

export function listProviders(): RegisteredProvider[] {
  return [...providers.values()];
}

/** Test seam: drop every registration. */
export function clearProviders(): void {
  providers.clear();
}

/**
 * The task provider for a mirror row's `source`. This is the lookup that makes
 * write-back correct with two providers connected: completing a Google-mirrored
 * task must reach Google, not whichever provider happened to register last.
 * Null when the provider is absent or offers no task surface — callers turn that
 * into a classified `provider_unavailable`.
 */
export function getTaskProviderFor(source: string): TaskProvider | null {
  return providers.get(source)?.tasks ?? null;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/integrations-registry.test.ts && npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/registry.ts tests/integrations-registry.test.ts
git commit -m "feat(integrations): add the provider registry

Replaces the single global task-provider slot, which could only hold one
implementation process-wide. getTaskProviderFor(source) resolves by the mirror
row's source column, so completing a Google-mirrored task reaches Google rather
than whichever provider registered last."
```

---

### Task 8: Rewire `src/m365/` onto the layer and delete the shims

The mechanical task. Every shim created in Tasks 3–6 is removed and its importers repointed. Nothing about behaviour changes.

**Files:**
- Delete: `src/m365/schema.ts`, `src/m365/store.ts`, `src/m365/crypto.ts`, `src/m365/feed-keys.ts`
- Modify: `src/m365/runtime.ts`, `src/m365/delegated.ts`, `src/m365/index.ts`, `src/m365/calendar-sync.ts`, `src/m365/task-sync.ts`, `src/m365/calendar-provider.ts`, `src/m365/task-provider.ts`, `src/modules/tasks/store.ts`, and every test importing a deleted path

**Interfaces:**
- Consumes: everything produced by Tasks 3–7.
- Produces: `M365Runtime` now carries `store: IntegrationStore` (was `M365Store`); `createM365Runtime` unchanged in signature.

- [ ] **Step 1: Find every importer of a shimmed path**

```bash
grep -rn "m365/schema\|m365/store\|m365/crypto\|m365/feed-keys" src tests web/src
```

Record the list. Each one is repointed in Step 2.

- [ ] **Step 2: Repoint imports**

Apply mechanically across `src/` and `tests/`:

| Old | New |
|---|---|
| `from '../m365/schema.js'` / `'./schema.js'` (in `src/m365/`) | `from '../integrations/schema.js'` / `'./integrations/schema.js'` as appropriate |
| `m365Connections` | `integrationConnections` |
| `m365SyncState` | `integrationSyncState` |
| `M365ConnectionRow` | `IntegrationConnectionRow` |
| `M365SyncStateRow` | `IntegrationSyncStateRow` |
| `M365ConnectionStatus` | `IntegrationConnectionStatus` |
| `M365Store` | `IntegrationStore` |
| `PublicM365Connection` | `PublicIntegrationConnection` |
| `from '.../m365/crypto.js'` | `from '.../integrations/crypto.js'` |
| `from '.../m365/feed-keys.js'` | `from '.../integrations/feed-keys.js'` |

Every `feedKeys.*` call gains its provider argument: `feedKeys.calendarFamily()` → `feedKeys.calendarFamily('m365')`, `feedKeys.todoMember(m, l)` → `feedKeys.todoMember('m365', m, l)`, `feedKeys.calendarMember(m)` → `feedKeys.calendarMember('m365', m)`.

In `src/modules/tasks/store.ts`, line 3 becomes:

```ts
import { feedKeys } from '../../integrations/feed-keys.js';
```

and its two `feedKeys.todoMember(...)` call sites (in `setAllowlist` and `listAllowlistedFeeds`) take `'m365'` as the first argument. **This is a known temporary wart** — the tasks store should not hardcode a provider. Task 11 removes it by threading the provider through `TaskFeed`. Leave a comment saying so:

```ts
// TODO(task-11): hardcoded provider — threaded through TaskFeed when the tasks
// module resolves providers by the mirror row's source.
```

- [ ] **Step 3: Update `src/m365/runtime.ts`**

Change the store type and construction:

```ts
import { IntegrationStore } from '../integrations/store.js';
```

In `M365Runtime`, `store: M365Store` becomes `store: IntegrationStore`, and in `createM365Runtime`:

```ts
const store = new IntegrationStore('m365');
```

- [ ] **Step 4: Update `src/m365/delegated.ts`**

Its constructor takes `store: M365Store`; change the type import to `IntegrationStore` from `'../integrations/store.js'`. `exchangeCode` already returns `{ refreshToken, accessToken, scopes }` — unchanged.

The one call site that used `accountUpn` is `src/m365/routes.ts`; it becomes `accountLabel: me.userPrincipalName`. (That file is replaced wholesale in Task 9; making the field rename here keeps this task's build green.)

- [ ] **Step 5: Delete the shims**

```bash
git rm src/m365/schema.ts src/m365/store.ts src/m365/crypto.ts src/m365/feed-keys.ts
```

Remove their re-export lines from `src/m365/index.ts`, and re-export the new names instead:

```ts
export { IntegrationStore, type PublicIntegrationConnection } from '../integrations/store.js';
export { feedKeys } from '../integrations/feed-keys.js';
export type {
  IntegrationConnectionRow, IntegrationSyncStateRow, IntegrationConnectionStatus,
} from '../integrations/schema.js';
```

- [ ] **Step 6: Typecheck until clean, then run the suite**

```bash
npm run typecheck
```

Iterate until it passes — the compiler enumerates every remaining stale import. Then:

```bash
npm test
```

Expected: PASS. Allowed test edits in this task are **import paths, symbol renames from the table above, and feed-key fixtures**. An assertion about *behaviour* that needs changing means the refactor leaked — stop and report.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "refactor(m365): rewire onto the integrations layer and drop the shims

Repoints every importer at src/integrations/ and deletes the four temporary
re-export shims. src/m365/ now holds only Microsoft Graph: graph, delegated,
app-only, the two providers, the two sync runners and the Graph error
classifier.

M365Runtime.store is an IntegrationStore bound to 'm365'. The tasks store
temporarily hardcodes 'm365' when building feed keys; that is threaded through
TaskFeed when the module starts resolving providers by mirror-row source."
```

---

### Task 9: The integrations routes

**Files:**
- Create: `src/integrations/routes.ts`, `src/integrations/state.ts`, `src/integrations/index.ts`
- Delete: `src/m365/routes.ts`, `src/m365/state.ts`
- Modify: `src/modules/index.ts`, `src/m365/index.ts`
- Test: `tests/integrations-routes.test.ts` (create), `tests/m365-routes.test.ts` (repoint)

**Interfaces:**
- Consumes: the registry (Task 7), `IntegrationStore` (Task 4).
- Produces: `integrationsModule: HeorthModule` mounting `/api/v1/integrations`; `signConnectState(memberId)`, `verifyConnectState(state)` moved from `src/m365/state.ts` unchanged.

Route surface, replacing `/api/v1/m365/*`:

```
GET    /api/v1/integrations/status                    any authed session
POST   /api/v1/integrations/sync                      admin
GET    /api/v1/integrations/:provider/connect         302 to consent
GET    /api/v1/integrations/:provider/connect-url     JSON twin
GET    /api/v1/integrations/:provider/callback        token exchange
DELETE /api/v1/integrations/:provider/connection      disconnect
```

**The role rules are carried over exactly** — this task must not become a quiet permissions change:
- `feeds[]` → any authenticated session (carries no secrets, and a non-admin kiosk needs household-wide staleness)
- `connections[]` → admin **and** adult; children see only their own `connection`
- the sync token is never projected
- the maintenance-admin quarantine keeps its redirect-not-throw behaviour on the callback and its throw on `/connect-url`

- [ ] **Step 1: Move the state helpers**

`git mv src/m365/state.ts src/integrations/state.ts` and fix its relative imports. No content change.

- [ ] **Step 2: Write the failing route test**

Create `tests/integrations-routes.test.ts`.

> **Corrected 2026-08-30, during execution.** An earlier version of this test imported a bare `app` from `../src/app.js`. **No such export exists** — `src/app.ts` exports `createApp(modules)` and `heorthErrorHandler`. Route tests build their own bare Hono instance; copy the pattern from `tests/m365-routes.test.ts:24-28`, including the explicit `onError`, whose comment explains why: without it a thrown `MaintenanceAdminError` surfaces as an unhandled 500 instead of the documented 403.

Add this helper to the test file and use it for every request:

```ts
/**
 * A bare app with just the integrations router mounted. `heorthErrorHandler` is
 * mounted explicitly because this app is NOT built via `createApp` — without it a
 * thrown MaintenanceAdminError would surface as an unhandled 500 rather than 403.
 */
function integrationsApp() {
  const app = new Hono();
  app.route('/api/v1/integrations', integrationsRouter);
  app.onError(heorthErrorHandler);
  return app;
}
```

The "retires the old m365 route surface" test is the one exception: a bare app that never mounted `/api/v1/m365` would 404 trivially and prove nothing. Build that one with `createApp(ALL_MODULES)` so the assertion is about the real application's routing table.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createApp, heorthErrorHandler } from '../src/app.js';
import { integrationsRouter } from '../src/integrations/routes.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { clearProviders, registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';

const store = new IntegrationStore('m365');

function stubProvider() {
  return {
    id: 'm365',
    store,
    classifyError: () => 'error',
    fullResyncIntervalMs: 1000,
    authorizeUrl: (state: string) => `https://login.test/authorize?state=${state}`,
    completeConnect: async () => ({
      accountLabel: 'member@contoso.test', refreshToken: 'r', scopes: 'User.Read',
    }),
    calendar: null,
    tasks: null,
    runCalendarSync: async () => [{ feedKey: 'm365:calendar:family', status: 'ok' as const }],
    runTaskSync: async () => [],
  };
}

describe('/api/v1/integrations', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider(stubProvider());
  });

  it('returns a consent url for the acting member', async () => {
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/m365/connect-url', {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toContain('https://login.test/authorize?state=');
  });

  it('404s for an unregistered provider', async () => {
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/google/connect-url', {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(404);
  });

  it('shows feeds to any authenticated session, including a child', async () => {
    await store.recordSyncSuccess('m365:calendar:family', 'tok');
    const { child } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(child.jwt),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.feeds.map((f: { feedKey: string }) => f.feedKey))
      .toContain('m365:calendar:family');
    // Household-wide connection list stays adult/admin only.
    expect(body.data.connections).toBeUndefined();
  });

  it('never projects the sync token', async () => {
    await store.recordSyncSuccess('m365:calendar:family', 'super-secret-delta-url');
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    expect(await res.text()).not.toContain('super-secret-delta-url');
  });

  it('gives an adult the household-wide connection list', async () => {
    const { adult } = await seedTestHousehold();
    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r', scopes: '',
    });
    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    const body = await res.json();
    expect(body.data.connections).toHaveLength(1);
    expect(body.data.connections[0]).not.toHaveProperty('refreshTokenEncrypted');
  });

  it('restricts the manual sync trigger to admins', async () => {
    const { adult, admin } = await seedTestHousehold();
    const denied = await integrationsApp().request('/api/v1/integrations/sync', {
      method: 'POST', headers: authHeaders(adult.jwt), body: '{}',
    });
    expect(denied.status).toBe(403);

    const allowed = await integrationsApp().request('/api/v1/integrations/sync', {
      method: 'POST', headers: authHeaders(admin.jwt), body: '{}',
    });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.results).toHaveLength(1);
  });

  it('disconnects the acting member and 404s when there is nothing to disconnect', async () => {
    const { adult } = await seedTestHousehold();
    const empty = await integrationsApp().request('/api/v1/integrations/m365/connection', {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(empty.status).toBe(404);

    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r', scopes: '',
    });
    const done = await integrationsApp().request('/api/v1/integrations/m365/connection', {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(done.status).toBe(200);
  });

  it('retires the old m365 route surface', async () => {
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/m365/status', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run tests/integrations-routes.test.ts
```

Expected: FAIL — every request 404s, because nothing mounts `/api/v1/integrations` yet.

- [ ] **Step 4: Create `src/integrations/routes.ts`**

```ts
import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../wiring.js';
import { assertNotMaintenanceAdmin, isMaintenanceAdminId } from '../household/maintenance-admin.js';
import { signConnectState, verifyConnectState } from './state.js';
import { getProvider, listProviders } from './registry.js';
import type { IntegrationSyncStateRow } from './schema.js';

/**
 * Public projection of per-feed sync state for the health surface and the Hearth
 * View staleness badges. NEVER exposes the sync token — a Graph delta token is
 * an opaque URL that embeds the mailbox.
 */
function toPublicFeed(row: IntegrationSyncStateRow) {
  return {
    feedKey: row.feedKey,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    updatedAt: row.updatedAt,
  };
}

/**
 * Provider-scoped connection routes, mounted at `/api/v1/integrations`.
 * Replaces `/api/v1/m365/*`, which could only ever describe one provider.
 *
 * Role rules are carried over verbatim from the M365 routes:
 *  - `feeds[]` is household-visible to ANY authenticated session. It carries no
 *    secrets, and the Hearth View composes every member's events — so a non-admin
 *    kiosk session must see staleness for feeds it does not own, otherwise the
 *    wall can look current while another member's feed is silently dead.
 *  - the household-wide `connections` list is admin AND adult: it carries no
 *    token material, and an adult co-parent must be able to see that another
 *    member's link is dead. Children stay scoped to their own connection.
 *  - an admin session may itself be a promoted household member, so it must still
 *    see and be able to disconnect its OWN connection.
 */
export const integrationsRouter = new Hono();

// --- literal routes first, so they do not collide with /:provider/… ---------

integrationsRouter.get('/status', requireAuth, async (c) => {
  const auth = c.get('auth');
  const providers = listProviders();
  // Sync state is not provider-scoped: one call returns every feed the household
  // has, which is exactly what the wall needs.
  const feeds = providers.length > 0
    ? (await providers[0]!.store.listSyncState()).map(toPublicFeed)
    : [];

  if (auth.role === 'admin' || auth.role === 'adult') {
    const perProvider = await Promise.all(providers.map(async (p) => ({
      connection: await p.store.getConnection(auth.userId),
      connections: (await p.store.listConnections()).map((row) => ({ ...row, provider: p.id })),
    })));
    return ok(c, {
      connection: perProvider.map((r) => r.connection).find((r) => r !== null) ?? null,
      connections: perProvider.flatMap((r) => r.connections),
      feeds,
      providers: providers.map((p) => p.id),
    });
  }

  const own = await Promise.all(providers.map((p) => p.store.getConnection(auth.userId)));
  return ok(c, {
    connection: own.find((r) => r !== null) ?? null,
    feeds,
    providers: providers.map((p) => p.id),
  });
});

/**
 * Manual sync trigger (admin only) — runs every registered provider's calendar
 * feeds then its task feeds once, and returns the combined per-feed summary.
 * Used by dev and tests to drive sync deterministically without the scheduler.
 */
integrationsRouter.post('/sync', requireAuth, requireRole('admin'), async (c) => {
  const results = [];
  for (const p of listProviders()) {
    results.push(...await p.runCalendarSync());
    results.push(...await p.runTaskSync());
  }
  return ok(c, { results });
});

// --- provider-scoped --------------------------------------------------------

integrationsRouter.get('/:provider/connect', requireAuth, async (c) => {
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return err(c, 'NOT_FOUND', 'Unknown or disabled provider', 404);
  const state = await signConnectState(c.get('auth').userId);
  return c.redirect(provider.authorizeUrl(state), 302);
});

/**
 * JSON twin of `/connect`. The web client authenticates with a Bearer token from
 * localStorage, which a top-level browser navigation cannot carry — so the UI
 * fetches the consent URL here and assigns `window.location.href` itself.
 */
integrationsRouter.get('/:provider/connect-url', requireAuth, async (c) => {
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return err(c, 'NOT_FOUND', 'Unknown or disabled provider', 404);
  const memberId = c.get('auth').userId;
  await assertNotMaintenanceAdmin(memberId);
  const state = await signConnectState(memberId);
  return ok(c, { url: provider.authorizeUrl(state) });
});

integrationsRouter.get('/:provider/callback', async (c) => {
  const id = c.req.param('provider');
  const provider = getProvider(id);
  if (!provider) return c.redirect('/profile?connectError=UNKNOWN_PROVIDER', 302);

  if (c.req.query('error')) {
    return c.redirect(`/profile?connectError=${id.toUpperCase()}_CONSENT_DENIED`, 302);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.redirect(`/profile?connectError=${id.toUpperCase()}_CALLBACK_INVALID`, 302);
  }

  const memberId = await verifyConnectState(state);
  if (!memberId) return c.redirect(`/profile?connectError=${id.toUpperCase()}_STATE_INVALID`, 302);

  // Redirect (not throw) here: unlike /connect-url this is a browser navigation,
  // so a thrown MaintenanceAdminError would render a raw JSON 403 in the user's
  // tab — exactly the failure mode the quarantine work eliminated.
  if (await isMaintenanceAdminId(memberId)) {
    return c.redirect('/profile?connectError=ADMIN_NOT_A_MEMBER', 302);
  }

  try {
    const { accountLabel, refreshToken, scopes } = await provider.completeConnect(code);
    await provider.store.upsertConnection({ memberId, accountLabel, refreshToken, scopes });
  } catch {
    // Upstream identity failure or unexpected error. Details are not surfaced
    // (they may reference tokens); the member simply retries the connect.
    return c.redirect(`/profile?connectError=${id.toUpperCase()}_EXCHANGE_FAILED`, 302);
  }
  return c.redirect(`/profile?connected=${id}`, 302);
});

integrationsRouter.delete('/:provider/connection', requireAuth, async (c) => {
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return err(c, 'NOT_FOUND', 'Unknown or disabled provider', 404);
  const deleted = await provider.store.deleteConnection(c.get('auth').userId);
  if (!deleted) return err(c, 'NOT_FOUND', 'No connection to disconnect', 404);
  return ok(c, { disconnected: true });
});
```

- [ ] **Step 5: Create `src/integrations/index.ts`**

```ts
import type { Hono } from 'hono';
import type { HeorthModule } from '../modules/registry.js';
import { integrationsRouter } from './routes.js';
import { listProviders } from './registry.js';

/**
 * The integrations area. Always registers — unlike the old m365 module it is not
 * gated on any one provider's env group, because it hosts the routes for ALL
 * providers. With no provider registered, `/status` reports empty lists and
 * `/:provider/*` 404s, which is the honest answer.
 *
 * Providers register themselves from their own module's `register()`. Module
 * order in `ALL_MODULES` therefore matters: provider modules must be listed
 * BEFORE this one so their registrations exist when a request arrives.
 */
export const integrationsModule: HeorthModule = {
  name: 'integrations',
  register(app: Hono): void {
    app.route('/api/v1/integrations', integrationsRouter);
  },
};

export { registerProvider, getProvider, listProviders, clearProviders, getTaskProviderFor,
  type RegisteredProvider } from './registry.js';
export { IntegrationStore, type PublicIntegrationConnection } from './store.js';
export { feedKeys } from './feed-keys.js';
export {
  syncOneFeed, isFullResyncDue, DEFAULT_FULL_RESYNC_INTERVAL_MS,
  type FeedSyncResult, type RunnableFeed, type FeedPullOutcome, type SyncDeps,
} from './sync-runner.js';
export type {
  IntegrationConnectionRow, IntegrationSyncStateRow, IntegrationConnectionStatus,
} from './schema.js';
```

- [ ] **Step 6: Register the module and make `m365Module` a registrar**

In `src/modules/index.ts`, import `integrationsModule` and add it **after** `m365Module`:

```ts
import { integrationsModule } from '../integrations/index.js';
```

```ts
  // M365 is a no-op when its env is absent (integration disabled) — see src/m365.
  m365Module,
  // Integrations hosts the routes for every provider; providers register from
  // their own module, so this MUST come after them in this list.
  integrationsModule,
```

Rewrite `src/m365/index.ts`'s `register` to register into the registry rather than mount routes:

```ts
export const m365Module: HeorthModule = {
  name: 'm365',
  register(): void {
    if (!isM365Enabled()) return;
    const rt = getM365Runtime();
    registerProvider({
      id: 'm365',
      store: rt.store,
      classifyError: classify,
      fullResyncIntervalMs: m365FullResyncIntervalMs(),
      authorizeUrl: (state) => rt.delegated.authorizeUrl(state),
      completeConnect: async (code) => {
        const { refreshToken, accessToken, scopes } = await rt.delegated.exchangeCode(code);
        const me = await rt.delegated.getMe(accessToken);
        return { accountLabel: me.userPrincipalName, refreshToken, scopes };
      },
      calendar: new GraphCalendarProvider(rt),
      tasks: new GraphTaskProvider(rt),
      runCalendarSync: () => runCalendarSync(rt),
      runTaskSync: () => runTaskSync(rt),
    });
  },
};
```

Delete `src/m365/routes.ts` and its export from `src/m365/index.ts`.

- [ ] **Step 7: Repoint `tests/m365-routes.test.ts`**

> **Corrected 2026-08-30, during execution.** This is more than route-path edits, and the plan understated it. `tests/m365-routes.test.ts` imports `m365Router` from `../src/m365/routes.js` and mounts it in its own `enabledApp()` helper. **This task deletes that module**, so the file cannot merely be repointed — its app helper has no router to mount.

The file's coverage splits in two:

- **Connection-flow behaviour that is now provider-generic** (auth required on connect, consent redirect, callback state validation, the maintenance-admin quarantine including redirect-not-throw, disconnect, the role rules on `/status`) is already covered by `tests/integrations-routes.test.ts`. Do not duplicate it.
- **Anything genuinely Graph-specific that survives** — the fake-Graph runtime installation, `exchangeCode`/`getMe` behaviour reached through the callback — keeps a home. Move those cases into the new file using `integrationsApp()`, or into a Graph-focused suite if they do not fit.

Then delete `tests/m365-routes.test.ts`. **Before deleting it, list its test names in your report** and say, for each, which new test covers it or why it is obsolete. A deleted test is only safe when someone can see what replaced it — do not delete first and reconstruct the justification afterwards.

It also imports `m365Connections` from `../src/m365/schema.js` and `feedKeys` from `../src/m365/feed-keys.js`, both deleted in Task 8, and `signConnectState` from `../src/m365/state.js`, which this task moves. Whatever survives must import from `../src/integrations/`.

- [ ] **Step 8: Run the tests**

```bash
npx vitest run tests/integrations-routes.test.ts && npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 9: Verify the Entra redirect URI against the deployed config**

The callback path moved, and the Entra app registration was updated by hand on 2026-08-29. **Do not assume what it was set to.** Check the deployed value:

```bash
grep M365_REDIRECT_URI ../deploy/.env
```

It must end in `/api/v1/integrations/m365/callback`. If it still ends in `/api/v1/m365/callback`, the connect flow will fail at consent with `redirect_uri_mismatch` — stop and confirm with the operator which of the two (the `.env` or the Entra registration) is the one to change. Never paste the file's contents into a commit, a log, or a report; report only whether the path matches.

- [ ] **Step 10: Commit**

```bash
git add -A src tests
git commit -m "feat(integrations): provider-scoped route surface, retiring /api/v1/m365

/api/v1/integrations/:provider/{connect,connect-url,callback,connection} plus a
household-wide /status and an admin /sync across every registered provider.

Role rules are carried over verbatim: feeds[] to any authenticated session
because the Hearth View needs household-wide staleness on a non-admin kiosk;
connections[] to admin and adult; children scoped to their own. The sync token
is still never projected.

m365Module no longer mounts routes -- it registers itself as a provider."
```

---

### Task 10: One scheduler across all providers

**Files:**
- Create: `src/integrations/scheduler.ts`
- Delete: `src/m365/scheduler.ts`
- Modify: `src/index.ts`, `src/config/env.ts`

**Interfaces:**
- Consumes: the registry (Task 7).
- Produces: `startIntegrationsScheduler(): SchedulerHandle | null`, `stopIntegrationsScheduler(): void`, `interface SchedulerHandle { stop(): void }`.

`M365_SYNC_INTERVAL_SECONDS` becomes `INTEGRATIONS_SYNC_INTERVAL_SECONDS`. It is a tuning knob, **not** part of any credential group — keep it outside the `M365_*` all-or-nothing check, exactly as it is today.

- [ ] **Step 1: Create `src/integrations/scheduler.ts`**

```ts
import { config } from '../config/env.js';
import { logError } from '@wyrhta/core/lib';
import { listProviders } from './registry.js';

/**
 * Background poll loop for every registered provider's mirrors. Started at boot
 * from `main()` in `src/index.ts` and NEVER in tests — that entrypoint does not
 * run under Vitest, and this additionally guards on `VITEST`. Tests drive sync
 * deterministically via a provider's runners or `POST /api/v1/integrations/sync`.
 *
 * A tick runs every provider's calendar feeds then its task feeds, sequentially.
 * Per-feed errors are already isolated and recorded by the runner, so a tick
 * cannot crash the loop or the app. The timer is `unref`'d so it never keeps the
 * process alive on its own.
 */

export interface SchedulerHandle {
  stop(): void;
}

let handle: SchedulerHandle | null = null;

export function startIntegrationsScheduler(): SchedulerHandle | null {
  if (process.env['VITEST'] !== undefined) return null;
  if (listProviders().length === 0) return null;
  if (handle) return handle; // idempotent

  const seconds = Math.max(60, config.integrationsSyncIntervalSeconds);

  const tick = () => {
    void (async () => {
      for (const p of listProviders()) {
        // The runners never reject for per-feed failures; guard anyway so an
        // unexpected error (e.g. a token failure surfaced while enumerating
        // feeds) cannot take down the loop or a sibling provider's tick.
        try {
          await p.runCalendarSync();
        } catch (e) {
          logError(`${p.id} calendar sync tick failed`, e);
        }
        try {
          await p.runTaskSync();
        } catch (e) {
          logError(`${p.id} task sync tick failed`, e);
        }
      }
    })();
  };

  const timer = setInterval(tick, seconds * 1000);
  timer.unref?.();
  // Kick an initial sync shortly after boot (not synchronously — let the server
  // finish starting first).
  const kickoff = setTimeout(tick, 2000);
  kickoff.unref?.();

  handle = {
    stop() {
      clearInterval(timer);
      clearTimeout(kickoff);
      handle = null;
    },
  };
  return handle;
}

/** Stop the scheduler if running (idempotent). */
export function stopIntegrationsScheduler(): void {
  handle?.stop();
}
```

> The old scheduler chained `.catch().then().catch()`, which let a calendar failure skip the task sync. The sequential `await` in a `try` per surface fixes that; it is a bug fix, not a refactor, and is called out in the commit message.

- [ ] **Step 2: Rename the env var**

In `src/config/env.ts`: rename the schema key `M365_SYNC_INTERVAL_SECONDS` to `INTEGRATIONS_SYNC_INTERVAL_SECONDS` (same `z.coerce.number().int().positive().default(300)`), and `config.m365SyncIntervalSeconds` to `config.integrationsSyncIntervalSeconds`. Do **not** add it to the `m365Keys` all-or-nothing list — it is not there today and must not be.

- [ ] **Step 3: Repoint `src/index.ts`**

Replace `startM365Scheduler` / `stopM365Scheduler` imports and calls with `startIntegrationsScheduler` / `stopIntegrationsScheduler` from `'./integrations/scheduler.js'`. Delete `src/m365/scheduler.ts` and its exports from `src/m365/index.ts`.

- [ ] **Step 4: Run the suite**

```bash
npm run typecheck && npm test
```

Expected: PASS. `tests/env.test.ts` may assert on the interval key — that is a rename edit, allowed.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "refactor(integrations): one scheduler over every registered provider

M365_SYNC_INTERVAL_SECONDS becomes INTEGRATIONS_SYNC_INTERVAL_SECONDS. It stays
outside the M365_* all-or-nothing group -- it is a tuning knob, not a credential.

Also fixes a latent bug: the old tick chained .catch().then().catch(), so a
failing calendar sync skipped the task sync entirely. Each surface now has its
own guarded await, and one provider's failure cannot skip another's tick."
```

---

### Task 11: Tasks resolve their provider by mirror-row source

The write paths currently call a single global provider. With two providers connected, completing a Google-mirrored task would reach whichever registered last.

**Files:**
- Modify: `src/modules/tasks/provider.ts`, `src/modules/tasks/service.ts`, `src/modules/tasks/store.ts`, `src/modules/tasks/schema.ts`
- Create: `src/db/migrations/0025_tasks_provider_column.sql` (generated)
- Test: `tests/tasks-provider-routing.test.ts` (create)

**Interfaces:**
- Consumes: `getTaskProviderFor` (Task 7).
- Produces:
  - `TaskFeed` gains `provider: string`
  - `listAllowlistedFeeds(): Promise<TaskFeed[]>` — feed keys now built from each row's own provider
  - `todoListAllowlist` gains `provider` (default `'m365'`), unique `(provider, memberId, listId)`
  - `requireProviderFor(source: string): TaskProvider` — throws `TaskProviderError('provider_unavailable')`

- [ ] **Step 1: Add `provider` to the allowlist schema**

In `src/modules/tasks/schema.ts`, add to `todoListAllowlist`:

```ts
  // Which provider this list belongs to. Defaults to 'm365' so existing rows
  // backfill correctly; a member may allowlist lists from both providers.
  provider: text('provider').notNull().default('m365'),
```

and change the unique constraint:

```ts
  unique('todo_allowlist_provider_member_list_unique').on(t.provider, t.memberId, t.listId),
```

- [ ] **Step 2: Thread `provider` through `TaskFeed` and the store**

In `src/modules/tasks/store.ts`:

```ts
/** A feed = one allowlisted task list of one member, at one provider. */
export interface TaskFeed {
  provider: string;
  feedKey: string;
  memberId: string;
  listId: string;
  listName: string | null;
}
```

`listAllowlistedFeeds` builds each key from the row's own provider, removing the Task 8 hardcode:

```ts
/** All allowlisted lists across every member and provider, as sync feeds. */
export async function listAllowlistedFeeds(provider?: string): Promise<TaskFeed[]> {
  const rows = provider
    ? await db.select().from(todoListAllowlist).where(eq(todoListAllowlist.provider, provider))
    : await db.select().from(todoListAllowlist);
  return rows.map((r) => ({
    provider: r.provider,
    feedKey: feedKeys.todoMember(r.provider, r.memberId, r.listId),
    memberId: r.memberId,
    listId: r.listId,
    listName: r.listName,
  }));
}
```

`setAllowlist` and `getAllowlist` take a `provider` argument and scope their queries with `eq(todoListAllowlist.provider, provider)`; the `taskMirror` cleanup for a de-selected list uses `feedKeys.todoMember(provider, memberId, row.listId)`.

`src/m365/task-sync.ts` calls `listAllowlistedFeeds('m365')`.

- [ ] **Step 3: Replace the provider seam**

Replace `src/modules/tasks/provider.ts` entirely:

```ts
import type { TaskProvider } from './providers/types.js';
import { TaskProviderError } from './providers/types.js';
import { getTaskProviderFor } from '../../integrations/registry.js';

/**
 * Provider resolution for the tasks write paths (completion, creation, list
 * discovery).
 *
 * This used to be a single global slot holding "the" provider, installed by the
 * M365 module. That could only ever be correct with one provider configured:
 * completing a Google-mirrored task would have been written to whichever
 * provider registered last. Resolution is now BY THE MIRROR ROW'S `source`, via
 * the integrations registry.
 *
 * When no provider is registered for a source, write paths get a classified
 * `provider_unavailable` error and reads still work off the mirror.
 */
export function getProviderFor(source: string): TaskProvider | null {
  return getTaskProviderFor(source);
}

export function requireProviderFor(source: string): TaskProvider {
  const p = getTaskProviderFor(source);
  if (!p) {
    throw new TaskProviderError(
      'provider_unavailable',
      `No task provider is available for source "${source}"`,
    );
  }
  return p;
}
```

- [ ] **Step 4: Update `src/modules/tasks/service.ts`**

Every write path resolves from the row it is acting on. **Keep each function's existing exported signature** — only the provider lookup inside changes, so no caller (Weorc included) has to move.

Replace the import of `requireProvider` with `requireProviderFor`, then:

```ts
/**
 * Complete / uncomplete one mirrored task. The provider is resolved from the
 * ROW's source, not from a global: with two providers connected, a
 * Google-mirrored task must be written back to Google.
 */
export async function completeTask(
  taskId: string, completed: boolean,
): Promise<TaskMirrorRow | null> {
  const row = await store.getTaskById(taskId);
  if (!row) return null;
  const provider = requireProviderFor(row.source);
  await provider.setCompleted(row.feedKey, row.externalId, completed); // throws TaskProviderError
  return store.setTaskCompletedLocal(taskId, completed);
}

/**
 * Complete / uncomplete a projected task by its stable provider key. The mirror
 * row is loaded FIRST here (it was loaded after the provider call before) —
 * without it there is no `source`, so there is no provider to call. A missing
 * row is reported as `provider_unavailable` rather than guessed at.
 */
export async function completeProjectedTask(
  feedKey: string,
  externalId: string,
  completed: boolean,
): Promise<void> {
  const row = await store.getTaskByFeedRef(feedKey, externalId);
  if (!row) {
    throw new TaskProviderError(
      'provider_unavailable',
      'No mirrored task for that feed reference — cannot resolve a provider',
    );
  }
  const provider = requireProviderFor(row.source);
  await provider.setCompleted(feedKey, externalId, completed);
  await store.setTaskCompletedLocal(row.id, completed);
}

/**
 * Discover the lists a member can sync, across EVERY registered provider. Each
 * entry is tagged with its provider so the picker can group them and so
 * `setAllowlist` knows which provider a chosen list belongs to.
 */
export interface AvailableListView {
  provider: string;   // NEW — which provider this list belongs to
  id: string;
  name: string;
  enabled: boolean;   // already allowlisted by this member
}

export async function listAvailableLists(memberId: string): Promise<AvailableListView[]> {
  await assertNotMaintenanceAdmin(memberId);
  const out: AvailableListView[] = [];
  for (const p of listProviders()) {
    if (!p.tasks) continue;
    // One provider being unreachable must not hide another's lists: a member
    // connected to Google but not to M365 is a normal state, not an error.
    try {
      const lists = await p.tasks.listAvailableLists(memberId);
      const enabled = new Set((await store.getAllowlist(memberId, p.id)).map((a) => a.listId));
      for (const l of lists) {
        out.push({ provider: p.id, id: l.id, name: l.name, enabled: enabled.has(l.id) });
      }
    } catch (e) {
      if (p.classifyError(e) === 'no_connection') continue; // not connected: normal
      throw e;
    }
  }
  return out;
}
```

> **Verified 2026-08-30, during execution.** An earlier version of this block dropped the `enabled` flag. The existing `AvailableListView` is `{ id, name, enabled }` and `enabled` is what the list-picker UI renders as "this list syncs" — losing it would silently break the picker. It also dropped the `assertNotMaintenanceAdmin(memberId)` guard the real function opens with. Both are preserved above; the only additions are the `provider` field and the loop over providers.

Add `import { listProviders } from '../../integrations/registry.js';` and keep `TaskProviderError` imported from `./providers/types.js`.

> **Behaviour note:** `completeProjectedTask` previously called the provider *before* looking for the mirror row, so it could complete upstream even with no local row. It now requires the row, because the row is what names the provider. Weorc's reconcile pass treats a missing `task_mirror` row as "leave it alone" (AGENTS.md), so this is consistent with how the rest of the system already reads that state.

`resolveSharedFeed` and `getSharedListName` are left alone in this task — Task 12 replaces them wholesale.

- [ ] **Step 5: Write the routing test**

Create `tests/tasks-provider-routing.test.ts`.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { taskMirror } from '../src/modules/tasks/schema.js';
import { clearProviders, registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';
import * as service from '../src/modules/tasks/service.js';
import { seedTestHousehold } from './helpers.js';

function recordingProvider(id: string, calls: string[]) {
  return {
    id,
    store: new IntegrationStore(id),
    classifyError: () => 'error',
    fullResyncIntervalMs: 1000,
    authorizeUrl: () => `https://${id}.test`,
    completeConnect: async () => ({ accountLabel: `a@${id}`, refreshToken: 'r', scopes: '' }),
    calendar: null,
    tasks: {
      source: id,
      listAvailableLists: async () => [],
      pullChanges: async () => ({ upserts: [], deletions: [], nextToken: null, fullResync: false }),
      setCompleted: async () => { calls.push(id); },
      createTask: async () => { throw new Error('not used'); },
    },
    runCalendarSync: async () => [],
    runTaskSync: async () => [],
  };
}

describe('task write-back routing', () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    clearProviders();
    registerProvider(recordingProvider('m365', calls));
    registerProvider(recordingProvider('google', calls));
  });

  it('routes a completion to the provider named by the row source', async () => {
    const { adult } = await seedTestHousehold();
    const [row] = await db.insert(taskMirror).values({
      source: 'google',
      feedKey: 'google:todo:member:x:l1',
      externalId: 'g1',
      memberId: adult.user.id,
      listId: 'l1',
      title: 'Google task',
      status: 'open',
    }).returning();

    await service.completeTask(row!.id, true);
    expect(calls).toEqual(['google']);
  });

  it('routes an m365 row to m365 even with google registered later', async () => {
    const { adult } = await seedTestHousehold();
    const [row] = await db.insert(taskMirror).values({
      source: 'm365',
      feedKey: 'm365:todo:member:x:l1',
      externalId: 'm1',
      memberId: adult.user.id,
      listId: 'l1',
      title: 'Graph task',
      status: 'open',
    }).returning();

    await service.completeTask(row!.id, true);
    expect(calls).toEqual(['m365']);
  });

  it('reports provider_unavailable for an unregistered source', async () => {
    const { adult } = await seedTestHousehold();
    const [row] = await db.insert(taskMirror).values({
      source: 'caldav',
      feedKey: 'caldav:todo:member:x:l1',
      externalId: 'c1',
      memberId: adult.user.id,
      listId: 'l1',
      title: 'Orphan task',
      status: 'open',
    }).returning();

    await expect(service.completeTask(row!.id, true))
      .rejects.toMatchObject({ reason: 'provider_unavailable' });
  });
});
```

> **Verified 2026-08-30, during execution.** An earlier version of this task invented a function `setTaskCompleted(taskId, completed, actingMemberId)` with an `assertNotMaintenanceAdmin` guard. **No such function exists.** The real one is:
>
> ```ts
> export async function completeTask(taskId: string, completed: boolean): Promise<TaskMirrorRow | null>
> ```
>
> — two parameters, no acting member, and no maintenance-admin guard (that guard is on `createTask`, `listAvailableLists` and `setAllowlist`, not on completion). Its callers are `src/modules/tasks/routes.ts:112` and two tests in `tests/m365-tasks-sync.test.ts`. **Keep the existing name and signature**; only the provider lookup inside it changes. Renaming it would break all three callers for no reason.

- [ ] **Step 6: Generate the migration and run everything**

```bash
npm run db:generate -- --name tasks_provider_column
npm run typecheck && npm test
```

Expected: PASS. `tests/weorc-task-seam.test.ts` installs a fake task provider through the old seam — repoint it to `registerProvider`. That is a seam-shape edit, not an assertion change.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "refactor(tasks): resolve the task provider by mirror-row source

The write paths called a single global provider slot, so with two providers
connected a Google-mirrored task's completion would have been written to
whichever provider registered last. Resolution now goes through the registry,
keyed by the row's source column.

todo_list_allowlist gains a provider column so a member can allowlist lists from
both providers, and feed keys are built from each row's own provider instead of
a hardcoded 'm365'."
```

---

### Task 12: The household task list becomes a flag

`resolveSharedFeed()` matches the shared list **by display name** from `M365_SHARED_TODO_LIST`. A member renaming the list in Outlook silently breaks household task creation, which silently breaks Weorc's projection. With two providers the arbitrary `entries[0]` tie-break could also route a task to either provider.

**Files:**
- Modify: `src/modules/tasks/schema.ts`, `src/modules/tasks/store.ts`, `src/modules/tasks/service.ts`, `src/modules/tasks/routes.ts`, `src/modules/tasks/provider.ts`, `src/config/env.ts`, `src/m365/index.ts`
- Create: `src/db/migrations/0026_household_list_flag.sql` (generated + a backfill statement)
- Test: `tests/tasks-household-list.test.ts` (create)

**Interfaces:**
- Consumes: `TaskFeed` with `provider` (Task 11).
- Produces:
  - `todoListAllowlist.isHousehold: boolean` (default `false`), partial unique index — at most one `true` household-wide
  - store: `getHouseholdFeed(): Promise<TaskFeed | null>`
  - store: `setHouseholdList(memberId: string, provider: string, listId: string): Promise<void>` — clears any previous flag in the same transaction
  - service: `getHouseholdList(): Promise<{ provider, memberId, listId, listName } | null>`
  - service: `setHouseholdList(memberId, provider, listId): Promise<void>` — validates the list is allowlisted, then delegates to the store
  - `PUT /api/v1/tasks/household-list` (admin **or** adult), body `{ provider: string, listId: string }`
  - **Removed:** `M365_SHARED_TODO_LIST`, `findAllowlistByName`, `getSharedListName`

- [ ] **Step 1: Write the failing test**

Create `tests/tasks-household-list.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { db } from '../src/db/index.js';
import { todoListAllowlist } from '../src/modules/tasks/schema.js';
import { getHouseholdFeed, setHouseholdList } from '../src/modules/tasks/store.js';
import { seedTestHousehold } from './helpers.js';

async function allowlist(memberId: string, provider: string, listId: string, name: string) {
  await db.insert(todoListAllowlist).values({ memberId, provider, listId, listName: name });
}

describe('household task list designation', () => {
  it('returns null when no list is designated', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');
    expect(await getHouseholdFeed()).toBeNull();
  });

  it('resolves the designated feed regardless of its display name', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Anything At All');
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    const feed = await getHouseholdFeed();
    expect(feed).toMatchObject({
      provider: 'm365',
      memberId: adult.user.id,
      listId: 'l1',
      feedKey: `m365:todo:member:${adult.user.id}:l1`,
    });
  });

  it('survives a rename at the source', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    // The member renames the list in Outlook; the next sync refreshes the cache.
    await db.update(todoListAllowlist).set({ listName: 'Haushalt' });

    expect(await getHouseholdFeed()).not.toBeNull();
  });

  it('allows at most one designated list household-wide', async () => {
    const { adult, admin } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'One');
    await allowlist(admin.user.id, 'google', 'l2', 'Two');

    await setHouseholdList(adult.user.id, 'm365', 'l1');
    await setHouseholdList(admin.user.id, 'google', 'l2');

    const flagged = await db.select().from(todoListAllowlist);
    expect(flagged.filter((r) => r.isHousehold)).toHaveLength(1);
    expect((await getHouseholdFeed())!.listId).toBe('l2');
  });

  it('clears the designation when the list leaves the allowlist', async () => {
    const { adult } = await seedTestHousehold();
    await allowlist(adult.user.id, 'm365', 'l1', 'Household');
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    await db.delete(todoListAllowlist);
    expect(await getHouseholdFeed()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/tasks-household-list.test.ts
```

Expected: FAIL — `getHouseholdFeed` and `setHouseholdList` do not exist.

- [ ] **Step 3: Add the column and the partial unique index**

In `src/modules/tasks/schema.ts`, add to `todoListAllowlist`:

```ts
  // Marks THE household's shared task list — the one Heorth creates tasks into
  // (including Weorc's projected maintenance work). At most one row household-wide
  // carries this, enforced by a partial unique index below. Replaces resolution by
  // display name, which broke silently whenever a member renamed the list.
  isHousehold: boolean('is_household').notNull().default(false),
```

adding `boolean` to the `drizzle-orm/pg-core` import, and in the table's index array:

```ts
  uniqueIndex('todo_allowlist_single_household')
    .on(t.isHousehold).where(sql`${t.isHousehold}`),
```

adding `uniqueIndex` to the same import.

- [ ] **Step 4: Add the store functions**

In `src/modules/tasks/store.ts`:

```ts
/**
 * The designated household task feed, or null when none is designated.
 *
 * Replaces resolution by display name (`findAllowlistByName`), which matched
 * `M365_SHARED_TODO_LIST` against every member's allowlist and tie-broke with
 * "prefer the acting member, else the first row". That broke silently when a
 * member renamed the list at the source, and with two providers the tie-break
 * could route a task to either one.
 */
export async function getHouseholdFeed(): Promise<TaskFeed | null> {
  const [row] = await db.select().from(todoListAllowlist)
    .where(eq(todoListAllowlist.isHousehold, true)).limit(1);
  if (!row) return null;
  return {
    provider: row.provider,
    feedKey: feedKeys.todoMember(row.provider, row.memberId, row.listId),
    memberId: row.memberId,
    listId: row.listId,
    listName: row.listName,
  };
}

/**
 * Designate one allowlisted list as the household list. Clearing every other
 * flag and setting the new one happen in ONE transaction — the partial unique
 * index would otherwise reject the update, and a non-transactional clear-then-set
 * could leave the household with no list at all if the second statement failed.
 */
export async function setHouseholdList(
  memberId: string, provider: string, listId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(todoListAllowlist)
      .set({ isHousehold: false, updatedAt: new Date() })
      .where(eq(todoListAllowlist.isHousehold, true));
    await tx.update(todoListAllowlist)
      .set({ isHousehold: true, updatedAt: new Date() })
      .where(and(
        eq(todoListAllowlist.memberId, memberId),
        eq(todoListAllowlist.provider, provider),
        eq(todoListAllowlist.listId, listId),
      ));
  });
}
```

Delete `findAllowlistByName`.

- [ ] **Step 5: Rewrite `resolveSharedFeed` in `src/modules/tasks/service.ts`**

```ts
/** Resolve the designated household task feed, or fail with a classified reason. */
async function resolveHouseholdFeed(): Promise<TaskFeed> {
  const feed = await store.getHouseholdFeed();
  if (!feed) {
    throw new TaskProviderError(
      'shared_list_unavailable',
      'No household task list is designated — an adult must pick one in the task list settings',
    );
  }
  return feed;
}
```

`createHouseholdTask` uses it and resolves its provider from `feed.provider`:

```ts
export async function createHouseholdTask(
  input: CreateTaskInput,
  _preferMemberId: string | null,
): Promise<TaskMirrorRow> {
  const feed = await resolveHouseholdFeed();
  const provider = requireProviderFor(feed.provider);
  const created = await provider.createTask(feed.feedKey, input);
  return store.upsertMirroredTask(provider.source, feed, created);
}
```

`preferMemberId` is now unused — the designated list is the same for everyone, which is the point. Keep the parameter so Weorc's call site is untouched, and say so in a comment.

The routes layer talks only to the service (never to the store directly), so add both designation functions there too:

```ts
/** The designated household list, as the picker UI shows it. Null when none. */
export async function getHouseholdList(): Promise<{
  provider: string; memberId: string; listId: string; listName: string | null;
} | null> {
  const feed = await store.getHouseholdFeed();
  if (!feed) return null;
  return {
    provider: feed.provider,
    memberId: feed.memberId,
    listId: feed.listId,
    listName: feed.listName,
  };
}

/**
 * Designate one allowlisted list as the household list. The list must already be
 * allowlisted by that member — designating an unsynced list would produce a feed
 * nothing ever pulls, so this fails loudly instead.
 */
export async function setHouseholdList(
  memberId: string, provider: string, listId: string,
): Promise<void> {
  const owned = await store.getAllowlist(memberId, provider);
  if (!owned.some((r) => r.listId === listId)) {
    throw new TaskProviderError(
      'unknown_list',
      'That list is not in the member\'s allowlist — allowlist it before designating it',
    );
  }
  await store.setHouseholdList(memberId, provider, listId);
}
```

`unknown_list` is already an accepted reason token in `routes.ts`'s `writeError` classifier, so this maps to the existing status without touching it.

- [ ] **Step 6: Add the designation route**

In `src/modules/tasks/routes.ts`, with the other literal routes (before `/:id/…`):

```ts
/** Designate the household task list (admin or adult — it is a household-wide setting). */
tasksRouter.put('/household-list', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (auth.role !== 'admin' && auth.role !== 'adult') {
    return err(c, 'FORBIDDEN', 'Only an adult can set the household task list', 403);
  }
  const body = setHouseholdListSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    await service.setHouseholdList(auth.userId, body.data.provider, body.data.listId);
    return ok(c, await service.getHouseholdList());
  } catch (e) {
    return writeError(c, e);
  }
});
```

with a Zod schema alongside the others:

```ts
const setHouseholdListSchema = z.object({
  provider: z.string().min(1),
  listId: z.string().min(1),
});
```

- [ ] **Step 7: Remove `M365_SHARED_TODO_LIST`**

In `src/config/env.ts`: drop the key from the schema, from the `m365Keys` all-or-nothing array (**it becomes five entries**), and from the `config.m365` object. Drop `sharedTodoList` from the `M365Config` type by consequence.

In `src/m365/index.ts`, the `registerProvider` call no longer passes a shared-list name.

In `src/modules/tasks/provider.ts`, delete `getSharedListName` and `sharedListName` if any remnant survives Task 11.

In `tests/setup.ts`, remove `'M365_SHARED_TODO_LIST'` from the blanking loop.

- [ ] **Step 8: Generate the migration and add the backfill**

```bash
npm run db:generate -- --name household_list_flag
```

Append to the generated `.sql` (leave `meta/` alone):

```sql
-- Backfill: the pre-flag deployment designated its household list by NAME via
-- M365_SHARED_TODO_LIST. Flag the allowlist row whose cached list_name matches.
-- Replace 'Household' with the deployment's actual configured value before
-- running this against a real database.
--
-- If nothing matches (the list was renamed, or nobody allowlisted it) no row is
-- flagged and createHouseholdTask reports shared_list_unavailable -- the same
-- error as before in that situation, but it also disables Weorc projection, so
-- the boot warning added alongside this migration makes that state visible.
UPDATE todo_list_allowlist
   SET is_household = true
 WHERE id = (
   SELECT id FROM todo_list_allowlist WHERE list_name = 'Household' ORDER BY created_at LIMIT 1
 );
```

> **Operator step, not an automatic one.** Confirm the deployment's real `M365_SHARED_TODO_LIST` value from `deploy/.env` and substitute it before applying this to the dev or prod database. Do not guess.

- [ ] **Step 9: Run the tests**

```bash
npx vitest run tests/tasks-household-list.test.ts && npm run typecheck && npm test
```

Expected: PASS. Suites that set `M365_SHARED_TODO_LIST` or assert `shared_list_unavailable` need repointing to `setHouseholdList` — a seam-shape edit.

- [ ] **Step 10: Commit**

```bash
git add -A src tests
git commit -m "feat(tasks): designate the household list by flag instead of by name

resolveSharedFeed matched M365_SHARED_TODO_LIST against every member's
allowlist, so renaming the list in Outlook silently broke household task
creation and, through it, Weorc's projected maintenance tasks. With two
providers the entries[0] tie-break could also route a task to either provider.

todo_list_allowlist.is_household designates it, with a partial unique index
allowing at most one household-wide. Removes M365_SHARED_TODO_LIST (the group
is now five vars), findAllowlistByName, and getSharedListName."
```

---

### Task 13: Make "no household list" visible

The backfill can legitimately flag nothing. That state disables Weorc's projection, and per AGENTS.md an absent provider writes no `projectionError` — so without this task the household silently stops getting maintenance tasks.

**Files:**
- Modify: `src/index.ts`, `src/integrations/routes.ts`
- Test: `tests/integrations-routes.test.ts` (append)

**Interfaces:**
- Consumes: `getHouseholdFeed` (Task 12), `listProviders` (Task 7).
- Produces: `GET /api/v1/integrations/status` response gains `householdListDesignated: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `tests/integrations-routes.test.ts`.

```ts
it('reports whether a household task list is designated', async () => {
  const { adult } = await seedTestHousehold();
  const before = await integrationsApp().request('/api/v1/integrations/status', {
    headers: authHeaders(adult.jwt),
  });
  expect((await before.json()).data.householdListDesignated).toBe(false);

  await db.insert(todoListAllowlist).values({
    memberId: adult.user.id, provider: 'm365', listId: 'l1', listName: 'Household',
  });
  await setHouseholdList(adult.user.id, 'm365', 'l1');

  const after = await integrationsApp().request('/api/v1/integrations/status', {
    headers: authHeaders(adult.jwt),
  });
  expect((await after.json()).data.householdListDesignated).toBe(true);
});
```

Add the imports it needs: `db`, `todoListAllowlist`, `setHouseholdList`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/integrations-routes.test.ts -t "household task list is designated"
```

Expected: FAIL — `householdListDesignated` is `undefined`.

- [ ] **Step 3: Add the field to `/status`**

In `src/integrations/routes.ts`, import `getHouseholdFeed` from `'../modules/tasks/store.js'` and add to **both** response branches:

```ts
const householdListDesignated = (await getHouseholdFeed()) !== null;
```

- [ ] **Step 4: Add the boot warning**

In `src/index.ts`'s `main()`, after modules register and before the scheduler starts:

```ts
// A connected provider with no designated household task list is a silent
// failure: createHouseholdTask reports shared_list_unavailable, which stops
// Weorc's projected maintenance work without producing a projectionError (an
// absent provider is a NORMAL state and deliberately writes none). Say it out
// loud at boot instead.
if (listProviders().length > 0 && (await getHouseholdFeed()) === null) {
  console.warn(
    '[integrations] No household task list is designated. Household task creation ' +
    'and Weorc projection are disabled until an adult picks one ' +
    '(PUT /api/v1/tasks/household-list).',
  );
}
```

- [ ] **Step 5: Run the tests**

```bash
npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "feat(integrations): surface a missing household task list

With no designated list, household task creation reports
shared_list_unavailable and Weorc projection stops -- without a projectionError,
because an absent provider is a normal state that deliberately writes none.

A boot warning and a householdListDesignated field on the status surface make
that state visible instead of silent. The Task 12 backfill can legitimately flag
nothing, so this is the state a real deployment can land in."
```

---

### Task 14: Repoint the web client

**Files:**
- Modify: `web/src/api/m365.ts`, `web/src/hooks/use-m365.ts`, `web/src/lib/providers.ts`, `web/src/lib/types.ts`, `web/src/lib/hearth.ts`, `web/src/lib/constants.ts` and their tests
- Test: the existing web suites

**Interfaces:**
- Consumes: the Task 9 route surface.
- Produces: `M365Connection.accountUpn` → `accountLabel`; API paths under `/integrations`.

- [ ] **Step 1: Find every affected file**

```bash
cd web && grep -rn "api/v1/m365\|/m365/\|accountUpn" src
```

- [ ] **Step 2: Repoint the API module**

In `web/src/api/m365.ts`:

- `getM365Status` → `apiGet('/integrations/status')`
- `getM365ConnectUrl` → `apiGet('/integrations/m365/connect-url')`
- `disconnectM365` → `apiDelete('/integrations/m365/connection')`
- `triggerM365Sync` → `apiPost('/integrations/sync', {})`
- `M365Connection.accountUpn: string` → `accountLabel: string`
- `M365Status` gains `householdListDesignated: boolean` and `providers: string[]`

The status endpoint is no longer provider-specific. Rather than move the file now, leave it as the M365 adapter and note that Phase 2 hoists `getStatus` into a shared `web/src/api/integrations.ts` — splitting it here would be churn with no consumer yet.

- [ ] **Step 3: Follow the compiler**

`web/src/lib/providers.ts` maps `accountUpn` onto the provider-neutral `ProviderConnection.accountLabel` — that mapping becomes an identity now. Update `use-m365.ts` accordingly.

- [ ] **Step 4: Run the web suite**

```bash
cd web && npm test
```

Expected: PASS, with field-rename and path edits in the test fixtures.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "refactor(web): repoint the client at /api/v1/integrations

Paths move under /integrations and accountUpn becomes accountLabel, matching
the provider-neutral shape web/src/lib/providers.ts already used internally.

The status endpoint is no longer provider-specific; hoisting it into a shared
api/integrations.ts waits for the Google adapter, which is the first consumer
that would justify the split."
```

---

### Task 15: Documentation

**Files:**
- Modify: `AGENTS.md`, `README.md`

- [ ] **Step 1: Rewrite the AGENTS.md integration rules**

Retitle "## Microsoft 365 rules (`src/m365/`)" to "## Integration provider rules (`src/integrations/`, `src/m365/`)" and update these rules:

- containment now names both `src/m365/` (Graph only) and `src/google/` (Google only), with the generic machinery in `src/integrations/`
- the provider-contracts rule stays, but `setTaskProvider` is replaced: "task writes resolve through the integrations registry by the mirror row's `source` column (`getTaskProviderFor`), so a Google-mirrored task's completion reaches Google"
- feed keys are `src/integrations/feed-keys.ts` and **carry a provider segment**
- add: "**Never change the HKDF salt or info strings in `src/integrations/crypto.ts`.** They are inputs to the key; changing either makes every stored refresh token undecryptable. They still say `m365` for exactly that reason."
- add: "**The household task list is designated by `todo_list_allowlist.is_household`, not by name.** There is no `M365_SHARED_TODO_LIST`."
- the `M365_*` group is now **five** vars; `GOOGLE_*` is a sibling group (phase 2)
- `INTEGRATIONS_SYNC_INTERVAL_SECONDS` replaces `M365_SYNC_INTERVAL_SECONDS` and is outside both credential groups
- **Revise the Weorc rule.** It currently reads "Weorc stores `(taskFeedKey, taskExternalId)`, never `task_mirror.id` — a full resync deletes and re-inserts a feed's rows, so the uuid does not survive a 410 recovery." The reason is now wrong: reconcile preserves ids. The rule stays; the justification becomes: "a mirror row is still deleted when a list leaves the allowlist or a task disappears at the source, and `(feedKey, externalId)` is the table's real provider key."
- routes: `/api/v1/m365/*` no longer exists

- [ ] **Step 2: Update README.md**

- the env table: drop `M365_SHARED_TODO_LIST`, rename the interval var
- the route surface: `/api/v1/integrations/*`
- a short "Designating the household task list" section pointing at `PUT /api/v1/tasks/household-list`
- note the Entra redirect URI is `<base>/api/v1/integrations/m365/callback`

- [ ] **Step 3: Verify no stale references**

```bash
grep -rn "M365_SHARED_TODO_LIST\|M365_SYNC_INTERVAL_SECONDS\|api/v1/m365\|setTaskProvider" README.md AGENTS.md src tests web/src
```

Expected: no hits.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: rewrite the integration rules for the provider-neutral layer

The M365 section becomes provider-neutral: containment covers src/m365/ and
src/google/, task writes resolve by mirror-row source, feed keys carry a
provider segment, and the household list is a flag rather than an env var.

Also corrects the Weorc rule's justification: it stores (feedKey, externalId)
rather than task_mirror.id, but no longer because a resync churns the uuid --
reconcile preserves it. The rule holds for a different reason, now stated."
```

---

## Verification of the whole plan

After Task 15:

```bash
npm run typecheck && npm test && cd web && npm test
```

Then confirm the spec's Phase 1 promise held. The refactor tasks (3–11) should show, across their combined diff, **only** these categories of test edit:

1. import paths
2. route paths
3. feed-key fixtures (adding the provider prefix)
4. the two field renames (`accountUpn` → `accountLabel`, `deltaToken` → `syncToken`)
5. seam-shape edits where a fake is installed (`setTaskProvider` → `registerProvider`)

Tasks 1, 2, 12 and 13 are deliberate behaviour changes and are exempt — their assertion changes are the point.

If a refactor task required a behaviour assertion change that is not in that list, the refactor leaked. Report it rather than absorbing it.

## Out of scope for this plan

The spec also calls for a short ADR recording provider-scoped connections, the reconcile pull mode, and designation-by-flag. **That belongs in the meta repo** (`Wyrhta/docs/decisions/`), not here — one change, one repo, one commit. It is not a task in this plan; write it from a meta-repo session once this lands.

Likewise `deploy/.env` (`GOOGLE_*` for the dev stack) is meta-repo work and belongs to Phase 2.

## Follow-on

Phase 2 (the Google provider) gets its own plan, written from the same spec once this one is merged. It depends on: the registry (Task 7), provider-prefixed feed keys (Task 5), the injected error classifier (Task 6), provider-scoped connections (Tasks 3–4), and `feedKeys.calendarList` (Task 5, added unused for exactly that purpose).
