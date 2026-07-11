# Wyrhta Labs — Program Plan

**Date:** 2026-07-11
**Status:** Approved design
**Scope:** How Heorth, KithLedger, and the shared foundation fit together, and the order they are built in.

## Summary

Wyrhta Labs ships **two products** on a **shared foundation**:

- **`@wyrhta/core`** — a shared TypeScript package: identity/auth, an optional household model, the REST envelope, the middleware stack, an MCP scaffold, and DB conventions. Extracted and generalized from KithLedger's proven patterns.
- **KithLedger** — a standalone, API-first personal relationship ledger (people, interactions, reminders, relationships). Already implemented in REST; this program refactors it onto `@wyrhta/core` and adds its missing MCP server.
- **Heorth** — the flagship household system. One household per self-hosted instance, real member users with roles, and domain modules. **Feoh** (finance) is a *branded module inside Heorth*, not a separate project.

There is no separate Feoh repo and no plugin/extension runtime. Feoh is first-party Heorth code that sits beside the Calendar and Meals modules.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Output | Program plan + one design spec per deliverable, built in dependency order |
| Shared foundation | A shared `@wyrhta/core` package; repos stay separate |
| Core consumption | Git-tag dependency for now (no registry pre-1.0); publish later |
| Identity | Household members are real login users with roles (`admin`/`adult`/`child`) |
| Tenancy | One household per self-hosted instance — the instance *is* the boundary |
| API surface | REST + MCP. **gRPC dropped** (site copy to be corrected) |
| Feoh | Folded natively into Heorth as its Finance module, branded "Feoh" |
| Heorth 0.1 modules | **Calendar + Meals + Feoh (Finance)**; Chores/Library/Garden are a later phase |
| Web UI | Full parity with the website mockups, honoring the brand design guide |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  @wyrhta/core   (new shared npm package)                  │
│  identity (users + roles + JWT + API keys), household,    │
│  REST envelope, middleware, MCP scaffold,                 │
│  pagination · logging · crypto                            │
└─────────────────────────────────────────────────────────┘
              ▲                          ▲
              │ depends on               │
       ┌─────────────┐          ┌──────────────────────────┐
       │  KithLedger │          │        Heorth            │
       │  standalone │          │  household · members     │
       │  + MCP      │          │  modules:                │
       │             │          │   • Calendar  ┐          │
       └─────────────┘          │   • Meals     ├ 0.1      │
                                │   • Feoh (Finance) ┘      │
                                │   • Chores/Library/ ┐later│
                                │     Garden          ┘     │
                                │  + MCP server + React SPA │
                                └──────────────────────────┘
```

**Boundary rule:** `@wyrhta/core` contains nothing domain-specific — no people, recipes, or envelopes. Apps import primitives and compose their own domains.

## Build order (dependency-driven)

1. **`@wyrhta/core`** — extract KithLedger's middleware/envelope/crypto/logger largely as-is; build the *new* members-as-users + roles identity and the one-household model fresh; ship the MCP scaffold. See `2026-07-11-wyrhta-core-design.md`.
2. **KithLedger** — refactor onto core (single-admin becomes a single-user deployment of core's identity), add the MCP server, keep REST + SPA. Doubles as the proof that core is factored correctly before Heorth leans on it. See `2026-07-11-kithledger-mcp-design.md`.
3. **Heorth** — flagship on core: household/members/roles foundation, then Calendar + Meals + Feoh modules, MCP server, full React SPA. See `2026-07-11-heorth-design.md`.

Each deliverable gets its own implementation plan (via the writing-plans skill) after this design set is approved.

## Cross-cutting conventions (shared by both apps)

- **Stack:** Node.js 22 + TypeScript, Hono, Drizzle ORM, PostgreSQL 16, Zod, Vitest. React 18 + Vite + TanStack Router/Query + Tailwind + shadcn/ui for the SPA, served static from the API in prod.
- **Layering:** `routes/` → `services/` → `db/`. Routes never touch Drizzle directly.
- **Response envelope:** `{ data, meta }` on success, `{ error: { code, message } }` on failure. Pagination `?limit&offset` (max 100).
- **Auth dispatch:** `Bearer <prefix>_…` → API key path; `Bearer eyJ…` → JWT path.
- **Migrations at startup:** run programmatically before `serve()`.
- **MCP:** each app assembles one MCP server from its modules' tool registries via core's scaffold; tools share the same auth + audit trail as REST.
- **Testing:** integration tests against a real Postgres, truncate-per-test, `singleFork: true`.

## Website reconciliation (follow-up, not part of build)

These live-site corrections fall out of the locked decisions. To be applied as a separate change, not during planning:

1. Drop **gRPC** from `components/heorth-feature.tsx` ("Surface: REST · gRPC · MCP") and any KithLedger copy → **REST · MCP**.
2. Reframe **Feoh** in `components/feoh-feature.tsx` and `components/projects-overview.tsx` from a standalone § 04 project into a branded **Finance module of Heorth**, shipping in Heorth 0.1. Remove "self-hostable alone" and the separate Q1 2027 date.
3. Update the `projects-overview.tsx` intro ("Three tools we're building" / "a finance module that attaches to the first") to reflect **two products** with Feoh as a Heorth module.

## Non-goals

- gRPC transport.
- Multi-household / SaaS tenancy.
- A dynamic plugin/extension runtime.
- Heorth Chores, Library, and Garden modules (later phase).
- API type codegen for the SPA (hand-synced types for now).
