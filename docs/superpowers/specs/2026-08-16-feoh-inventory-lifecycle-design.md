# Feoh Extension: Recurring Occurrences, Inventory & Lifecycle Costs, Cash Ledger — Design

**Date:** 2026-08-16
**Status:** Reviewed (Codex review 2026-08-16 incorporated)

## Goal

Three connected features:

1. **Recurring-expense occurrences** — turn `recurring_bills` from a flat
   "next due" pointer into a template that projects expected occurrences
   (planned / paid / overdue / skipped), each linkable to the transaction that
   settled it.
2. **Inventory & lifecycle costs** — a standalone household inventory module
   (appliances, tools, …) tracking each item from purchase to
   breakage/sale/removal, with feoh-side cost links producing a total cost of
   ownership (TCO) per item.
3. **Cash ledger** — a per-account ledger view (entries + running balance) and
   a *Kassensturz* reconciliation action that books the counted difference as
   a normal adjustment transaction.

Plus one structural change: **feoh loses its env gate and becomes always-on.**

## Decisions (from grilling, 2026-08-16)

- Inventory is a **standalone, always-on module** (`src/modules/inventory/`).
  Dependency direction is strictly **feoh → inventory**; inventory never
  imports feoh. All finance references to items live on the feoh side.
- Occurrences are **materialized expectations**: projected on read from the
  bill's cadence, persisted only when touched (linked / skipped / amount
  override). Manual linking only in v1 (no auto-matching).
- Purchase/disposal data lives **on the inventory item** (plain fields), so
  pre-feoh items are backfillable. Transaction links are optional and live in
  a feoh-side link table.
- TCO = (purchase + Tier-2 linked costs + booked linked-bill occurrences −
  disposal proceeds) / lifetime. Tier 2 = repairs, spare parts, paid
  maintenance, accessories. Tier 3 (consumables, energy, allocated shares) is
  **out**.
- Lean item model: **one row = one physical object**; no photos, documents,
  quantities, barcodes, loan tracking, or room hierarchy. `warrantyUntil` is
  in; `notes` is the pressure valve.
- Cash ledger = existing asset account + ledger view + Kassensturz. No new
  account concept.
- Thin-but-full-stack: REST + web UI + MCP for all three features.

## Feoh gate removal

- Delete `FEOH_ENABLED` from `src/config/env.ts` (schema + `config.feohEnabled`).
- `feohModule.register` always mounts routes and MCP tools (drop the
  `config.feohEnabled` guard and update the ADR-0007 comment).
- `GET /api/v1/features` (`src/routes/features.ts`) reports `finance:
  config.feohEnabled` today — becomes hardcoded `finance: true` (the key is
  `finance`, not `feoh`); the web nav shows Finance unconditionally and
  `useFinanceEnabled` can be simplified or removed.
- Delete `tests/feoh-gating.test.ts`; remove the `FEOH_ENABLED` env setup
  from ALL feoh tests (bills/mcp/etc. set it today); `tests/features.test.ts`
  expects `finance: true`; MCP/server tests expect feoh tools always
  registered.
- This is a behavior change for deployments that relied on off-by-default;
  called out in the changelog/commit message.

---

## Part 1 — Inventory module (`src/modules/inventory/`)

New always-on `HeorthModule` (schema, service, validators, routes, mcp,
index), registered in `ALL_MODULES`. Schema registered in BOTH
`src/db/schema/drizzle-schema.ts` (no `.js` extensions) and
`src/db/schema/index.ts` (runtime barrel, `.js` extension imports).

### Table `inventory_items`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `createdAt` / `updatedAt` | timestamptz | `now()` |
| `name` | text NOT NULL | |
| `category` | text | free text, no hierarchy |
| `manufacturer` | text | |
| `model` | text | |
| `serialNumber` | text | |
| `location` | text | free text ("Keller-Werkstatt") |
| `notes` | text | |
| `warrantyUntil` | date | |
| `purchasePrice` | numeric(14,2) | nullable — unknown for old items |
| `purchaseDate` | date | nullable |
| `decommissionedAt` | date | null = active |
| `decommissionReason` | text | CHECK: `broken`, `sold`, `given_away`, `worn_out`, `lost`, `other`; NOT NULL when `decommissionedAt` set (table CHECK: both null or both set) |
| `disposalProceeds` | numeric(14,2) | nullable; reduces TCO |

No FK to any feoh table (dependency rule).

### REST `/api/v1/inventory` (all `requireAuth`; writes `requireRole('admin','adult')`)

- `GET /items?status=active|decommissioned&category=&q=&limit=&offset=` —
  list, `q` matches name/manufacturer/model/serial (ILIKE), default sort
  `name`. Paginated like feoh transactions (meta `total/limit/offset`).
- `POST /items` — create (201).
- `GET /items/:id` — single item.
- `PATCH /items/:id` — partial update (may also clear decommission fields to
  reactivate — the admin escape hatch). Reactivation is refused with 409
  `DISPOSAL_LINK_EXISTS` while a feoh `disposal` cost link exists (unlink on
  the feoh side first) — checked by the inventory service via a plain SQL
  existence query (`SELECT 1 FROM feoh_item_costs WHERE item_id = $1 AND
  kind = 'disposal'`; a table-level read does not violate the
  no-module-import rule and is documented as the one sanctioned touchpoint —
  covered by a test so a table rename breaks loudly).
- `POST /items/:id/decommission` — body `{ date, reason, proceeds? }`.
  Sets the three disposal fields. 409 `ALREADY_DECOMMISSIONED` if already
  decommissioned. **No finance parameters** — inventory never touches feoh
  (dependency rule). Linking the sale transaction is a separate feoh call
  (`POST /api/v1/feoh/item-costs`, kind `disposal`); the web decommission
  dialog performs both calls **in that order** (decommission first, then
  link), prefilling `proceeds` client-side from the picked transaction. A
  failed link after a successful decommission is non-fatal: the item is
  decommissioned, the dialog surfaces the link error, and the link can be
  retried any time from the item detail (disposal links are allowed on
  decommissioned items by design).
- `DELETE /items/:id` — hard delete, only for mistakes; blocked with 409
  `HAS_FINANCE_LINKS` when feoh cost links or bill links exist (both FKs —
  `feoh_item_costs.itemId` AND `recurring_bills.inventoryItemId` — are
  `onDelete: 'restrict'`, so the DB backstops the service check). The normal
  end of life is decommission, not delete.

Inventory writes do NOT apply the maintenance-admin quarantine (that is a
finance-mutation guard); role gate only.

### Validators

Zod mirrors of the table, as **two distinct schemas**: `createItemSchema`
rejects all three lifecycle fields (`decommissionedAt` /
`decommissionReason` / `disposalProceeds` — only the decommission endpoint
sets them); `updateItemSchema` additionally accepts the lifecycle group
**only** as explicit `null` for all three at once (the reactivation case) —
partial lifecycle edits (e.g. changing just the reason) are rejected 400;
use decommission again after reactivating to fix mistakes.

### MCP tools

- `inventory.list_items` (filters as REST)
- `inventory.get_item`
- `inventory.record_item` (create)
- `inventory.decommission_item` (inventory fields only — no finance linking,
  same as the REST endpoint)

---

## Part 2 — Lifecycle costs (feoh side)

### Table `feoh_item_costs`

Links feoh transactions to inventory items. This is the ONLY place finance
knows about items — including purchase and disposal links.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `createdAt` | timestamptz | |
| `transactionId` | uuid NOT NULL → `transactions.id` | `onDelete: 'cascade'` |
| `itemId` | uuid NOT NULL → `inventory_items.id` | `onDelete: 'restrict'` |
| `kind` | text NOT NULL | CHECK: `purchase`, `disposal`, `repair`, `maintenance`, `accessory` |

Constraints:

- UNIQUE `(transactionId, itemId)` — one link per pair (the kind
  disambiguates what it is, a pair can't be two kinds at once).
- Partial UNIQUE `(itemId, kind)` WHERE `kind IN ('purchase','disposal')` —
  at most one purchase and one disposal link per item.
- Service guard: linking any kind except `disposal` to a decommissioned item
  → 409 `ITEM_DECOMMISSIONED`.

**Purchase/disposal links are provenance metadata only.** The item's
`purchasePrice` / `disposalProceeds` fields are authoritative for TCO;
linking a purchase or disposal transaction after the fact does NOT rewrite
the item's fields (the web UI may offer to copy the amount over, but that is
an explicit client-side action). This keeps backfilled items and linked
items on one code path.

### `recurring_bills.inventoryItemId`

New nullable column → `inventory_items.id`, `onDelete: 'restrict'`
(consistent with the delete-blocked-while-linked rule — clearing the link is
an explicit bill edit, not a side effect of item deletion). A bill tied to
an item contributes its **booked** occurrences' transactions to the item's
TCO. Projected/unpaid occurrences never count.

### TCO computation (feoh service, `getItemCosts(itemId)`)

```
costSize(t) = Σ debit over t's ENVELOPE postings, but ONLY when t also has at
              least one ACCOUNT posting — the feoh expense shape (envelope
              debit / account credit); matches how month-summary spending is
              defined. Account-to-account transfers (no envelope posting) and
              envelope-to-envelope reallocations (no account posting) both
              have costSize = 0.
capital   = purchasePrice ?? 0
costTx    = distinct transactions per item from BOTH sources:
            tier-2 cost links (kind repair/maintenance/accessory) AND
            transactions linked to PAID occurrences of bills where
            bill.inventoryItemId = itemId
tier2 + recurring = Σ costSize over costTx, attributed to tier2 when a cost
            link exists, else recurring — a transaction in both sources
            counts ONCE (dedup by transactionId per item)
proceeds  = disposalProceeds ?? 0
total     = capital + tier2 + recurring − proceeds
lifetimeDays = (decommissionedAt ?? today) − purchaseDate   (null if no purchaseDate)
perYear   = lifetimeDays >= 1 ? total / (lifetimeDays / 365.25) : null
```

Returned as `{ item, links[], recurringBills[], totals: { capital, tier2,
recurring, proceeds, total, perYear, lifetimeDays } }`. Cost size is derived
from **postings**, not from `transactions.amount` — the latter is
caller-supplied metadata that `recordTransaction` never validates against
the postings, so it cannot anchor money math. Envelope debits (not raw
debits) are used so transfers/reallocations can never inflate TCO. A
transaction linked to multiple items counts fully into each (documented; no
splitting in v1). All money arithmetic in integer cents.

**Link guard:** creating a tier-2 cost link (`repair`/`maintenance`/
`accessory`) against a transaction with `costSize = 0` is rejected 400
`NOT_A_COST` — transfer-shaped transactions cannot be item costs.
`purchase`/`disposal` links are provenance-only and exempt. Occurrence
linking (Part 3) has no such guard — a zero-cost settlement simply
contributes 0 to TCO.

### REST (mounted on the existing feoh router)

- `GET /api/v1/feoh/item-costs/:itemId` — the TCO breakdown above. 404 if
  the item doesn't exist.
- `POST /api/v1/feoh/item-costs` — body
  `{ transactionId, itemId, kind }` → creates a link (201). 409
  `DUPLICATE_LINK` / `ITEM_DECOMMISSIONED` on constraint conflicts.
- `DELETE /api/v1/feoh/item-costs/:id` — unlink.

All feoh mutations keep the existing `canWrite` gate (role +
maintenance-admin quarantine).

### MCP

- `feoh.get_item_costs` (TCO breakdown)
- `feoh.link_item_cost`

---

## Part 3 — Recurring occurrences

### Cadence pinned down

`recurring_bills.cadence` is today free text — and the values actually in
use are **ISO-8601 durations**: the web bill form offers `P1W`/`P1M`/`P1Y`
(`web/src/lib/constants.ts`) and tests store `P1M` (`tests/feoh-bills.test.ts`)
alongside the word `monthly` (`tests/feoh-mcp.test.ts`). New write
validation: `z.enum(['weekly','monthly','quarterly','semiannual','yearly'])`.
Migration normalizes existing rows on `lower(trim(cadence))`:

- ISO durations: `p1w`→weekly, `p1m`→monthly, `p3m`→quarterly,
  `p6m`→semiannual, `p1y`→yearly
- English: `weekly/monthly/quarterly/semiannual/semi-annual/yearly/annual`
- German: `wöchentlich/monatlich/quartalsweise/vierteljährlich/halbjährlich/jährlich`

The web bill form's cadence options switch to the enum values (labels via
i18n). Unrecognized stored values are left as-is; such bills get no
projections and are flagged (see listing below). No silent rewrites of
unknown data.

### Projection semantics

- Anchor = the bill's `nextDue`. Projected due dates are `nextDue`,
  `nextDue + 1 period`, … For `monthly`/`quarterly`/`semiannual`/`yearly`
  the day-of-month is taken from the anchor and **clamped** to the target
  month's length (31st → Apr 30 / Feb 28/29). Clamping derives each
  occurrence independently from the anchor (`anchor + n periods`), never
  from the previous clamped date (so Jan 31 → Feb 28 → Mar 31, not Mar 28).
  `weekly` = +7 days. All date math on calendar dates (no timestamps, no DST).
- **Horizon:** projections run from the anchor to `today + 6 months`
  (query-overridable via `to`, capped at +24 months).
- **Status is derived per due date, independent of row persistence:**
  - persisted row with `transactionId` → `paid`
  - persisted row with `skipped = true` → `skipped`
  - otherwise (no row, OR an override-only row): dueDate < today →
    `overdue`, dueDate ≥ today → `planned`
- `nextDue` is **not auto-bumped**; it stays the user-owned anchor. Editing
  it forward is the escape hatch that discards old overdue projections.
  The derived `nextOpen` (earliest non-paid/skipped due date) is returned in
  the occurrence listing for display.
- Editing `cadence` or `nextDue` re-projects; persisted (touched) rows keep
  their stored `dueDate` and are merged into the listing even if they no
  longer fall on projected dates (flagged `offSchedule: true`).

### Table `recurring_occurrences`

Persisted **only** when touched.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `createdAt` / `updatedAt` | timestamptz | |
| `billId` | uuid NOT NULL → `recurring_bills.id` | `onDelete: 'restrict'` |
| `dueDate` | date NOT NULL | UNIQUE `(billId, dueDate)` |
| `transactionId` | uuid → `transactions.id` | `onDelete: 'set null'`; set = paid |
| `skipped` | boolean NOT NULL default false | |
| `overrideAmount` | numeric(14,2) | expected-amount override for this occurrence |

CHECK: NOT (`transactionId` IS NOT NULL AND `skipped`) — paid and skipped
are mutually exclusive.

**Bill deletion:** `DELETE /bills/:id` is refused with 409
`BILL_HAS_HISTORY` when any persisted occurrence exists (the `restrict` FK
backstops the service check) — deleting a bill must not erase paid history
or an item's recurring TCO. A bill with only pure projections deletes as
today. (An `archived` flag for retiring bills with history is a possible
follow-up, not v1.)

**Deleting a linked transaction:** the FK nulls `transactionId`; the feoh
`deleteTransaction` service additionally prunes occurrence rows left with
`transactionId IS NULL AND NOT skipped AND overrideAmount IS NULL` (fully
untouched again → back to pure projection). Same pruning on explicit unlink.

### REST

- `GET /api/v1/feoh/occurrences?from=&to=&billId=&status=` — merged
  projection+persisted listing across bills (or one bill), each entry
  `{ billId, payee, dueDate, status, expectedAmount, overrideAmount?,
  transactionId?, offSchedule? }`, sorted by dueDate. Window is
  **anchor-to-horizon per bill**; overdue entries are always included
  regardless of `from`. Bills with an unrecognized cadence contribute
  exactly one placeholder entry at their `nextDue` with
  `status: 'unknown'` and `cadenceUnknown: true` (the entry shape carries
  `cadenceUnknown?: boolean`); link/skip/override against such an entry is
  rejected 400 `NOT_AN_OCCURRENCE`. The `status=` filter matches them only
  with `status=unknown`.
- `POST /api/v1/feoh/occurrences/link` — body
  `{ billId, dueDate, transactionId }` → upserts the occurrence row as paid.
  409 `ALREADY_PAID` / `ALREADY_SKIPPED`; 404 unknown bill/transaction.
- `POST /api/v1/feoh/occurrences/skip` — body `{ billId, dueDate }` →
  upserts as skipped (409 if paid).
- `POST /api/v1/feoh/occurrences/unlink` / `unskip` — body
  `{ billId, dueDate }` → clears + prunes as described.
- `PATCH /api/v1/feoh/occurrences/override` — body
  `{ billId, dueDate, amount | null }` → sets/clears `overrideAmount`
  (prunes if row becomes untouched).

`dueDate` in these bodies must be a projected or persisted due date for the
bill (validated against the projection with the `offSchedule` exception for
already-persisted rows) — arbitrary dates are rejected 400
`NOT_AN_OCCURRENCE`. Occurrence booking of an item-linked bill needs no
extra step: the TCO query walks bill → paid occurrences → transactions.

### MCP

- `feoh.list_occurrences` (window + status filter; the "what's overdue" tool)
- `feoh.link_occurrence`
- `feoh.skip_occurrence`

---

## Part 4 — Cash ledger & Kassensturz

### Ledger view

`GET /api/v1/feoh/accounts/:id/ledger?from=&to=&limit=&offset=` —
entries derived from postings of that account joined to their transactions:
`{ transactionId, date, payee, memo, delta, balance }` where
`delta = debit − credit` (asset accounts: positive = money in). Sort order
is `(date, createdAt, transactionId)` ascending — the transaction id
tie-break makes offset pagination deterministic when several transactions
share a date+timestamp. `balance` is computed with a window function (or
equivalent single query) as `openingBalance` + Σ of ALL deltas up to and
including the row in that total order — i.e. rows excluded by
`from`/`offset` still count into the balances shown, so page N's first
balance is always correct. Meta: `{ total, limit, offset, openingBalance,
endBalance }`. Works for every account; cash is just the main consumer.

### Kassensturz (reconciliation)

`POST /api/v1/feoh/accounts/:id/reconcile` — body
`{ countedBalance, date, envelopeId, memo? }`:

0. Guard: 400 `ACCOUNT_NOT_ASSET` unless the account's kind is `asset`
   (reconciling a liability against a counted balance is meaningless; the
   UI only offers the button on asset accounts, but the API enforces it).
1. Guard: if the account has any posting dated **in `(date, today]`**
   (server-local calendar date), refuse with 409
   `LATER_TRANSACTIONS_EXIST` — booking an adjustment into the past would
   silently shift every later balance. Postings dated in the future
   (> today) don't block: they're not in the wallet being counted.
   `date` itself must not be in the future (400).
2. Compute the account's ledger balance through `date` (future-dated
   postings are naturally excluded).
3. `difference = countedBalance − ledgerBalance`, computed in integer cents
   (never float equality on euros).
4. If `difference === 0` → `ok(c, { difference: 0, transaction: null })`, no
   write.
5. Else book a **normal transaction** via the existing `recordTransaction`
   path (`createdBy` = acting principal, payee `Kassensturz`,
   `amount = |difference|`), postings spelled out:
   - `difference > 0` (more cash than booked):
     `[{ accountId, debit: |d| }, { envelopeId, credit: |d| }]`
   - `difference < 0` (cash missing):
     `[{ accountId, credit: |d| }, { envelopeId, debit: |d| }]`
   Both shapes satisfy the `UNBALANCED` check (Σ debit = Σ credit = |d|).
   Response `{ difference, transaction }`.

No new schema; the adjustment is an ordinary, deletable transaction.
`envelopeId` is required (the UI defaults to a "Sonstiges"-like envelope the
user picks; feoh does not create one implicitly).

### MCP

- `feoh.account_ledger`
- (reconciliation stays REST/UI-only in v1 — booking money from chat needs a
  confirmation UX that MCP doesn't have)

---

## Part 5 — Web UI (thin)

- **Inventory page** (new nav entry, `inventory.*` i18n):
  - List with status filter (active/decommissioned), search box, category
    text filter; create/edit dialog.
  - Item detail: fields, lifecycle line (purchased … / warranty until … /
    decommissioned … reason), TCO panel fed by
    `GET /feoh/item-costs/:itemId` (capital / repairs / recurring / proceeds
    / total / €-per-year), "link expense" action (pick transaction, pick
    kind), decommission dialog (date, reason, proceeds, optional sale
    transaction).
- **Finance page — bills section becomes occurrence-aware:** per bill a
  compact upcoming/overdue strip (next N occurrences with status chips);
  actions per occurrence: link (transaction picker), skip, override amount.
  Overdue count badge on the section header.
- **Finance page — accounts section (new):** the page currently has no
  accounts UI at all. Add a minimal account list (name, kind, current
  balance) with a ledger drawer/detail (the ledger endpoint) and a
  "Kassensturz" button on asset accounts opening the reconcile form
  (counted amount, date, envelope select).
- All new strings in `en.json` **and** `de.json`.

## Migrations

One drizzle-kit generated migration (`npm run db:generate -- --name
feoh-inventory-lifecycle`): `inventory_items`, `feoh_item_costs`,
`recurring_occurrences`, `recurring_bills.inventory_item_id`, plus the
data-normalization statements for `cadence` (hand-written SQL appended to the
generated migration is acceptable for the UPDATE statements; snapshots stay
generator-owned).

## Testing

Real Postgres per repo convention; every table truncated per test.

- **Projection math gets the densest coverage:** month-end clamping (Jan 31
  anchor across Feb/Apr, leap years), each cadence, anchor-independence of
  clamping, horizon bounds, `cadenceUnknown` passthrough.
- Occurrence state machine: link/skip/unlink/override upsert+prune paths,
  paid+skipped exclusivity, transaction-deletion pruning, off-schedule merge
  after cadence edits, `NOT_AN_OCCURRENCE` rejection, bill-delete 409
  `BILL_HAS_HISTORY` vs. clean delete, `cadenceUnknown` placeholder row.
- Cadence migration: each ISO/English/German mapping, unrecognized values
  untouched.
- TCO: each component (capital/tier2/recurring/proceeds), `costSize` from
  envelope debits (test with a deliberately lying `amount`; test that an
  account-to-account transfer and an envelope reallocation contribute 0 and
  are rejected as tier-2 links with `NOT_A_COST`), dedup when a transaction
  is both a tier-2 link and a paid occurrence, no-purchase-date →
  `perYear: null`, decommissioned-item link guard, purchase/disposal
  uniqueness.
- Inventory CRUD + decommission, delete-blocked 409 (cost link AND bill
  link), reactivation PATCH (all-null group; 409 `DISPOSAL_LINK_EXISTS`).
- Ledger: running balance with windowing/offset (balances correct on page 2),
  deterministic tie-break, opening balance, reconcile diff booking
  (positive, negative, zero), 409 `LATER_TRANSACTIONS_EXIST` (and NOT
  triggered by future-dated postings), 400 `ACCOUNT_NOT_ASSET` / future
  `date`.
- Gate removal: features reports `finance: true`; feoh routes reachable
  without env var; `feoh-gating.test.ts` deleted; remaining feoh tests run
  without `FEOH_ENABLED` setup.
- Web: inventory page list/detail/decommission flows, occurrence strip
  actions, ledger drawer, reconcile form; German locale assertions for the
  new strings.

## Explicitly out of scope (v1)

- Auto-matching / suggestion engine for occurrence↔transaction linking.
- Photos, receipts, document attachments (no file-storage story yet).
- Quantities / consumable stock; loan tracking; room/container hierarchy.
- Tier-3 running costs (energy, consumables, insurance apportioning).
- MCP reconciliation tool.
- Splitting a multi-item transaction's cost across items (a transaction
  linked to N items counts fully into each).
- Archiving bills (delete is simply blocked while history exists).

## Risks

- Cadence normalization touches live data — unrecognized values are
  deliberately left alone rather than guessed.
- First cross-module FK (feoh → inventory) — migration ordering and the two
  schema barrels must both carry the new tables.
- Feoh always-on is a behavior change for any deployment relying on
  off-by-default.
