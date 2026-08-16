# Feoh Occurrences, Inventory & Lifecycle Costs, Cash Ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the spec `docs/superpowers/specs/2026-08-16-feoh-inventory-lifecycle-design.md`: recurring-bill occurrences, a standalone inventory module with feoh-side TCO cost links, a per-account cash ledger with Kassensturz reconciliation, and removal of the `FEOH_ENABLED` gate.

**Architecture:** A new always-on `inventory` module owns items and their lifecycle fields; all finance references to items live feoh-side (`feoh_item_costs`, `recurring_bills.inventory_item_id`). Occurrences are projected on read from a bill's cadence and persisted only when touched (`recurring_occurrences`). The ledger/reconcile features are queries + one convenience booking over the existing double-entry tables.

**Tech Stack:** Node 22 + TypeScript, Hono, Drizzle ORM, PostgreSQL 18, Zod, Vitest (backend hits real Postgres); React + TanStack Query + i18next (web).

## Global Constraints

- Responses use `ok`/`err` from `@wyrhta/core/http`; auth via `requireAuth` / `requireRole` from `src/wiring.ts`.
- Feoh mutations keep the `canWrite` gate (role admin/adult + maintenance-admin quarantine). Inventory writes use `requireRole('admin', 'adult')` only (no quarantine — not finance).
- New tables register in BOTH `src/db/schema/drizzle-schema.ts` (no `.js` extensions) and `src/db/schema/index.ts` (`.js` extensions).
- Migrations via `npm run db:generate -- --name <name>` — never hand-edit snapshots. Hand-written `UPDATE` statements may be appended to the generated `.sql` file.
- Dependency direction: feoh → inventory only. Inventory never imports feoh modules; its ONE sanctioned touchpoint is the raw SQL `SELECT 1 FROM feoh_item_costs WHERE item_id = $1 AND kind = 'disposal'`.
- All money arithmetic in integer cents (`Math.round(Number(x) * 100)`); never float equality on euros.
- Cost size of a transaction = Σ debit over its ENVELOPE postings (matches `getMonthSummary` spending).
- All date math on calendar-date strings (`YYYY-MM-DD`), no timestamps/DST.
- Tests: real Postgres, `DATABASE_URL` DB name must end in `_test`; run with `npm test` (backend) / `cd web && npm test` (web). Backend suite currently 274 tests green — keep it green.
- English for all code/comments/commit messages; new UI strings in BOTH `web/src/i18n/locales/en.json` and `de.json`. No AI co-author trailers.

---

## Phase 0 — Feoh gate removal

### Task 1: Remove the FEOH_ENABLED gate (backend)

**Files:**
- Modify: `src/config/env.ts` (schema line 48, config line 124)
- Modify: `src/modules/feoh/index.ts`
- Modify: `src/routes/features.ts:14`
- Modify: `src/modules/index.ts:20` (comment only)
- Delete: `tests/feoh-gating.test.ts`
- Modify: `tests/feoh-bills.test.ts`, `tests/feoh-accounts.test.ts`, `tests/feoh-transactions.test.ts`, `tests/feoh-summary.test.ts`, `tests/integration-smoke.test.ts`, `tests/mcp-server.test.ts`, `tests/features.test.ts`

**Interfaces:**
- Consumes: existing `config` object, `featuresRouter`.
- Produces: `GET /api/v1/features` returns `finance: true` always; feoh routes/tools registered unconditionally. Later tasks assume no `FEOH_ENABLED` handling anywhere.

- [ ] **Step 1: Update `tests/features.test.ts` to expect `finance: true`**

Open the file; it has a test named around "reports finance disabled when FEOH_ENABLED is not set". Replace that expectation so the features payload asserts `finance: true` (keep the `kithledger` assertion untouched). Example shape:

```ts
it('reports finance always enabled', async () => {
  const { adult } = await seedTestHousehold();
  const res = await app.request('/api/v1/features', { headers: authHeaders(adult.jwt) });
  const body = await res.json() as { data: { finance: boolean } };
  expect(body.data.finance).toBe(true);
});
```

(Adapt to the file's existing app/bootstrap idiom — do not change how it builds `app`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- features` — expected: FAIL (`finance` is `false` because `FEOH_ENABLED` is unset).

- [ ] **Step 3: Remove the gate from source**

1. `src/config/env.ts`: delete the `FEOH_ENABLED: emptyToUndefined(z.enum(['true', 'false']))` schema line and the `feohEnabled: parsed.data.FEOH_ENABLED === 'true'` config line.
2. `src/modules/feoh/index.ts`: delete `if (!config.feohEnabled) return;` and the now-unused `config` import; replace the doc comment:

```ts
import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { feohRouter } from './routes.js';
import { feohTools } from './mcp.js';

/** Finance module (ADR 0007). Always on since the FEOH_ENABLED gate was
 *  removed (2026-08-16 spec) — registers routes and MCP tools unconditionally. */
export const feohModule: HeorthModule = {
  name: 'feoh',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/feoh', feohRouter);
    mcp.add(...feohTools);
  },
};
```

3. `src/routes/features.ts`: `finance: config.feohEnabled,` → `finance: true, // feoh is always on (gate removed 2026-08-16)`. If `config` becomes unused in that file, drop the import (check — `kithledger` still uses it, so it stays).
4. `src/modules/index.ts`: update the feoh comment to `// Finance (ADR 0007) is always on — see src/modules/feoh.`

- [ ] **Step 4: Delete the gating test and strip env setup from the remaining tests**

1. Delete `tests/feoh-gating.test.ts`.
2. In `tests/feoh-bills.test.ts`, `tests/feoh-accounts.test.ts`, `tests/feoh-transactions.test.ts`, `tests/integration-smoke.test.ts`: remove `process.env['FEOH_ENABLED'] = 'true';`, the `vi.resetModules()` line AND its explanatory comment block, and the `afterAll(() => { delete process.env['FEOH_ENABLED']; });` cleanup. Convert the dynamic `await import(...)` of `src/app.js` / `src/modules/index.js` back to static imports at the top of the file (the reset dance existed only for the gate). Drop the now-unused `vi` import if nothing else uses it.
3. `tests/feoh-summary.test.ts`: remove its `FEOH_ENABLED` set/cleanup lines (it tests the service directly; the env lines are vestigial).
4. `tests/mcp-server.test.ts`: the comment at line 13 says feoh tools are absent because the gate is off — feoh tools are now always registered. Update that test's expected tool list to include the `feoh.*` tools (and later-phase tasks will extend it again).

- [ ] **Step 5: Run the backend suite**

Run: `npm run typecheck && npm test` — expected: all green, no references to `FEOH_ENABLED` remain (`grep -r FEOH_ENABLED src tests` returns nothing).

- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "feat(feoh): remove FEOH_ENABLED gate - finance is always on"
```

### Task 2: Remove the finance gate (web)

**Files:**
- Delete: `web/src/hooks/use-finance-enabled.ts`
- Modify: `web/src/components/layout/sidebar.tsx` (drop `filterNavItems` finance gating)
- Modify: `web/src/components/layout/mobile-nav.tsx` (same)
- Modify: `web/src/pages/feoh.tsx` (drop the unavailable-card branch)
- Modify: `web/src/api/features.ts` (keep `finance: boolean` in the type — the API still sends it)
- Modify/Delete tests: `web/src/pages/feoh.test.tsx`, `web/src/components/layout/mobile-nav.test.tsx` (remove the "hides when disabled" cases; keep/adjust the "shows" cases)

**Interfaces:**
- Consumes: Task 1's always-true `finance` flag.
- Produces: Finance nav item always visible; `web/src/pages/feoh.tsx` renders the finance UI unconditionally. Task 15 adds a sibling nav item next to it.

- [ ] **Step 1: Update the web tests first**

In `web/src/pages/feoh.test.tsx`: delete the tests "renders the unavailable card when finance is disabled" and "treats a failed features fetch as finance disabled"; keep "renders the normal finance UI" but remove the `useFeaturesMock` setup it no longer needs. In `web/src/components/layout/mobile-nav.test.tsx`: delete the "hides the Feoh nav item when finance is disabled" test; simplify the "shows" test to not mock features.

- [ ] **Step 2: Run to verify current state fails**

Run: `cd web && npm test -- feoh` — expected: FAIL (page still renders the unavailable card without the mock).

- [ ] **Step 3: Remove the gating code**

1. Delete `web/src/hooks/use-finance-enabled.ts`.
2. `sidebar.tsx`: remove the `useFinanceEnabled` import/call; `filterNavItems` loses its finance parameter (keep the function if other gating exists, else inline `navItems`). Check `sidebar.tsx:48-73` — the only gated item is `nav.feoh`.
3. `mobile-nav.tsx`: same removal.
4. `feoh.tsx`: remove `useFinanceEnabled` import, the `financeEnabled` const, and the `if (!financeEnabled) { ... }` unavailable-card block (delete the card's i18n strings only if unused elsewhere — check with grep before removing from locale files).

- [ ] **Step 4: Run the web suite**

Run: `cd web && npm test` — expected: green; `grep -r useFinanceEnabled web/src` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A web
git commit -m "feat(web): finance nav and page always on - gate removed"
```

---

## Phase 1 — Schema & migration

### Task 3: All new tables + bill columns + the single migration

**Files:**
- Create: `src/modules/inventory/schema.ts`
- Modify: `src/modules/feoh/schema.ts` (add `feohItemCosts`, `recurringOccurrences`, `recurringBills.inventoryItemId`)
- Modify: `src/db/schema/drizzle-schema.ts`, `src/db/schema/index.ts`
- Create (generated): `src/db/migrations/00XX_feoh_inventory_lifecycle.sql` (+ appended UPDATEs)
- Test: `tests/inventory-schema.test.ts`

**Interfaces:**
- Produces (used by every later backend task):
  - `inventoryItems` table + `InventoryItem` type from `src/modules/inventory/schema.ts`
  - `feohItemCosts` + `FeohItemCost`, `recurringOccurrences` + `RecurringOccurrence`, and `recurringBills.inventoryItemId` from `src/modules/feoh/schema.ts`

- [ ] **Step 1: Write `src/modules/inventory/schema.ts`**

```ts
import { pgTable, text, uuid, timestamp, numeric, date, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** One row = one physical object (spec 2026-08-16). Lifecycle fields live
 *  here so pre-feoh items are backfillable; finance links live feoh-side. */
export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  category: text('category'),
  manufacturer: text('manufacturer'),
  model: text('model'),
  serialNumber: text('serial_number'),
  location: text('location'),
  notes: text('notes'),
  warrantyUntil: date('warranty_until'),
  purchasePrice: numeric('purchase_price', { precision: 14, scale: 2 }),
  purchaseDate: date('purchase_date'),
  decommissionedAt: date('decommissioned_at'),
  decommissionReason: text('decommission_reason'),
  disposalProceeds: numeric('disposal_proceeds', { precision: 14, scale: 2 }),
}, (t) => [
  check('inventory_reason_check', sql`${t.decommissionReason} IS NULL OR ${t.decommissionReason} IN ('broken', 'sold', 'given_away', 'worn_out', 'lost', 'other')`),
  check('inventory_decommission_pair_check', sql`(${t.decommissionedAt} IS NULL) = (${t.decommissionReason} IS NULL)`),
]);

export type InventoryItem = typeof inventoryItems.$inferSelect;
```

- [ ] **Step 2: Extend `src/modules/feoh/schema.ts`**

Add imports for `boolean`, `uniqueIndex` from `drizzle-orm/pg-core` and `inventoryItems` from `'../inventory/schema.js'`. Add to `recurringBills` (inside its column object):

```ts
  // Bill tied to an inventory item: booked occurrences count into the item's
  // TCO. restrict: clearing the link is an explicit bill edit, never a side
  // effect of item deletion.
  inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, { onDelete: 'restrict' }),
```

Append two tables:

```ts
/** The ONLY place finance knows about inventory items (incl. purchase/disposal
 *  provenance links — the item's own price fields stay authoritative for TCO). */
export const feohItemCosts = pgTable('feoh_item_costs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
}, (t) => [
  check('item_cost_kind_check', sql`${t.kind} IN ('purchase', 'disposal', 'repair', 'maintenance', 'accessory')`),
  uniqueIndex('item_cost_tx_item_unique').on(t.transactionId, t.itemId),
  uniqueIndex('item_cost_capital_unique').on(t.itemId, t.kind).where(sql`${t.kind} IN ('purchase', 'disposal')`),
  index('item_cost_item_id_idx').on(t.itemId),
]);

/** Persisted ONLY when touched (linked / skipped / amount override); planned
 *  and overdue occurrences are pure projections from the bill's cadence. */
export const recurringOccurrences = pgTable('recurring_occurrences', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  billId: uuid('bill_id').notNull().references(() => recurringBills.id, { onDelete: 'restrict' }),
  dueDate: date('due_date').notNull(),
  transactionId: uuid('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  skipped: boolean('skipped').notNull().default(false),
  overrideAmount: numeric('override_amount', { precision: 14, scale: 2 }),
}, (t) => [
  uniqueIndex('occurrence_bill_due_unique').on(t.billId, t.dueDate),
  check('occurrence_paid_xor_skipped', sql`NOT (${t.transactionId} IS NOT NULL AND ${t.skipped})`),
]);

export type FeohItemCost = typeof feohItemCosts.$inferSelect;
export type RecurringOccurrence = typeof recurringOccurrences.$inferSelect;
```

- [ ] **Step 3: Register in both barrels**

Append to `src/db/schema/index.ts`: `export * from '../../modules/inventory/schema.js';`
Append to `src/db/schema/drizzle-schema.ts`: `export * from '../../modules/inventory/schema';`
(The feoh schema is already exported by both.)

- [ ] **Step 4: Generate the migration and append cadence normalization**

Run: `npm run db:generate -- --name feoh-inventory-lifecycle`. Inspect the generated SQL (new tables, new column, constraints). Then append to the END of the generated `.sql` file (hand-written data statements are allowed; snapshots stay generator-owned):

```sql
--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'weekly'     WHERE lower(trim("cadence")) IN ('p1w', 'weekly', 'wöchentlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'monthly'    WHERE lower(trim("cadence")) IN ('p1m', 'monthly', 'monatlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'quarterly'  WHERE lower(trim("cadence")) IN ('p3m', 'quarterly', 'quartalsweise', 'vierteljährlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'semiannual' WHERE lower(trim("cadence")) IN ('p6m', 'semiannual', 'semi-annual', 'halbjährlich');--> statement-breakpoint
UPDATE "recurring_bills" SET "cadence" = 'yearly'     WHERE lower(trim("cadence")) IN ('p1y', 'yearly', 'annual', 'jährlich');
```

Unrecognized values are deliberately left untouched (spec: no silent rewrites).

- [ ] **Step 5: Write the schema smoke test `tests/inventory-schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { inventoryItems } from '../src/modules/inventory/schema.js';
import { feohItemCosts } from '../src/modules/feoh/schema.js';

describe('inventory/lifecycle schema', () => {
  it('inserts a minimal inventory item with defaults', async () => {
    const [row] = await db.insert(inventoryItems).values({ name: 'Washing machine' }).returning();
    expect(row!.decommissionedAt).toBeNull();
  });

  it('rejects a decommission date without a reason (pair check)', async () => {
    await expect(
      db.insert(inventoryItems).values({ name: 'X', decommissionedAt: '2026-01-01' }),
    ).rejects.toThrow();
  });

  it('rejects an occurrence that is both paid and skipped', async () => {
    // raw SQL always through sql`` (repo convention, see tests/feoh-schema.test.ts)
    await expect(db.execute(sql`
      INSERT INTO recurring_occurrences (bill_id, due_date, transaction_id, skipped)
      VALUES (gen_random_uuid(), '2026-01-01', gen_random_uuid(), true)`,
    )).rejects.toThrow();
  });

  it('enforces one purchase link per item (partial unique index)', async () => {
    // Two REAL transactions, one item, two 'purchase' links: second must fail.
    // Seed a member for created_by via helpers, then:
    const { seedTestHousehold } = await import('./helpers.js');
    const { adult } = await seedTestHousehold();
    const [item] = await db.insert(inventoryItems).values({ name: 'Z' }).returning();
    const txIds = await db.execute(sql`
      INSERT INTO transactions (date, payee, amount, created_by)
      VALUES ('2026-01-01', 'a', '1.00', ${adult.user.id}::uuid),
             ('2026-01-02', 'b', '2.00', ${adult.user.id}::uuid)
      RETURNING id`) as unknown as Array<{ id: string }>;
    await db.insert(feohItemCosts).values({ transactionId: txIds[0]!.id, itemId: item!.id, kind: 'purchase' });
    await expect(
      db.insert(feohItemCosts).values({ transactionId: txIds[1]!.id, itemId: item!.id, kind: 'purchase' }),
    ).rejects.toThrow();
  });
});
```

(Adjust `db.execute` raw-SQL idiom to whatever `tests/` already uses — grep for `db.execute` in existing tests and mirror it. The truncation helper in `tests/setup.ts` picks up new tables automatically if it enumerates `pg_tables`; verify and, if it uses an explicit list, add the three new tables.)

- [ ] **Step 6: Run and verify**

Run: `npm run typecheck && npm test -- inventory-schema` — expected: migration applies, tests pass. Also run one existing feoh file (`npm test -- feoh-bills`) to prove the schema change didn't break inserts.

- [ ] **Step 7: Commit**

```bash
git add -A src/modules/inventory src/modules/feoh/schema.ts src/db tests
git commit -m "feat(db): inventory items, feoh item costs, recurring occurrences schema + cadence normalization"
```

---

## Phase 2 — Inventory module backend

### Task 4: Inventory validators + service

**Files:**
- Create: `src/modules/inventory/validators.ts`, `src/modules/inventory/service.ts`
- Test: `tests/inventory-service.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 5, 6, 10):
  - `listItems(q: { status?: 'active' | 'decommissioned'; category?: string; q?: string; limit?: number; offset?: number }): Promise<{ rows: InventoryItem[]; total: number; limit: number; offset: number }>`
  - `createItem(i: CreateItemInput): Promise<InventoryItem>`
  - `getItem(id: string): Promise<InventoryItem | null>`
  - `updateItem(id: string, i: UpdateItemInput): Promise<InventoryItem | null>` — throws `Error('DISPOSAL_LINK_EXISTS')` on blocked reactivation
  - `decommissionItem(id: string, i: { date: string; reason: DecommissionReason; proceeds?: number }): Promise<InventoryItem | null>` — throws `Error('ALREADY_DECOMMISSIONED')`
  - `deleteItem(id: string): Promise<InventoryItem | null>` — throws `Error('HAS_FINANCE_LINKS')`

- [ ] **Step 1: Write `src/modules/inventory/validators.ts`**

```ts
import { z } from 'zod';

export const decommissionReasons = ['broken', 'sold', 'given_away', 'worn_out', 'lost', 'other'] as const;
export type DecommissionReason = (typeof decommissionReasons)[number];

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseItem = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  warrantyUntil: dateStr.optional().nullable(),
  purchasePrice: z.number().nonnegative().optional().nullable(),
  purchaseDate: dateStr.optional().nullable(),
});

/** Create rejects all lifecycle state — only decommission sets it. */
export const createItemSchema = baseItem;

/** Patch additionally accepts the lifecycle trio ONLY as explicit null for
 *  all three at once (reactivation). Partial lifecycle edits are rejected. */
export const updateItemSchema = baseItem.partial().extend({
  decommissionedAt: z.null().optional(),
  decommissionReason: z.null().optional(),
  disposalProceeds: z.null().optional(),
}).superRefine((v, ctx) => {
  const trio = ['decommissionedAt', 'decommissionReason', 'disposalProceeds'] as const;
  const present = trio.filter((k) => k in v);
  if (present.length > 0 && present.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reactivation must null all three lifecycle fields together' });
  }
});

export const decommissionSchema = z.object({
  date: dateStr,
  reason: z.enum(decommissionReasons),
  proceeds: z.number().nonnegative().optional(),
});

export const listItemsQuerySchema = z.object({
  status: z.enum(['active', 'decommissioned']).optional(),
  category: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type DecommissionInput = z.infer<typeof decommissionSchema>;
```

- [ ] **Step 2: Write the failing service tests `tests/inventory-service.test.ts`**

Mirror `tests/feoh-summary.test.ts` structure (service-direct, no HTTP). Cover:

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import * as service from '../src/modules/inventory/service.js';

describe('inventory service', () => {
  it('creates, lists with status/q filters, paginates', async () => {
    await service.createItem({ name: 'Bosch drill', manufacturer: 'Bosch', category: 'tool' });
    await service.createItem({ name: 'Washing machine', category: 'appliance' });
    const drill = (await service.listItems({ q: 'bosch' })).rows;
    expect(drill.length).toBe(1);
    const all = await service.listItems({});
    expect(all.total).toBe(2);
    expect((await service.listItems({ status: 'decommissioned' })).total).toBe(0);
  });

  it('decommissions once, rejects a second time', async () => {
    const item = await service.createItem({ name: 'Kettle' });
    const done = await service.decommissionItem(item.id, { date: '2026-08-01', reason: 'broken' });
    expect(done!.decommissionReason).toBe('broken');
    await expect(service.decommissionItem(item.id, { date: '2026-08-02', reason: 'broken' }))
      .rejects.toThrow('ALREADY_DECOMMISSIONED');
  });

  it('reactivates via all-null trio, blocks while a disposal link exists', async () => {
    const item = await service.createItem({ name: 'Bike' });
    await service.decommissionItem(item.id, { date: '2026-08-01', reason: 'sold', proceeds: 150 });
    // Simulate the feoh-side disposal link with raw SQL (inventory must not import feoh):
    await db.execute(sql`
      INSERT INTO feoh_item_costs (transaction_id, item_id, kind)
      SELECT t.id, ${item.id}::uuid, 'disposal' FROM transactions t LIMIT 1`);
    // No transactions exist yet -> insert a stub transaction first via SQL:
    // (arrange this insert BEFORE the link insert; see full test file)
    await expect(service.updateItem(item.id, {
      decommissionedAt: null, decommissionReason: null, disposalProceeds: null,
    })).rejects.toThrow('DISPOSAL_LINK_EXISTS');
  });

  it('delete is blocked by finance links, allowed otherwise', async () => {
    const linked = await service.createItem({ name: 'TV' });
    // raw-SQL feoh_item_costs row against `linked` (repair kind) ...
    await expect(service.deleteItem(linked.id)).rejects.toThrow('HAS_FINANCE_LINKS');
    const free = await service.createItem({ name: 'Chair' });
    expect((await service.deleteItem(free.id))!.id).toBe(free.id);
  });
});
```

The stub transaction insert (needed twice above — write a tiny local helper in the test file):

```ts
async function stubTransactionId(): Promise<string> {
  const { seedTestHousehold } = await import('./helpers.js');
  const { adult } = await seedTestHousehold();
  // postgres-js raw results are an ARRAY, not { rows }:
  const rows = await db.execute(sql`
    INSERT INTO transactions (date, payee, amount, created_by)
    VALUES ('2026-08-01', 'stub', '10.00', ${adult.user.id}::uuid) RETURNING id`) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}
```

(Check `seedTestHousehold`'s return shape in `tests/helpers.ts` — adapt `adult.user.id` if the property differs.)

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- inventory-service` — expected: FAIL (`service.js` module not found).

- [ ] **Step 4: Write `src/modules/inventory/service.ts`**

```ts
import { db } from '../../db/index.js';
import { inventoryItems, type InventoryItem } from './schema.js';
import { eq, and, isNull, isNotNull, ilike, or, sql } from 'drizzle-orm';
import type { CreateItemInput, UpdateItemInput, DecommissionInput } from './validators.js';

export async function listItems(q: {
  status?: 'active' | 'decommissioned'; category?: string; q?: string; limit?: number; offset?: number;
}): Promise<{ rows: InventoryItem[]; total: number; limit: number; offset: number }> {
  const conditions = [];
  if (q.status === 'active') conditions.push(isNull(inventoryItems.decommissionedAt));
  if (q.status === 'decommissioned') conditions.push(isNotNull(inventoryItems.decommissionedAt));
  if (q.category) conditions.push(eq(inventoryItems.category, q.category));
  if (q.q) {
    const pat = `%${q.q}%`;
    conditions.push(or(
      ilike(inventoryItems.name, pat), ilike(inventoryItems.manufacturer, pat),
      ilike(inventoryItems.model, pat), ilike(inventoryItems.serialNumber, pat),
    )!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const rows = await db.select().from(inventoryItems).where(where)
    .orderBy(inventoryItems.name).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(inventoryItems).where(where);
  return { rows, total: count!, limit, offset };
}

export async function createItem(i: CreateItemInput): Promise<InventoryItem> {
  const [row] = await db.insert(inventoryItems).values({
    name: i.name, category: i.category ?? null, manufacturer: i.manufacturer ?? null,
    model: i.model ?? null, serialNumber: i.serialNumber ?? null, location: i.location ?? null,
    notes: i.notes ?? null, warrantyUntil: i.warrantyUntil ?? null,
    purchasePrice: i.purchasePrice != null ? String(i.purchasePrice) : null,
    purchaseDate: i.purchaseDate ?? null,
  }).returning();
  return row!;
}

export async function getItem(id: string): Promise<InventoryItem | null> {
  const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
  return row ?? null;
}

/** The one sanctioned inventory->feoh touchpoint: a table-level existence
 *  read (no module import). Covered by tests so a rename breaks loudly.
 *  NOTE: this repo's postgres-js driver returns raw results as an ARRAY
 *  (RowList), not `{ rows }` — always `as unknown as Array<...>`. */
async function hasDisposalLink(itemId: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 FROM feoh_item_costs WHERE item_id = ${itemId}::uuid AND kind = 'disposal' LIMIT 1`) as unknown as unknown[];
  return rows.length > 0;
}

export async function updateItem(id: string, i: UpdateItemInput): Promise<InventoryItem | null> {
  const isReactivation = 'decommissionedAt' in i;
  if (isReactivation && await hasDisposalLink(id)) throw new Error('DISPOSAL_LINK_EXISTS');
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['name', 'category', 'manufacturer', 'model', 'serialNumber', 'location', 'notes', 'warrantyUntil', 'purchaseDate'] as const) {
    if (i[k] !== undefined) patch[k] = i[k];
  }
  if (i.purchasePrice !== undefined) patch['purchasePrice'] = i.purchasePrice != null ? String(i.purchasePrice) : null;
  if (isReactivation) { patch['decommissionedAt'] = null; patch['decommissionReason'] = null; patch['disposalProceeds'] = null; }
  const [row] = await db.update(inventoryItems).set(patch).where(eq(inventoryItems.id, id)).returning();
  return row ?? null;
}

export async function decommissionItem(id: string, i: DecommissionInput): Promise<InventoryItem | null> {
  const existing = await getItem(id);
  if (!existing) return null;
  if (existing.decommissionedAt) throw new Error('ALREADY_DECOMMISSIONED');
  const [row] = await db.update(inventoryItems).set({
    updatedAt: new Date(), decommissionedAt: i.date, decommissionReason: i.reason,
    disposalProceeds: i.proceeds != null ? String(i.proceeds) : null,
  }).where(eq(inventoryItems.id, id)).returning();
  return row ?? null;
}

export async function deleteItem(id: string): Promise<InventoryItem | null> {
  try {
    const [row] = await db.delete(inventoryItems).where(eq(inventoryItems.id, id)).returning();
    return row ?? null;
  } catch (e: unknown) {
    // 23503 = foreign_key_violation, 23001 = restrict_violation (Postgres
    // raises either for ON DELETE RESTRICT — tests/feoh-schema.test.ts
    // documents both in this repo): feoh_item_costs.item_id or
    // recurring_bills.inventory_item_id — finance history exists.
    if (e && typeof e === 'object' && 'code' in e
        && ['23503', '23001'].includes((e as { code: string }).code)) {
      throw new Error('HAS_FINANCE_LINKS');
    }
    throw e;
  }
}
```

(If `db.execute` returns rows differently in this Drizzle version, mirror how existing code reads raw results — grep `db.execute` in `src/`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && npm test -- inventory-service` — expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/inventory tests/inventory-service.test.ts
git commit -m "feat(inventory): item service with lifecycle guards"
```

### Task 5: Inventory routes + module registration

**Files:**
- Create: `src/modules/inventory/routes.ts`, `src/modules/inventory/index.ts`
- Modify: `src/modules/index.ts` (add `inventoryModule` to `ALL_MODULES`)
- Test: `tests/inventory-routes.test.ts`

**Interfaces:**
- Consumes: Task 4 service/validators.
- Produces: `/api/v1/inventory/items` REST surface (list/create/get/patch/delete + `POST /items/:id/decommission`); `inventoryModule: HeorthModule` named `'inventory'`.

- [ ] **Step 1: Write the failing route tests**

Follow `tests/feoh-bills.test.ts` post-Task-1 idiom (static imports, `seedTestHousehold`/`authHeaders`). Cover: 201 create → 200 list (meta total) → 200 get → PATCH rename → decommission 200 then 409 (`ALREADY_DECOMMISSIONED`) → DELETE free item 200 → DELETE linked item 409 `HAS_FINANCE_LINKS` (arrange link via raw SQL as in Task 4) → child-role POST rejected 403 → validation: decommission without reason 400; PATCH with only `decommissionedAt: null` (partial trio) 400.

- [ ] **Step 2: Run to verify failure** — `npm test -- inventory-routes`: FAIL (404, module not mounted).

- [ ] **Step 3: Write `routes.ts` + `index.ts`**

`routes.ts` mirrors `src/modules/feoh/routes.ts` exactly in style, minus the maintenance-admin quarantine:

```ts
import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import * as service from './service.js';
import { createItemSchema, updateItemSchema, decommissionSchema, listItemsQuerySchema } from './validators.js';

export const inventoryRouter = new Hono();
inventoryRouter.use('*', requireAuth);
const canWrite = requireRole('admin', 'adult');

inventoryRouter.get('/items', async (c) => {
  const q = listItemsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const { rows, total, limit, offset } = await service.listItems(q.data);
  return ok(c, rows, { total, limit, offset });
});

inventoryRouter.post('/items', canWrite, async (c) => {
  const body = createItemSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return ok(c, await service.createItem(body.data), undefined, 201);
});

inventoryRouter.get('/items/:id', async (c) => {
  const row = await service.getItem(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, row);
});

inventoryRouter.patch('/items/:id', canWrite, async (c) => {
  const body = updateItemSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.updateItem(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'DISPOSAL_LINK_EXISTS') {
      return err(c, 'DISPOSAL_LINK_EXISTS', 'Unlink the disposal transaction before reactivating', 409);
    }
    throw e;
  }
});

inventoryRouter.post('/items/:id/decommission', canWrite, async (c) => {
  const body = decommissionSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.decommissionItem(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'ALREADY_DECOMMISSIONED') {
      return err(c, 'ALREADY_DECOMMISSIONED', 'Item is already decommissioned', 409);
    }
    throw e;
  }
});

inventoryRouter.delete('/items/:id', canWrite, async (c) => {
  try {
    const row = await service.deleteItem(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
    return ok(c, { id: row.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'HAS_FINANCE_LINKS') {
      return err(c, 'HAS_FINANCE_LINKS', 'Item has finance links - decommission instead of deleting', 409);
    }
    throw e;
  }
});
```

`index.ts`:

```ts
import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { inventoryRouter } from './routes.js';

/** Household inventory (spec 2026-08-16). Standalone and always on; feoh
 *  references inventory, never the reverse. */
export const inventoryModule: HeorthModule = {
  name: 'inventory',
  register(app: Hono, _mcp: McpRegistry): void {
    app.route('/api/v1/inventory', inventoryRouter);
  },
};
```

Add to `src/modules/index.ts` after `libraryModule`: import + `inventoryModule,` with comment `// Inventory: household items + lifecycle; finance links live feoh-side.`

- [ ] **Step 4: Run** — `npm run typecheck && npm test -- inventory-routes`: PASS. Also `npm test -- mcp-server` (module count may be asserted there — update if so).

- [ ] **Step 5: Commit** — `git add -A src/modules tests/inventory-routes.test.ts && git commit -m "feat(inventory): REST routes and module registration"`

### Task 6: Inventory MCP tools

**Files:**
- Create: `src/modules/inventory/mcp.ts`; Modify: `src/modules/inventory/index.ts` (register tools)
- Test: `tests/inventory-mcp.test.ts`; Modify: `tests/mcp-server.test.ts` (tool list)

**Interfaces:**
- Consumes: Task 4 service. Produces MCP tools `inventory.list_items`, `inventory.get_item`, `inventory.record_item`, `inventory.decommission_item`.

- [ ] **Step 1: Write failing MCP test** — mirror `tests/feoh-mcp.test.ts` bootstrap; assert `inventory.record_item` creates (admin principal), child principal gets the role tool-error, `inventory.decommission_item` twice → second returns `isError` result, `inventory.list_items` returns the item.

- [ ] **Step 2: Run to verify failure** — `npm test -- inventory-mcp`: FAIL.

- [ ] **Step 3: Write `mcp.ts`** — copy the `result`/`toolError`/`assertCanWrite` helpers from `src/modules/feoh/mcp.ts` (message: `'Inventory writes require an admin or adult member'`), then:

```ts
export const inventoryTools: McpTool[] = [
  { name: 'inventory.list_items',
    description: 'List household inventory items (filter by status/category/search).',
    inputSchema: { status: z.enum(['active', 'decommissioned']).optional(), category: z.string().optional(), q: z.string().optional() },
    async handler(_ctx, input) { return result(await service.listItems(input as never)); } },
  { name: 'inventory.get_item',
    description: 'Get one inventory item by id (lifecycle fields included).',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      const row = await service.getItem((input as { id: string }).id);
      return row ? result(row) : toolError('Item not found');
    } },
  { name: 'inventory.record_item',
    description: 'Create an inventory item (name required; purchase fields optional).',
    inputSchema: { /* mirror createItemSchema fields as individual zod entries */ },
    async handler(ctx, input) {
      const gate = assertCanWrite(ctx); if (gate) return gate;
      return result(await service.createItem(input as never));
    } },
  { name: 'inventory.decommission_item',
    description: 'Decommission an item (date, reason; optional proceeds). Inventory fields only - link a sale transaction separately via feoh.link_item_cost.',
    inputSchema: { id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.enum(decommissionReasons), proceeds: z.number().nonnegative().optional() },
    async handler(ctx, input) {
      const gate = assertCanWrite(ctx); if (gate) return gate;
      const { id, ...rest } = input as { id: string; date: string; reason: DecommissionReason; proceeds?: number };
      try {
        const row = await service.decommissionItem(id, rest);
        return row ? result(row) : toolError('Item not found');
      } catch (e) {
        if (e instanceof Error && e.message === 'ALREADY_DECOMMISSIONED') return toolError('Item is already decommissioned');
        throw e;
      }
    } },
];
```

Register in `index.ts`: `mcp.add(...inventoryTools);`. Fill `record_item`'s inputSchema with the same zod fields as `createItemSchema` (flat object entries, per the feoh mcp idiom).

- [ ] **Step 4: Run** — `npm test -- inventory-mcp` PASS; update `tests/mcp-server.test.ts` expected tool list (+4 tools) and re-run it.

- [ ] **Step 5: Commit** — `git commit -m "feat(inventory): MCP tools"` (after `git add`).

---

## Phase 3 — Recurring occurrences

### Task 7: Cadence projection library (pure functions)

**Files:**
- Create: `src/modules/feoh/cadence.ts`
- Test: `tests/feoh-cadence.test.ts` (no DB)

**Interfaces:**
- Produces (consumed by Task 8):
  - `type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'`
  - `CADENCES: readonly Cadence[]`, `isCadence(s: string): s is Cadence`
  - `addPeriods(anchor: string, cadence: Cadence, n: number): string` — nth date after the anchor, month-family day-of-month clamped, each derived from the ANCHOR (never the previous clamped date)
  - `projectDueDates(anchor: string, cadence: Cadence, toInclusive: string): string[]`
  - `isProjectedDate(anchor: string, cadence: Cadence, dueDate: string): boolean`

- [ ] **Step 1: Write the failing tests** — the densest coverage in the plan (spec risk #1):

```ts
import { describe, it, expect } from 'vitest';
import { addPeriods, projectDueDates, isProjectedDate, isCadence } from '../src/modules/feoh/cadence.js';

describe('cadence math', () => {
  it('weekly adds 7-day steps', () => {
    expect(addPeriods('2026-01-31', 'weekly', 1)).toBe('2026-02-07');
    expect(addPeriods('2026-12-28', 'weekly', 1)).toBe('2027-01-04');
  });
  it('monthly clamps to month length, always from the anchor', () => {
    expect(addPeriods('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(addPeriods('2026-01-31', 'monthly', 2)).toBe('2026-03-31'); // NOT 03-28
    expect(addPeriods('2026-01-31', 'monthly', 3)).toBe('2026-04-30');
    expect(addPeriods('2024-01-31', 'monthly', 1)).toBe('2024-02-29'); // leap year
  });
  it('quarterly / semiannual / yearly step in months with clamping', () => {
    expect(addPeriods('2026-08-31', 'quarterly', 1)).toBe('2026-11-30');
    expect(addPeriods('2026-08-31', 'semiannual', 1)).toBe('2027-02-28');
    expect(addPeriods('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
  });
  it('projects anchor..toInclusive and honours bounds', () => {
    expect(projectDueDates('2026-08-01', 'monthly', '2026-10-31'))
      .toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(projectDueDates('2026-08-01', 'monthly', '2026-07-01')).toEqual([]);
  });
  it('isProjectedDate accepts exact projections only', () => {
    expect(isProjectedDate('2026-01-31', 'monthly', '2026-02-28')).toBe(true);
    expect(isProjectedDate('2026-01-31', 'monthly', '2026-02-27')).toBe(false);
    expect(isProjectedDate('2026-01-31', 'monthly', '2026-01-15')).toBe(false); // before anchor
  });
  it('isCadence rejects legacy free text', () => {
    expect(isCadence('monthly')).toBe(true);
    expect(isCadence('P1M')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- feoh-cadence`: FAIL.

- [ ] **Step 3: Implement `src/modules/feoh/cadence.ts`**

```ts
export const CADENCES = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type Cadence = (typeof CADENCES)[number];
export function isCadence(s: string): s is Cadence { return (CADENCES as readonly string[]).includes(s); }

const MONTH_STEPS: Record<Exclude<Cadence, 'weekly'>, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

function parts(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y: y!, m: m!, day: day! };
}
function fmt(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** nth occurrence date after the anchor. Month-family cadences derive each
 *  date from the ANCHOR's day-of-month (clamped per target month) — never
 *  from the previous clamped date, so Jan 31 -> Feb 28 -> Mar 31. */
export function addPeriods(anchor: string, cadence: Cadence, n: number): string {
  const a = parts(anchor);
  if (cadence === 'weekly') {
    const d = new Date(Date.UTC(a.y, a.m - 1, a.day + 7 * n));
    return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const totalMonths = a.y * 12 + (a.m - 1) + MONTH_STEPS[cadence] * n;
  const y = Math.floor(totalMonths / 12);
  const m = (totalMonths % 12) + 1;
  return fmt(y, m, Math.min(a.day, daysInMonth(y, m)));
}

export function projectDueDates(anchor: string, cadence: Cadence, toInclusive: string): string[] {
  const out: string[] = [];
  for (let n = 0; ; n++) {
    const d = addPeriods(anchor, cadence, n);
    if (d > toInclusive) break;
    out.push(d);
  }
  return out;
}

export function isProjectedDate(anchor: string, cadence: Cadence, dueDate: string): boolean {
  if (dueDate < anchor) return false;
  for (let n = 0; ; n++) {
    const d = addPeriods(anchor, cadence, n);
    if (d === dueDate) return true;
    if (d > dueDate) return false;
  }
}
```

- [ ] **Step 4: Run** — `npm test -- feoh-cadence`: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(feoh): cadence projection math"` (after `git add`).

### Task 8: Occurrence service + bill validator changes

**Files:**
- Create: `src/modules/feoh/occurrences.ts`
- Modify: `src/modules/feoh/validators.ts` (cadence enum on `createBillSchema`; add `inventoryItemId`)
- Modify: `src/modules/feoh/service.ts` (`createBill`/`updateBill` pass `inventoryItemId`; `deleteBill` history guard; `deleteTransaction` prune)
- Test: `tests/feoh-occurrences.test.ts`

**Interfaces:**
- Consumes: Task 7 (`isCadence`, `projectDueDates`, `isProjectedDate`, `addPeriods`), Task 3 (`recurringOccurrences`).
- Produces (consumed by Tasks 9, 10):
  - `type OccurrenceStatus = 'planned' | 'paid' | 'overdue' | 'skipped' | 'unknown'`
  - `interface OccurrenceEntry { billId: string; payee: string; dueDate: string; status: OccurrenceStatus; expectedAmount: number; overrideAmount: number | null; transactionId: string | null; offSchedule: boolean; cadenceUnknown: boolean }`
  - `listOccurrences(q: { from?: string; to?: string; billId?: string; status?: OccurrenceStatus }, today?: string): Promise<OccurrenceEntry[]>`
  - `linkOccurrence(i: { billId: string; dueDate: string; transactionId: string }): Promise<void>` — throws `NOT_FOUND_BILL` / `NOT_FOUND_TRANSACTION` / `NOT_AN_OCCURRENCE` / `ALREADY_PAID` / `ALREADY_SKIPPED`
  - `skipOccurrence(i: { billId: string; dueDate: string }): Promise<void>` — same errors minus transaction
  - `unlinkOccurrence(i)` / `unskipOccurrence(i)`: `Promise<void>` (prunes untouched rows)
  - `overrideOccurrence(i: { billId: string; dueDate: string; amount: number | null }): Promise<void>`
  - `service.deleteBill` now throws `Error('BILL_HAS_HISTORY')`

- [ ] **Step 1: Write the failing tests** — cover the full state machine. Key cases (write them all as real tests; helper `mkBill(cadence, nextDue, amount)` via `service.createBill`, `mkTx()` via `service.recordTransaction` with an account+envelope posting pair):

  1. `listOccurrences` for a monthly bill anchored 3 months back (pass `today` explicitly, e.g. `'2026-08-16'`, anchor `'2026-06-01'`): dates before today are `overdue`, dates from today to today+6M are `planned`, count matches `projectDueDates`.
  2. `linkOccurrence` on a projected date → listing shows `paid` with the transactionId; linking again → `ALREADY_PAID`; `skipOccurrence` on the paid one → `ALREADY_PAID` (mirror-guard), skip on a fresh date then link → `ALREADY_SKIPPED`.
  3. `linkOccurrence` with an off-cadence date (`'2026-06-15'` for a monthly bill anchored on the 1st) → `NOT_AN_OCCURRENCE`.
  4. `overrideOccurrence(amount)` persists a row; listing shows `overrideAmount` and `expectedAmount === amount`, status still derived by date (override-only row before today → `overdue`); `overrideOccurrence(null)` prunes the row (assert via direct select count 0).
  5. `unlinkOccurrence` after link prunes back to pure projection (row gone); after link+override, unlink keeps the row (override remains) with status by date.
  6. Deleting a linked transaction via `service.deleteTransaction` prunes the now-untouched row (FK sets null, service prunes).
  7. Cadence edit: `updateBill` to a new `nextDue`; a persisted paid row on the old schedule is still listed, `offSchedule: true`.
  8. Unknown cadence: insert a bill with raw-SQL cadence `'every blue moon'`; listing returns exactly one entry `{ status: 'unknown', cadenceUnknown: true, dueDate: nextDue }`; `linkOccurrence` on it → `NOT_AN_OCCURRENCE`; `status=unknown` filter matches only it.
  9. `deleteBill` with a persisted occurrence → `BILL_HAS_HISTORY`; with none → deletes.
  10. `createBill` via schema now rejects `cadence: 'P1M'` (validator test through the route in Task 9; here assert `createBillSchema.safeParse({...cadence:'P1M'...}).success === false`).

- [ ] **Step 2: Run to verify failure** — `npm test -- feoh-occurrences`: FAIL.

- [ ] **Step 3: Implement**

`validators.ts` — change `createBillSchema`:

```ts
export const createBillSchema = z.object({
  payee: z.string().min(1),
  amount: z.number(),
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']),
  nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  envelopeId: z.string().uuid().optional().nullable(),
  inventoryItemId: z.string().uuid().optional().nullable(),
});
```

`service.ts` — `createBill`/`updateBill` add `inventoryItemId: i.inventoryItemId ?? null` (create) / `if (i.inventoryItemId !== undefined) patch['inventoryItemId'] = i.inventoryItemId;` (update). `deleteBill`:

```ts
export async function deleteBill(id: string): Promise<RecurringBill | null> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(recurringOccurrences).where(eq(recurringOccurrences.billId, id));
  if (count! > 0) throw new Error('BILL_HAS_HISTORY');
  const [row] = await db.delete(recurringBills).where(eq(recurringBills.id, id)).returning();
  return row ?? null;
}
```

`deleteTransaction` — wrap in `db.transaction`; prune scoped to exactly the rows this transaction settled (add `isNull`, `inArray` and `recurringOccurrences` to service.ts's drizzle/schema imports):

```ts
export async function deleteTransaction(id: string): Promise<Transaction | null> {
  return db.transaction(async (tx) => {
    // Capture the occurrence rows this transaction settles BEFORE the delete
    // (the FK then nulls their transactionId) so the prune is scoped to
    // exactly these rows — never a global sweep.
    const touched = await tx.select({ id: recurringOccurrences.id }).from(recurringOccurrences)
      .where(eq(recurringOccurrences.transactionId, id));
    const [row] = await tx.delete(transactions).where(eq(transactions.id, id)).returning();
    if (!row) return null;
    if (touched.length > 0) {
      // Rows whose only "touch" was this transaction revert to pure projections.
      await tx.delete(recurringOccurrences).where(and(
        inArray(recurringOccurrences.id, touched.map((t) => t.id)),
        isNull(recurringOccurrences.transactionId),
        eq(recurringOccurrences.skipped, false),
        isNull(recurringOccurrences.overrideAmount),
      ));
    }
    return row;
  });
}
```

`occurrences.ts` — the core module:

```ts
import { db } from '../../db/index.js';
import { recurringBills, recurringOccurrences, transactions, type RecurringBill } from './schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { isCadence, projectDueDates, isProjectedDate, addPeriods, type Cadence } from './cadence.js';

export type OccurrenceStatus = 'planned' | 'paid' | 'overdue' | 'skipped' | 'unknown';
export interface OccurrenceEntry {
  billId: string; payee: string; dueDate: string; status: OccurrenceStatus;
  expectedAmount: number; overrideAmount: number | null; transactionId: string | null;
  offSchedule: boolean; cadenceUnknown: boolean;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function addMonthsIso(d: string, months: number): string { return addPeriods(d, 'monthly', months); }

export async function listOccurrences(
  q: { from?: string; to?: string; billId?: string; status?: OccurrenceStatus },
  today: string = todayIso(),
): Promise<OccurrenceEntry[]> {
  const bills = q.billId
    ? await db.select().from(recurringBills).where(eq(recurringBills.id, q.billId))
    : await db.select().from(recurringBills);
  const horizon = q.to ?? addMonthsIso(today, 6);
  const cappedHorizon = horizon > addMonthsIso(today, 24) ? addMonthsIso(today, 24) : horizon;
  const out: OccurrenceEntry[] = [];

  for (const bill of bills) {
    const persisted = await db.select().from(recurringOccurrences)
      .where(eq(recurringOccurrences.billId, bill.id));
    const byDate = new Map(persisted.map((r) => [r.dueDate, r]));

    if (!isCadence(bill.cadence)) {
      out.push(entry(bill, bill.nextDue, 'unknown', null, true));
      continue;
    }
    const projected = projectDueDates(bill.nextDue, bill.cadence, cappedHorizon);
    const projectedSet = new Set(projected);
    const dates = [...new Set([...projected, ...persisted.map((r) => r.dueDate)])].sort();

    for (const dueDate of dates) {
      const row = byDate.get(dueDate) ?? null;
      const status: OccurrenceStatus =
        row?.transactionId ? 'paid'
        : row?.skipped ? 'skipped'
        : dueDate < today ? 'overdue' : 'planned';
      // overdue always included; from-filter applies to the rest
      if (status !== 'overdue' && q.from && dueDate < q.from) continue;
      const e = entry(bill, dueDate, status, row, false);
      e.offSchedule = row != null && !projectedSet.has(dueDate);
      out.push(e);
    }
  }
  const filtered = q.status ? out.filter((e) => e.status === q.status) : out;
  return filtered.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.payee.localeCompare(b.payee));
}

function entry(
  bill: RecurringBill, dueDate: string, status: OccurrenceStatus,
  row: { transactionId: string | null; overrideAmount: string | null } | null,
  cadenceUnknown: boolean,
): OccurrenceEntry {
  const override = row?.overrideAmount != null ? Number(row.overrideAmount) : null;
  return {
    billId: bill.id, payee: bill.payee, dueDate, status,
    expectedAmount: override ?? Number(bill.amount), overrideAmount: override,
    transactionId: row?.transactionId ?? null, offSchedule: false, cadenceUnknown,
  };
}

/** dueDate must be a projected date for the bill, or an already-persisted row
 *  (the off-schedule exception). Arbitrary dates are NOT occurrences. */
async function resolveTarget(billId: string, dueDate: string) {
  const [bill] = await db.select().from(recurringBills).where(eq(recurringBills.id, billId)).limit(1);
  if (!bill) throw new Error('NOT_FOUND_BILL');
  const [row] = await db.select().from(recurringOccurrences)
    .where(and(eq(recurringOccurrences.billId, billId), eq(recurringOccurrences.dueDate, dueDate))).limit(1);
  if (!row) {
    if (!isCadence(bill.cadence) || !isProjectedDate(bill.nextDue, bill.cadence as Cadence, dueDate)) {
      throw new Error('NOT_AN_OCCURRENCE');
    }
  }
  return { bill, row: row ?? null };
}

/** Concurrency: the select-then-insert can race with another caller on the
 *  same (billId, dueDate) — the unique index then raises 23505. Map that to
 *  the state error a re-read would have produced instead of leaking a 500. */
function mapOccurrenceConflict(e: unknown, row: { skipped: boolean } | null): never {
  if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '23505') {
    throw new Error(row?.skipped ? 'ALREADY_SKIPPED' : 'ALREADY_PAID');
  }
  throw e;
}

export async function linkOccurrence(i: { billId: string; dueDate: string; transactionId: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  const [txn] = await db.select().from(transactions).where(eq(transactions.id, i.transactionId)).limit(1);
  if (!txn) throw new Error('NOT_FOUND_TRANSACTION');
  if (row?.transactionId) throw new Error('ALREADY_PAID');
  if (row?.skipped) throw new Error('ALREADY_SKIPPED');
  try {
    if (row) {
      await db.update(recurringOccurrences).set({ transactionId: i.transactionId, updatedAt: new Date() })
        .where(eq(recurringOccurrences.id, row.id));
    } else {
      await db.insert(recurringOccurrences).values({ billId: i.billId, dueDate: i.dueDate, transactionId: i.transactionId });
    }
  } catch (e: unknown) { mapOccurrenceConflict(e, row); }
}

export async function skipOccurrence(i: { billId: string; dueDate: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (row?.transactionId) throw new Error('ALREADY_PAID');
  if (row?.skipped) throw new Error('ALREADY_SKIPPED');
  try {
    if (row) {
      await db.update(recurringOccurrences).set({ skipped: true, updatedAt: new Date() })
        .where(eq(recurringOccurrences.id, row.id));
    } else {
      await db.insert(recurringOccurrences).values({ billId: i.billId, dueDate: i.dueDate, skipped: true });
    }
  } catch (e: unknown) { mapOccurrenceConflict(e, row); }
}

async function pruneIfUntouched(id: string): Promise<void> {
  await db.delete(recurringOccurrences).where(and(
    eq(recurringOccurrences.id, id),
    isNull(recurringOccurrences.transactionId),
    eq(recurringOccurrences.skipped, false),
    isNull(recurringOccurrences.overrideAmount),
  ));
}

export async function unlinkOccurrence(i: { billId: string; dueDate: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (!row) return;
  await db.update(recurringOccurrences).set({ transactionId: null, updatedAt: new Date() })
    .where(eq(recurringOccurrences.id, row.id));
  await pruneIfUntouched(row.id);
}

export async function unskipOccurrence(i: { billId: string; dueDate: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (!row) return;
  await db.update(recurringOccurrences).set({ skipped: false, updatedAt: new Date() })
    .where(eq(recurringOccurrences.id, row.id));
  await pruneIfUntouched(row.id);
}

export async function overrideOccurrence(i: { billId: string; dueDate: string; amount: number | null }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (row) {
    await db.update(recurringOccurrences)
      .set({ overrideAmount: i.amount != null ? String(i.amount) : null, updatedAt: new Date() })
      .where(eq(recurringOccurrences.id, row.id));
    await pruneIfUntouched(row.id);
  } else if (i.amount != null) {
    await db.insert(recurringOccurrences).values({ billId: i.billId, dueDate: i.dueDate, overrideAmount: String(i.amount) });
  }
}
```

- [ ] **Step 4: Run** — `npm run typecheck && npm test -- feoh-occurrences` PASS; also `npm test -- feoh-bills` (cadence enum broke `P1M` fixtures — update those two fixtures to `'monthly'` as part of this step; the raw `cadence: 'P1M'` service-level insert in feoh-bills.test.ts:27 bypasses the validator, change it anyway for realism).

- [ ] **Step 5: Commit** — `git commit -m "feat(feoh): occurrence projection, state machine, bill history guard"`.

### Task 9: Occurrence routes + MCP

**Files:**
- Modify: `src/modules/feoh/routes.ts`, `src/modules/feoh/validators.ts` (occurrence input schemas), `src/modules/feoh/mcp.ts`
- Test: `tests/feoh-occurrence-routes.test.ts`; Modify: `tests/mcp-server.test.ts`

**Interfaces:**
- Consumes: Task 8 functions verbatim.
- Produces REST: `GET /api/v1/feoh/occurrences`, `POST .../occurrences/link`, `POST .../occurrences/skip`, `POST .../occurrences/unlink`, `POST .../occurrences/unskip`, `PATCH .../occurrences/override`. MCP: `feoh.list_occurrences`, `feoh.link_occurrence`, `feoh.skip_occurrence`.

- [ ] **Step 1: Add validators** to `validators.ts`:

```ts
export const occurrenceRefSchema = z.object({
  billId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const linkOccurrenceSchema = occurrenceRefSchema.extend({ transactionId: z.string().uuid() });
export const overrideOccurrenceSchema = occurrenceRefSchema.extend({ amount: z.number().nonnegative().nullable() });
export const listOccurrencesQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  billId: z.string().uuid().optional(),
  status: z.enum(['planned', 'paid', 'overdue', 'skipped', 'unknown']).optional(),
});
```

- [ ] **Step 2: Write failing route tests** — seed a monthly bill + one transaction; assert: GET lists entries; link → GET shows paid; link again → 409 `ALREADY_PAID`; link off-cadence date → 400 `NOT_AN_OCCURRENCE`; skip/unskip round-trip; override PATCH then null; child role → 403 on mutations; GET allowed for any auth role.

- [ ] **Step 3: Run to verify failure**, then **Step 4: add routes** to `routes.ts` (before the `/export` route). One error-mapping helper keeps it flat:

```ts
import type { Context } from 'hono';
import * as occ from './occurrences.js';

const OCC_ERRORS: Record<string, [string, string, number]> = {
  NOT_FOUND_BILL: ['NOT_FOUND', 'Bill not found', 404],
  NOT_FOUND_TRANSACTION: ['NOT_FOUND', 'Transaction not found', 404],
  NOT_AN_OCCURRENCE: ['NOT_AN_OCCURRENCE', 'dueDate is not an occurrence of this bill', 400],
  ALREADY_PAID: ['ALREADY_PAID', 'Occurrence is already linked to a transaction', 409],
  ALREADY_SKIPPED: ['ALREADY_SKIPPED', 'Occurrence is skipped', 409],
};
async function occCall(c: Context, fn: () => Promise<void>) {
  try { await fn(); return ok(c, { ok: true }); }
  catch (e: unknown) {
    const m = e instanceof Error ? OCC_ERRORS[e.message] : undefined;
    if (m) return err(c, m[0], m[1], m[2] as 400);
    throw e;
  }
}

feohRouter.get('/occurrences', async (c) => {
  const q = listOccurrencesQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  return ok(c, await occ.listOccurrences(q.data));
});
feohRouter.post('/occurrences/link', canWrite, async (c) => {
  const body = linkOccurrenceSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return occCall(c, () => occ.linkOccurrence(body.data));
});
feohRouter.post('/occurrences/skip', canWrite, async (c) => { /* same shape with occurrenceRefSchema + occ.skipOccurrence */ });
feohRouter.post('/occurrences/unlink', canWrite, async (c) => { /* occurrenceRefSchema + occ.unlinkOccurrence */ });
feohRouter.post('/occurrences/unskip', canWrite, async (c) => { /* occurrenceRefSchema + occ.unskipOccurrence */ });
feohRouter.patch('/occurrences/override', canWrite, async (c) => { /* overrideOccurrenceSchema + occ.overrideOccurrence */ });
```

(Write the four commented handlers out in full — identical shape to `/occurrences/link`.) Also map `BILL_HAS_HISTORY` in the existing `DELETE /bills/:id` handler → 409.

MCP additions in `mcp.ts` (same write-gate pattern as `feoh.record_transaction`):

```ts
{ name: 'feoh.list_occurrences',
  description: 'List recurring-bill occurrences (planned/paid/overdue/skipped) in a date window. The "what is overdue" tool.',
  inputSchema: { from: ..., to: ..., billId: ..., status: ... /* mirror listOccurrencesQuerySchema */ },
  async handler(_ctx, input) { return result({ occurrences: await occ.listOccurrences(input as never) }); } },
{ name: 'feoh.link_occurrence', description: 'Mark an occurrence paid by linking the settling transaction.',
  inputSchema: { billId: z.string().uuid(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), transactionId: z.string().uuid() },
  async handler(ctx, input) { /* gate + quarantine + occ.linkOccurrence, map known errors to toolError */ } },
{ name: 'feoh.skip_occurrence', description: 'Skip one occurrence of a recurring bill.',
  inputSchema: { billId: z.string().uuid(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
  async handler(ctx, input) { /* gate + occ.skipOccurrence */ } },
```

- [ ] **Step 5: Run** — occurrence-routes + mcp-server tests PASS. **Step 6: Commit** — `git commit -m "feat(feoh): occurrence REST routes and MCP tools"`.

---

## Phase 4 — Lifecycle costs / TCO (feoh side)

### Task 10: Item-costs service with TCO

**Files:**
- Create: `src/modules/feoh/item-costs.ts`
- Test: `tests/feoh-item-costs.test.ts`

**Interfaces:**
- Consumes: `inventoryItems` schema + inventory service `getItem` (feoh → inventory import is ALLOWED), `feohItemCosts`, Task 8's paid occurrences.
- Produces (consumed by Task 11):
  - `type CostKind = 'purchase' | 'disposal' | 'repair' | 'maintenance' | 'accessory'`
  - `createItemCost(i: { transactionId: string; itemId: string; kind: CostKind }): Promise<FeohItemCost>` — throws `NOT_FOUND_TRANSACTION` / `NOT_FOUND_ITEM` / `ITEM_DECOMMISSIONED` / `NOT_A_COST` / `DUPLICATE_LINK`
  - `deleteItemCost(id: string): Promise<FeohItemCost | null>`
  - `getItemCosts(itemId: string): Promise<ItemCostsBreakdown | null>` where `ItemCostsBreakdown = { item: InventoryItem; links: Array<FeohItemCost & { transaction: Transaction }>; recurringBills: RecurringBill[]; totals: { capital: number; tier2: number; recurring: number; proceeds: number; total: number; perYear: number | null; lifetimeDays: number | null } }` (totals in EUR numbers, computed in cents internally)

- [ ] **Step 1: Write the failing tests.** Fixture helper: an account, an envelope, `expenseTx(amount)` = recordTransaction with postings `[{envelopeId, debit: amount}, {accountId, credit: amount}]`; `transferTx(amount)` = `[{accountId: a1, debit}, {accountId: a2, credit}]`. Cases:
  1. Tier-2 link on an expense counts: item with `purchasePrice: 599`, `purchaseDate` 2 years back; repair link 180 → totals: capital 599, tier2 180, total 779, `perYear ≈ 779 / 2` (assert within 1 EUR).
  2. `transactions.amount` lies (record expense with postings 50/50 but `amount: 999`) → tier2 uses 50.
  3. Transfer-shaped transaction (account→account): `createItemCost(kind 'repair')` → `NOT_A_COST`; as `kind: 'purchase'` → allowed (provenance-exempt). Envelope-to-envelope reallocation (`[{envelopeA, debit}, {envelopeB, credit}]`, no account posting): repair link → `NOT_A_COST` too (costSize requires an account posting).
  4. Duplicate `(transactionId, itemId)` → `DUPLICATE_LINK`; second `purchase` link on same item (different tx) → `DUPLICATE_LINK` (partial unique).
  5. Decommissioned item: `repair` link → `ITEM_DECOMMISSIONED`; `disposal` link → allowed.
  6. Recurring: bill with `inventoryItemId`, paid occurrence linked to an expense of 12 → recurring 12; the same transaction ALSO tier-2-linked → counted once, attributed to tier2 (totals.tier2 === 12, totals.recurring === 0).
  7. `disposalProceeds: 150` reduces total; item without `purchaseDate` → `perYear: null`, `lifetimeDays: null`.

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement `item-costs.ts`**:

```ts
import { db } from '../../db/index.js';
import { feohItemCosts, recurringBills, recurringOccurrences, transactions, postings, type FeohItemCost, type Transaction, type RecurringBill } from './schema.js';
import { inventoryItems, type InventoryItem } from '../inventory/schema.js';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export type CostKind = 'purchase' | 'disposal' | 'repair' | 'maintenance' | 'accessory';
const TIER2: CostKind[] = ['repair', 'maintenance', 'accessory'];

const toCents = (s: string | null): number => (s == null ? 0 : Math.round(Number(s) * 100));

/** Spec: cost size = sum of debits over ENVELOPE postings, but only when the
 *  transaction also has an ACCOUNT posting (the feoh expense shape:
 *  envelope debit / account credit). Account-to-account transfers (no
 *  envelope posting) and envelope-to-envelope reallocations (no account
 *  posting) both yield 0. */
async function costSizeCents(transactionId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT coalesce(sum(debit), 0) AS c FROM postings
    WHERE transaction_id = ${transactionId}::uuid AND envelope_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM postings a
                  WHERE a.transaction_id = ${transactionId}::uuid AND a.account_id IS NOT NULL)
  `) as unknown as Array<{ c: string }>;
  return toCents(rows[0]!.c);
}

export async function createItemCost(i: { transactionId: string; itemId: string; kind: CostKind }): Promise<FeohItemCost> {
  const [txn] = await db.select().from(transactions).where(eq(transactions.id, i.transactionId)).limit(1);
  if (!txn) throw new Error('NOT_FOUND_TRANSACTION');
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, i.itemId)).limit(1);
  if (!item) throw new Error('NOT_FOUND_ITEM');
  if (item.decommissionedAt && i.kind !== 'disposal') throw new Error('ITEM_DECOMMISSIONED');
  if (TIER2.includes(i.kind) && (await costSizeCents(i.transactionId)) === 0) throw new Error('NOT_A_COST');
  try {
    const [row] = await db.insert(feohItemCosts).values(i).returning();
    return row!;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '23505') {
      throw new Error('DUPLICATE_LINK');
    }
    throw e;
  }
}

export async function deleteItemCost(id: string): Promise<FeohItemCost | null> {
  const [row] = await db.delete(feohItemCosts).where(eq(feohItemCosts.id, id)).returning();
  return row ?? null;
}

export interface ItemCostsBreakdown {
  item: InventoryItem;
  links: Array<FeohItemCost & { transaction: Transaction }>;
  recurringBills: RecurringBill[];
  totals: { capital: number; tier2: number; recurring: number; proceeds: number; total: number; perYear: number | null; lifetimeDays: number | null };
}

export async function getItemCosts(itemId: string): Promise<ItemCostsBreakdown | null> {
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).limit(1);
  if (!item) return null;

  const linkRows = await db.select().from(feohItemCosts)
    .innerJoin(transactions, eq(feohItemCosts.transactionId, transactions.id))
    .where(eq(feohItemCosts.itemId, itemId));
  const links = linkRows.map((r) => ({ ...r.feoh_item_costs, transaction: r.transactions }));

  const bills = await db.select().from(recurringBills).where(eq(recurringBills.inventoryItemId, itemId));
  const billIds = bills.map((b) => b.id);
  const paidTxIds = billIds.length
    ? (await db.select({ txId: recurringOccurrences.transactionId }).from(recurringOccurrences)
        .where(and(inArray(recurringOccurrences.billId, billIds), isNotNull(recurringOccurrences.transactionId))))
        .map((r) => r.txId!)
    : [];

  // Dedup by transactionId per item: tier2 attribution wins over recurring.
  const source = new Map<string, 'tier2' | 'recurring'>();
  for (const txId of paidTxIds) source.set(txId, 'recurring');
  for (const l of links) if (TIER2.includes(l.kind as CostKind)) source.set(l.transactionId, 'tier2');

  let tier2 = 0, recurring = 0;
  for (const [txId, bucket] of source) {
    const size = await costSizeCents(txId);
    if (bucket === 'tier2') tier2 += size; else recurring += size;
  }

  const capital = toCents(item.purchasePrice);
  const proceeds = toCents(item.disposalProceeds);
  const total = capital + tier2 + recurring - proceeds;

  let lifetimeDays: number | null = null;
  if (item.purchaseDate) {
    const end = item.decommissionedAt ?? new Date().toISOString().slice(0, 10);
    lifetimeDays = Math.round((Date.parse(end) - Date.parse(item.purchaseDate)) / 86_400_000);
  }
  const perYear = lifetimeDays != null && lifetimeDays >= 1 ? total / (lifetimeDays / 365.25) : null;

  const eur = (c: number) => c / 100;
  return {
    item, links, recurringBills: bills,
    totals: {
      capital: eur(capital), tier2: eur(tier2), recurring: eur(recurring), proceeds: eur(proceeds),
      total: eur(total), perYear: perYear != null ? Math.round(perYear) / 100 : null, lifetimeDays,
    },
  };
}
```

- [ ] **Step 4: Run** — `npm run typecheck && npm test -- feoh-item-costs`: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(feoh): item cost links and TCO computation"`.

### Task 11: Item-costs routes + MCP

**Files:**
- Modify: `src/modules/feoh/routes.ts`, `src/modules/feoh/validators.ts`, `src/modules/feoh/mcp.ts`
- Test: `tests/feoh-item-cost-routes.test.ts`; Modify: `tests/mcp-server.test.ts`

**Interfaces:**
- Consumes: Task 10 verbatim. Produces REST `GET /api/v1/feoh/item-costs/:itemId`, `POST /api/v1/feoh/item-costs`, `DELETE /api/v1/feoh/item-costs/:id`; MCP `feoh.get_item_costs`, `feoh.link_item_cost`.

- [ ] **Step 1: Validator** — `export const createItemCostSchema = z.object({ transactionId: z.string().uuid(), itemId: z.string().uuid(), kind: z.enum(['purchase', 'disposal', 'repair', 'maintenance', 'accessory']) });`

- [ ] **Step 2: Failing route tests** — GET breakdown 200 / unknown item 404; POST 201; POST duplicate 409 `DUPLICATE_LINK`; POST transfer as repair 400 `NOT_A_COST`; POST repair on decommissioned 409 `ITEM_DECOMMISSIONED`; DELETE 200/404; child 403.

- [ ] **Step 3: Routes** (same error-map idiom as Task 9):

```ts
import * as itemCosts from './item-costs.js';

const COST_ERRORS: Record<string, [string, string, number]> = {
  NOT_FOUND_TRANSACTION: ['NOT_FOUND', 'Transaction not found', 404],
  NOT_FOUND_ITEM: ['NOT_FOUND', 'Item not found', 404],
  ITEM_DECOMMISSIONED: ['ITEM_DECOMMISSIONED', 'Only disposal links are allowed on a decommissioned item', 409],
  NOT_A_COST: ['NOT_A_COST', 'Transaction has no envelope spending - transfers cannot be item costs', 400],
  DUPLICATE_LINK: ['DUPLICATE_LINK', 'This link already exists (or purchase/disposal already linked)', 409],
};

feohRouter.get('/item-costs/:itemId', async (c) => {
  const breakdown = await itemCosts.getItemCosts(c.req.param('itemId'));
  if (!breakdown) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, breakdown);
});
feohRouter.post('/item-costs', canWrite, async (c) => {
  const body = createItemCostSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try { return ok(c, await itemCosts.createItemCost(body.data), undefined, 201); }
  catch (e: unknown) {
    const m = e instanceof Error ? COST_ERRORS[e.message] : undefined;
    if (m) return err(c, m[0], m[1], m[2] as 400);
    throw e;
  }
});
feohRouter.delete('/item-costs/:id', canWrite, async (c) => {
  const row = await itemCosts.deleteItemCost(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Link not found', 404);
  return ok(c, { id: row.id });
});
```

MCP: `feoh.get_item_costs` (input `{ itemId: z.string().uuid() }`, returns the breakdown or `toolError('Item not found')`); `feoh.link_item_cost` (write-gated + quarantine, maps the same errors to `toolError`).

- [ ] **Step 4: Run + commit** — `git commit -m "feat(feoh): item cost REST routes and MCP tools"`.

---

## Phase 5 — Ledger & Kassensturz

### Task 12: Account ledger

**Files:**
- Create: `src/modules/feoh/ledger.ts`; Modify: `src/modules/feoh/routes.ts`, `validators.ts`, `mcp.ts`
- Test: `tests/feoh-ledger.test.ts`

**Interfaces:**
- Produces (consumed by Task 13, 17):
  - `getAccountLedger(accountId: string, q: { from?: string; to?: string; limit?: number; offset?: number }): Promise<null | { entries: LedgerEntry[]; meta: { total: number; limit: number; offset: number; openingBalance: number; endBalance: number } }>` with `LedgerEntry = { transactionId: string; date: string; payee: string; memo: string | null; delta: number; balance: number }` (EUR numbers)
  - `ledgerBalanceCents(accountId: string, throughDate: string): Promise<number>` (opening + Σ deltas with `date <= throughDate`)
  - REST `GET /api/v1/feoh/accounts/:id/ledger`; MCP `feoh.account_ledger`

- [ ] **Step 1: Failing tests** — seed account (openingBalance 100) + envelope; three expense/income transactions across three dates (one date shared by two transactions to exercise the tie-break). Assert: full list balances run 100 → … correctly; `limit=1&offset=1` returns the middle entry with the SAME balance it had in the full listing (the window-function requirement); `from` filter keeps correct balances; `endBalance` = balance through `to` (or all); unknown account → 404 at the route.

- [ ] **Step 2: Implement `ledger.ts`** — one raw-SQL window query (per spec):

```ts
import { db } from '../../db/index.js';
import { accounts } from './schema.js';
import { eq, sql } from 'drizzle-orm';

export interface LedgerEntry { transactionId: string; date: string; payee: string; memo: string | null; delta: number; balance: number }

const toCents = (s: string | number | null): number => (s == null ? 0 : Math.round(Number(s) * 100));

export async function getAccountLedger(accountId: string, q: { from?: string; to?: string; limit?: number; offset?: number }) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) return null;
  const opening = toCents(account.openingBalance);
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);

  // Per-transaction delta on this account, running balance over the FULL
  // history (window computed before from/offset filtering so page N balances
  // are correct), deterministic (date, created_at, id) order.
  const rows = await db.execute(sql`
    WITH entries AS (
      SELECT t.id AS transaction_id, t.date, t.payee, t.memo, t.created_at,
             sum(p.debit - p.credit) AS delta
      FROM postings p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.account_id = ${accountId}::uuid
      GROUP BY t.id, t.date, t.payee, t.memo, t.created_at
    ), running AS (
      SELECT *, sum(delta) OVER (ORDER BY date, created_at, transaction_id
                                 ROWS UNBOUNDED PRECEDING) AS cum
      FROM entries
    )
    SELECT transaction_id, date, payee, memo, delta, cum
    FROM running
    WHERE (${q.from ?? null}::date IS NULL OR date >= ${q.from ?? null}::date)
      AND (${q.to ?? null}::date IS NULL OR date <= ${q.to ?? null}::date)
    ORDER BY date, created_at, transaction_id
    LIMIT ${limit} OFFSET ${offset}`) as unknown as Array<Record<string, unknown>>;

  // Separate filtered count: a window count(*) OVER () would report 0 for an
  // empty page past the end, breaking pagination meta.
  const countRows = await db.execute(sql`
    SELECT count(DISTINCT t.id)::int AS total
    FROM postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.account_id = ${accountId}::uuid
      AND (${q.from ?? null}::date IS NULL OR t.date >= ${q.from ?? null}::date)
      AND (${q.to ?? null}::date IS NULL OR t.date <= ${q.to ?? null}::date)`) as unknown as Array<{ total: number }>;
  const total = countRows[0]!.total;

  const endRows = await db.execute(sql`
    SELECT coalesce(sum(p.debit - p.credit), 0) AS s
    FROM postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.account_id = ${accountId}::uuid
      AND (${q.to ?? null}::date IS NULL OR t.date <= ${q.to ?? null}::date)`) as unknown as Array<{ s: string }>;
  const endBalance = opening + toCents(endRows[0]!.s);

  const entries: LedgerEntry[] = rows.map((r) => ({
    transactionId: String(r['transaction_id']),
    date: String(r['date']).slice(0, 10),
    payee: String(r['payee']),
    memo: r['memo'] == null ? null : String(r['memo']),
    delta: toCents(r['delta'] as string) / 100,
    balance: (opening + toCents(r['cum'] as string)) / 100,
  }));
  return { entries, meta: { total, limit, offset, openingBalance: opening / 100, endBalance: endBalance / 100 } };
}

export async function ledgerBalanceCents(accountId: string, throughDate: string): Promise<number> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new Error('NOT_FOUND_ACCOUNT');
  const rows = await db.execute(sql`
    SELECT coalesce(sum(p.debit - p.credit), 0) AS s
    FROM postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.account_id = ${accountId}::uuid AND t.date <= ${throughDate}::date`) as unknown as Array<{ s: string }>;
  return toCents(account.openingBalance) + toCents(rows[0]!.s);
}
```

`total` comes from its own filtered count query (a `count(*) OVER ()` in the page query would report 0 for an empty page past the end).

Route (query schema reuses `listTransactionsQuerySchema`):

```ts
feohRouter.get('/accounts/:id/ledger', async (c) => {
  const q = listTransactionsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const ledger = await getAccountLedger(c.req.param('id'), q.data);
  if (!ledger) return err(c, 'NOT_FOUND', 'Account not found', 404);
  return ok(c, ledger.entries, ledger.meta);
});
```

MCP `feoh.account_ledger`: input `{ accountId: uuid, from?, to? }`, returns `result(ledger)` or `toolError('Account not found')`. Read-only — no write gate.

- [ ] **Step 3: Run + commit** — `git commit -m "feat(feoh): per-account ledger with running balance"`.

### Task 13: Kassensturz reconciliation

**Files:**
- Modify: `src/modules/feoh/ledger.ts` (add `reconcileAccount`), `routes.ts`, `validators.ts`
- Test: `tests/feoh-reconcile.test.ts`

**Interfaces:**
- Consumes: `ledgerBalanceCents` (Task 12), `recordTransaction` (existing).
- Produces: `reconcileAccount(accountId, i: { countedBalance: number; date: string; envelopeId: string; memo?: string | null }, createdBy: string)` → `{ difference: number; transaction: TransactionDetail | null }`; throws `NOT_FOUND_ACCOUNT` / `ACCOUNT_NOT_ASSET` / `DATE_IN_FUTURE` / `LATER_TRANSACTIONS_EXIST`. REST `POST /api/v1/feoh/accounts/:id/reconcile`.

- [ ] **Step 1: Failing tests** — cash asset account, envelope "Sonstiges": (a) counted > ledger books `Kassensturz` transaction with account-debit/envelope-credit, response difference positive, ledger balance now equals counted; (b) counted < ledger books the mirrored posting shape; (c) difference 0 → `transaction: null`, no new transaction row; (d) posting dated between `date` and today → 409 `LATER_TRANSACTIONS_EXIST`; (e) FUTURE-dated posting does NOT block reconciling today; (f) liability account → 400 `ACCOUNT_NOT_ASSET`; (g) `date` in the future → 400.

- [ ] **Step 2: Implement** in `ledger.ts`:

```ts
import { recordTransaction } from './service.js';

export async function reconcileAccount(
  accountId: string,
  i: { countedBalance: number; date: string; envelopeId: string; memo?: string | null },
  createdBy: string,
) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new Error('NOT_FOUND_ACCOUNT');
  if (account.kind !== 'asset') throw new Error('ACCOUNT_NOT_ASSET');
  // Server-LOCAL calendar date (spec) — toISOString() would be UTC and
  // misclassify dates around local midnight.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (i.date > today) throw new Error('DATE_IN_FUTURE');

  // Postings in (date, today] would be silently shifted by a past adjustment.
  // Future-dated postings (> today) are not in the counted wallet: exempt.
  const later = await db.execute(sql`
    SELECT 1 FROM postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.account_id = ${accountId}::uuid AND t.date > ${i.date}::date AND t.date <= ${today}::date
    LIMIT 1`) as unknown as unknown[];
  if (later.length > 0) throw new Error('LATER_TRANSACTIONS_EXIST');

  const ledgerCents = await ledgerBalanceCents(accountId, i.date);
  const countedCents = Math.round(i.countedBalance * 100);
  const diffCents = countedCents - ledgerCents;
  if (diffCents === 0) return { difference: 0, transaction: null };

  const abs = Math.abs(diffCents) / 100;
  const txn = await recordTransaction({
    date: i.date, payee: 'Kassensturz', memo: i.memo ?? null, amount: abs,
    postings: diffCents > 0
      ? [{ accountId, envelopeId: null, debit: abs, credit: 0 }, { accountId: null, envelopeId: i.envelopeId, debit: 0, credit: abs }]
      : [{ accountId, envelopeId: null, debit: 0, credit: abs }, { accountId: null, envelopeId: i.envelopeId, debit: abs, credit: 0 }],
    splits: [],
  }, createdBy);
  return { difference: diffCents / 100, transaction: txn };
}
```

Validator: `export const reconcileSchema = z.object({ countedBalance: z.number().nonnegative(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), envelopeId: z.string().uuid(), memo: z.string().optional().nullable() });`

Route (write-gated like every feoh mutation):

```ts
feohRouter.post('/accounts/:id/reconcile', canWrite, async (c) => {
  const body = reconcileSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try { return ok(c, await reconcileAccount(c.req.param('id'), body.data, c.get('auth').userId)); }
  catch (e: unknown) {
    if (e instanceof Error && e.message === 'NOT_FOUND_ACCOUNT') return err(c, 'NOT_FOUND', 'Account not found', 404);
    if (e instanceof Error && e.message === 'ACCOUNT_NOT_ASSET') return err(c, 'ACCOUNT_NOT_ASSET', 'Only asset accounts can be reconciled', 400);
    if (e instanceof Error && e.message === 'DATE_IN_FUTURE') return err(c, 'VALIDATION_ERROR', 'Reconcile date must not be in the future', 400);
    if (e instanceof Error && e.message === 'LATER_TRANSACTIONS_EXIST') return err(c, 'LATER_TRANSACTIONS_EXIST', 'Transactions exist after the reconcile date - reconcile with a current date', 409);
    throw e;
  }
});
```

(No MCP tool — spec keeps reconciliation REST/UI-only in v1.)

- [ ] **Step 3: Run full backend suite** — `npm run typecheck && npm test`: ALL green (this closes the backend).
- [ ] **Step 4: Commit** — `git commit -m "feat(feoh): Kassensturz account reconciliation"`.

---

## Phase 6 — Web UI

### Task 14: Web types, API clients, query keys

**Files:**
- Modify: `web/src/lib/types.ts` (add `InventoryItem`, `OccurrenceEntry`, `ItemCostsBreakdown`, `LedgerEntry`, `LedgerMeta`; extend `RecurringBill` with `inventoryItemId: string | null`), `web/src/lib/constants.ts` (extend the existing `QUERY_KEYS` object — there is NO separate query-keys file — with `inventory`, `occurrences`, `itemCosts`, `ledger` entries in its established `['name'] as const` shape)
- Create: `web/src/api/inventory.ts`; Modify: `web/src/api/feoh.ts`
- Test: covered by page tests (Tasks 15–17) — this task is types+fetchers only, verified by `npm run build`

**Interfaces:**
- Produces (consumed by Tasks 15–17):
  - `api/inventory.ts`: `listItems(params)`, `createItem(input)`, `getItem(id)`, `updateItem(id, input)`, `decommissionItem(id, input)`, `deleteItem(id)` — same `apiGet`/`apiPost`/`apiPatch`/`apiDelete` + `qs` idiom as `api/feoh.ts`
  - `api/feoh.ts` additions: `listOccurrences(params)`, `linkOccurrence(input)`, `skipOccurrence(input)`, `unlinkOccurrence(input)`, `unskipOccurrence(input)`, `overrideOccurrence(input)`, `getItemCosts(itemId)`, `createItemCost(input)`, `deleteItemCost(id)`, `getAccountLedger(id, params)`, `reconcileAccount(id, input)`
  - `BillInput.cadence` narrows to `'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'`; gains `inventoryItemId?: string | null`

- [ ] **Step 1: Write the types** mirroring the backend interfaces from Tasks 4/8/10/12 exactly. Numeric typing rule: fields that come from raw Drizzle rows serialize as strings — so `InventoryItem.purchasePrice` / `disposalProceeds` and `RecurringBill.amount` are `string | null` (match how `types.ts` already types `Account`/`Transaction` numerics); computed DTO numbers stay `number` (`OccurrenceEntry.expectedAmount`/`overrideAmount`, everything in `ItemCostsBreakdown.totals`, `LedgerEntry.delta`/`balance`, ledger meta balances).
- [ ] **Step 2: Write the fetchers** (one line per endpoint, `api/feoh.ts` style — see its lines 16–38 for the exact idiom).
- [ ] **Step 3: Verify** — `cd web && npm run build` (or the repo's typecheck script) green; nothing renders yet.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): inventory/occurrence/ledger API clients and types"`.

### Task 15: Inventory page + navigation + i18n

**Files:**
- Create: `web/src/pages/inventory.tsx`, `web/src/components/inventory/item-form.tsx`, `web/src/components/inventory/item-detail.tsx`, `web/src/components/inventory/decommission-dialog.tsx`
- Modify: `web/src/app.tsx` (route), `web/src/components/layout/sidebar.tsx` + `mobile-nav.tsx` (nav item `nav.inventory`), `web/src/components/layout/app-shell.tsx` (heading map), `web/src/i18n/locales/en.json` + `de.json`
- Test: `web/src/pages/inventory.test.tsx`

**Interfaces:**
- Consumes: Task 14 clients. Produces the `/inventory` route.

- [ ] **Step 1: Add i18n strings** — MERGE `"inventory"` into the EXISTING top-level `nav` object (do not replace `nav`), and add a new top-level `inventory` object, in `en.json` and `de.json` (write both now, the German test in Task 18 asserts them):

```json
"nav": { "inventory": "Inventory" },
"inventory": {
  "title": "Inventory",
  "addItem": "Add item",
  "search": "Search items",
  "filterAll": "All", "filterActive": "Active", "filterDecommissioned": "Decommissioned",
  "fields": { "name": "Name", "category": "Category", "manufacturer": "Manufacturer", "model": "Model", "serialNumber": "Serial number", "location": "Location", "notes": "Notes", "warrantyUntil": "Warranty until", "purchasePrice": "Purchase price", "purchaseDate": "Purchase date" },
  "lifecycle": { "purchased": "Purchased {{date}} for {{price}}", "warranty": "Warranty until {{date}}", "decommissioned": "Decommissioned {{date}} ({{reason}})" },
  "reasons": { "broken": "Broken", "sold": "Sold", "given_away": "Given away", "worn_out": "Worn out", "lost": "Lost", "other": "Other" },
  "decommission": { "action": "Decommission", "date": "Date", "reason": "Reason", "proceeds": "Sale proceeds", "linkSale": "Link sale transaction", "linkFailed": "Item decommissioned, but linking the transaction failed - retry from the item page." },
  "tco": { "title": "Cost of ownership", "capital": "Purchase", "tier2": "Repairs & parts", "recurring": "Recurring costs", "proceeds": "Proceeds", "total": "Total", "perYear": "Per year", "linkExpense": "Link expense", "kind": { "purchase": "Purchase", "disposal": "Disposal", "repair": "Repair", "maintenance": "Maintenance", "accessory": "Accessory" } },
  "empty": "No items yet."
}
```

(German: `"Inventar"`, `"Gegenstand hinzufügen"`, `"Gegenstände durchsuchen"`, `"Alle"/"Aktiv"/"Ausgemustert"`, fields `"Name"/"Kategorie"/"Hersteller"/"Modell"/"Seriennummer"/"Ort"/"Notizen"/"Garantie bis"/"Kaufpreis"/"Kaufdatum"`, lifecycle `"Gekauft am {{date}} für {{price}}"` / `"Garantie bis {{date}}"` / `"Ausgemustert am {{date}} ({{reason}})"`, reasons `"Defekt"/"Verkauft"/"Verschenkt"/"Verschlissen"/"Verloren"/"Sonstiges"`, decommission `"Ausmustern"/"Datum"/"Grund"/"Verkaufserlös"/"Verkaufsbuchung verknüpfen"/"Gegenstand ausgemustert, aber die Verknüpfung der Buchung schlug fehl – vom Gegenstand aus erneut versuchen."`, tco `"Betriebskosten"/"Anschaffung"/"Reparaturen & Teile"/"Laufende Kosten"/"Erlöse"/"Gesamt"/"Pro Jahr"/"Ausgabe verknüpfen"` with kinds `"Kauf"/"Verkauf"/"Reparatur"/"Wartung"/"Zubehör"`, empty `"Noch keine Gegenstände."`)

- [ ] **Step 2: Write failing page tests** — follow `web/src/pages/library.test.tsx` bootstrap (query-client wrapper, api mocks). Cases: renders list from mocked `listItems`; status filter refetches with `status=decommissioned`; opening an item shows the TCO panel from mocked `getItemCosts` (assert "Per year" value rendered); decommission dialog submits `decommissionItem` then `createItemCost` in that order when a sale transaction is picked, and shows `inventory.decommission.linkFailed` when the second call rejects (first still succeeded); create form posts `createItem`.

- [ ] **Step 3: Run to verify failure**, then **Step 4: build the page**. Structure (mirror `library.tsx` composition style):
  - `inventory.tsx`: search input + status filter chips + item grid/list (name, category, location, lifecycle line) + "Add item" button opening `item-form`; clicking an item opens `item-detail`.
  - `item-detail.tsx`: fields, lifecycle line (`inventory.lifecycle.*`), TCO panel (`useQuery(getItemCosts)` — render capital/tier2/recurring/proceeds/total/perYear rows + the `links` list with kind chips), "Link expense" action (transaction picker: `listTransactions` recent 20, kind select), decommission button opening `decommission-dialog`, delete (with 409 `HAS_FINANCE_LINKS` toast).
  - `decommission-dialog.tsx`: date (default today), reason select (`inventory.reasons.*`), proceeds input, optional transaction picker; submit = `decommissionItem` → on success, if a transaction was picked `createItemCost({ kind: 'disposal' })`, non-fatal on failure (toast `linkFailed`, item stays decommissioned); prefill proceeds from picked transaction amount client-side.
  - `item-form.tsx`: create/edit form over `createItemSchema` fields.
  - Wiring: route in `app.tsx`, nav item in `sidebar.tsx`/`mobile-nav.tsx` (icon: `Package` from lucide, next to the other items), heading in `app-shell.tsx`'s map.

- [ ] **Step 5: Run** — `cd web && npm test -- inventory` PASS, full `npm test` green.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): inventory page with lifecycle and TCO panel"`.

### Task 16: Occurrence-aware bills section

**Files:**
- Modify: `web/src/components/feoh/bills-list.tsx`, `web/src/pages/feoh.tsx` (pass-through), `web/src/i18n/locales/en.json` + `de.json`
- Create: `web/src/components/feoh/occurrence-strip.tsx`
- Test: `web/src/components/feoh/occurrence-strip.test.tsx` (+ adjust existing feoh page test)

**Interfaces:**
- Consumes: Task 14's `listOccurrences`/`linkOccurrence`/`skipOccurrence`/`overrideOccurrence`; `BillInput.cadence` enum.

- [ ] **Step 1: i18n** — under the existing `feoh` key add:

```json
"occurrences": {
  "overdueBadge": "{{count}} overdue",
  "status": { "planned": "Planned", "paid": "Paid", "overdue": "Overdue", "skipped": "Skipped", "unknown": "Cadence unknown - edit the bill" },
  "link": "Book", "skip": "Skip", "unskip": "Unskip", "unlink": "Unlink", "override": "Adjust amount",
  "pickTransaction": "Pick the settling transaction"
},
"cadence": { "weekly": "Weekly", "monthly": "Monthly", "quarterly": "Quarterly", "semiannual": "Every 6 months", "yearly": "Yearly" }
```

(German: `"{{count}} überfällig"`, status `"Geplant"/"Bezahlt"/"Überfällig"/"Übersprungen"/"Turnus unbekannt – Dauerauftrag bearbeiten"`, actions `"Buchen"/"Überspringen"/"Wieder aufnehmen"/"Verknüpfung lösen"/"Betrag anpassen"`, picker `"Ausgleichende Buchung wählen"`, cadence `"Wöchentlich"/"Monatlich"/"Vierteljährlich"/"Halbjährlich"/"Jährlich"`.) Bill form cadence input becomes a select over the five enum values labeled with `feoh.cadence.*` (replaces free text / the `P1M` constants — check `web/src/lib/constants.ts:83-86` recurrence options are calendar-event options, NOT bill options; do not touch them).

- [ ] **Step 2: Failing component tests** — `occurrence-strip.tsx` given a bill id: renders next N occurrences from mocked `listOccurrences` with status chips; "Book" opens transaction picker and calls `linkOccurrence`; "Skip" calls `skipOccurrence`; "Adjust amount" opens an amount prompt and calls `overrideOccurrence` (and calls it with `amount: null` to clear an existing override); `status: 'unknown'` entry renders the unknown label and no action buttons; section header shows the overdue badge count.

- [ ] **Step 3: Implement** — `occurrence-strip.tsx` (per-bill: `useQuery(listOccurrences({ billId }))`, slice to the first 4 by dueDate, chips + action buttons — Book, Skip/Unskip, Unlink, Adjust amount (small inline amount input, submit → `overrideOccurrence`, clear → `amount: null`) — each a `useMutation` invalidating the occurrences key); `bills-list.tsx` embeds the strip under each bill row and shows the aggregate overdue badge (one `listOccurrences({ status: 'overdue' })` query at section level).

- [ ] **Step 4: Run** — `cd web && npm test` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): occurrence-aware bills section"`.

### Task 17: Accounts panel with ledger + Kassensturz

**Files:**
- Create: `web/src/components/feoh/accounts-panel.tsx`, `web/src/components/feoh/ledger-view.tsx`, `web/src/components/feoh/reconcile-dialog.tsx`
- Modify: `web/src/pages/feoh.tsx` (mount the panel), `web/src/i18n/locales/en.json` + `de.json`
- Test: `web/src/components/feoh/accounts-panel.test.tsx`

**Interfaces:**
- Consumes: Task 14's `listAccounts` (exists), `getAccountLedger`, `reconcileAccount`, `listEnvelopes`.

- [ ] **Step 1: i18n** — under `feoh`:

```json
"accounts": {
  "title": "Accounts", "balance": "Balance", "ledger": "Ledger", "openingBalance": "Opening balance",
  "reconcile": "Kassensturz", "counted": "Counted amount", "bookedAs": "Book difference to",
  "noDifference": "Counts match - nothing to book.", "difference": "Difference: {{amount}}",
  "laterTransactions": "There are newer transactions - reconcile with today's date."
}
```

(German: `"Konten"/"Saldo"/"Kontobuch"/"Anfangssaldo"/"Kassensturz"/"Gezählter Betrag"/"Differenz buchen auf"/"Zählung stimmt – nichts zu buchen."/"Differenz: {{amount}}"/"Es gibt neuere Buchungen – mit dem heutigen Datum abgleichen."`)

- [ ] **Step 2: Failing tests** — accounts panel lists accounts with `endBalance` from mocked ledger meta; opening an account renders ledger rows (date, payee, delta, running balance); the Kassensturz button appears ONLY on `kind === 'asset'` accounts; submitting the reconcile dialog calls `reconcileAccount` and renders `noDifference` when the response difference is 0; a 409 error response renders `laterTransactions`.

- [ ] **Step 3: Implement** — `accounts-panel.tsx` (list + expand-to-ledger); `ledger-view.tsx` (paginated table via `getAccountLedger`, `limit=50`, load-more by offset); `reconcile-dialog.tsx` (counted amount, date defaulting to today, envelope select from `listEnvelopes`, memo; result banner). Mount the panel on `feoh.tsx` below the bills section.

- [ ] **Step 4: Run** — `cd web && npm test` green. **Step 5: Commit** — `git commit -m "feat(web): accounts panel with ledger and Kassensturz"`.

### Task 18: German locale test + full verification

**Files:**
- Create: `web/src/pages/inventory.de.test.tsx` (mirror `hearth.de.test.tsx` bootstrap: i18n forced to `de`)
- Test: full suites

**Interfaces:** none new — this is the closing gate.

- [ ] **Step 1: Write the German assertions** — render the inventory page and item detail with mocked data in `de`; assert visible strings: `"Inventar"`, `"Gegenstand hinzufügen"`, `"Ausmustern"`, `"Betriebskosten"`, `"Pro Jahr"`; render the bills strip and assert `"Überfällig"` and `"Kassensturz"` (accounts panel). Any string that fails because a `de.json` key is missing gets fixed in `de.json`, not by weakening the test.

- [ ] **Step 2: Run the full verification battery**

```bash
npm run typecheck && npm run build && npm test     # backend: expect ~330+ tests green
cd web && npm test                                  # web suite green
grep -r FEOH_ENABLED src tests web/src || echo CLEAN   # expect CLEAN
```

- [ ] **Step 3: Commit** — `git commit -m "test(web): German locale assertions for inventory, occurrences, ledger"`.

---

## Self-review checklist (ran while writing)

- Spec coverage: gate removal (T1–2), inventory schema/service/routes/MCP (T3–6), cadence+occurrences+routes+MCP (T7–9), item costs/TCO+routes+MCP (T10–11), ledger+reconcile (T12–13), web thin UI + i18n + German test (T14–18). Spec's "out of scope" items have no tasks — correct.
- Error-code parity with the spec: `ALREADY_DECOMMISSIONED`, `DISPOSAL_LINK_EXISTS`, `HAS_FINANCE_LINKS`, `NOT_AN_OCCURRENCE`, `ALREADY_PAID`, `ALREADY_SKIPPED`, `BILL_HAS_HISTORY`, `ITEM_DECOMMISSIONED`, `NOT_A_COST`, `DUPLICATE_LINK`, `ACCOUNT_NOT_ASSET`, `LATER_TRANSACTIONS_EXIST` — all present exactly once each in their owning task.
- Type consistency: `OccurrenceEntry`, `ItemCostsBreakdown`, `LedgerEntry` defined in Tasks 8/10/12 and consumed by name in Tasks 9/11/14–17.
