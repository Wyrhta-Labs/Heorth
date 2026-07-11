# @wyrhta/core — Design

**Date:** 2026-07-11
**Status:** Approved design
**Depends on:** nothing (foundation)
**Consumed by:** KithLedger, Heorth (git-tag dependency)

## Purpose

A single shared TypeScript package holding everything generic to a Wyrhta service, so KithLedger and Heorth stay thin, consistent, and correct. It contains **no domain concepts** (no people, recipes, or envelopes) — only primitives that apps compose.

Much of the HTTP kit is lifted from KithLedger's working code. The identity layer is a *new* build: KithLedger's single-admin auth is the starting point, generalized to multi-user with roles.

## Package shape

```
@wyrhta/core
├── package.json          # "type": "module"; exports subpaths below
├── src/
│   ├── identity/
│   │   ├── schema.ts      # users, api_keys tables (Drizzle) + role enum
│   │   ├── password.ts    # argon2 hash/verify
│   │   ├── jwt.ts         # sign/verify HS256 (verify takes 3 args)
│   │   ├── api-key.ts     # generate/hash/validate (prefix configurable)
│   │   └── service.ts     # createUser, authenticate, issueToken, keys CRUD
│   ├── household/         # OPTIONAL module (Heorth uses; KithLedger ignores)
│   │   ├── schema.ts      # household singleton, membership + role
│   │   └── service.ts     # seedHousehold, listMembers, setRole
│   ├── http/
│   │   ├── response.ts    # ok(c, data, meta?) / err(c, code, msg, status)
│   │   ├── pagination.ts  # parsePagination(query) -> { limit, offset }
│   │   ├── envelope.ts    # shared response types
│   │   └── middleware/    # request-id, security-headers, rate-limit,
│   │                      #   error-handler, auth guards
│   ├── auth/
│   │   ├── guards.ts      # requireAuth, requireJwt, requireRole(...roles)
│   │   └── dispatch.ts    # Bearer prefix_ -> key path; eyJ -> jwt path
│   ├── mcp/
│   │   ├── scaffold.ts    # createMcpServer(registry, authAdapter)
│   │   └── types.ts       # McpTool { name, description, input schema, handler }
│   ├── db/
│   │   ├── client.ts      # Drizzle client factory (postgres.js)
│   │   └── migrate.ts     # programmatic migration runner
│   └── lib/
│       ├── logger.ts      # logEvent / logError (structured JSON audit)
│       └── crypto.ts      # generateApiKey({ prefix }) -> { raw, hash, prefix }
└── tests/                 # unit tests: password, jwt, api-key, envelope, guards
```

Subpath exports (`@wyrhta/core/identity`, `/http`, `/mcp`, etc.) so apps import only what they use.

## Identity & auth (new build)

- **`users`** — id, email (unique), handle, `password_hash` (argon2id), `role` (`admin` | `adult` | `child`), display name, avatar color, timestamps.
- **`api_keys`** — id, user_id, name, `key_hash` (SHA-256), `prefix`, `last_used_at`, `created_at`. The raw key (`<prefix>_` + 32-byte hex) is returned once at creation; only the hash is stored. Prefix is configurable per app (`kl_`, `he_`).
- **JWT** — HS256, per user; payload carries `sub` (user id) and `role`. `verify(token, secret, 'HS256')` (algorithm is required).
- **Guards** — `requireAuth` (key or jwt), `requireJwt` (jwt only — for key-management routes), `requireRole(...roles)` (RBAC).
- **Auth dispatch** — `Bearer <prefix>_…` → API-key validation against `api_keys`; `Bearer eyJ…` → JWT verification. Key-management routes reject API-key auth.

## Household module (optional)

Used by Heorth, ignored by KithLedger.

- **`household`** — singleton row (enforced by a fixed id / single-row constraint): name, timezone, locale, created_at. Seeded at first boot.
- **membership** — every `user` in the instance belongs to the one household; role lives on the user. `listMembers()`, `setRole(userId, role)`, `seedHousehold(fromEnv)`.

The instance is the tenancy boundary — no per-row household scoping.

## MCP scaffold

- `createMcpServer(registry: McpTool[], authAdapter)` stands up an MCP server whose tool calls run through the same auth (API key → user + role) and the same audit logger as REST.
- `McpTool` = `{ name, description, inputSchema (Zod/JSON schema), handler(ctx, input) }`. Apps build the registry from their modules and pass it in. Tool names are namespaced by the app (`calendar.*`, `people.*`).

## HTTP kit (lifted from KithLedger)

Response envelope, pagination, request-id, security headers, in-memory rate limiter, error handler, structured audit logger — ported with minimal change. These are already proven in KithLedger; core becomes their canonical home.

## DB conventions

- Drizzle + `postgres.js`. `timestamp('col', { withTimezone: true })` (no `timestamptz` export).
- The `.js`-extension ESM import pattern plus a no-`.js` re-export for drizzle-kit's CJS bundler; `db:*` scripts run drizzle-kit via `tsx`.
- `migrate()` runs programmatically at startup.
- Postgres UNIQUE violation = `23505`; services catch it to return `CONFLICT`.

## Testing

Unit tests only (core has no DB-bound domain logic beyond identity): password hash/verify round-trip, JWT sign/verify + algorithm enforcement, API-key generate/hash/validate, envelope shape, guard behavior for each role, auth dispatch branching. Identity schema is exercised by KithLedger's and Heorth's integration tests.

## Open items resolved

- **Consumption:** git-tag dependency during early phases; publish to a registry at/after 1.0.
- **`JWT_SECRET`** minimum 32 chars, enforced at env-validation; short values exit at startup.

## Non-goals

- Any domain model. Any gRPC. Multi-household scoping. Dynamic plugin loading.
