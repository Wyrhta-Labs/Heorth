# KithLedger — Refactor onto @wyrhta/core + MCP Server — Design

**Date:** 2026-07-11
**Status:** Approved design
**Depends on:** `@wyrhta/core`
**Repo:** existing (`github.com/wyrhta-labs/kithledger`)

## Purpose

KithLedger already ships a working REST API (Hono + Drizzle + Postgres) and a React SPA. Two gaps remain against what the website advertises and what the program needs:

1. It has its own copies of the middleware/envelope/crypto/logger that now belong in `@wyrhta/core`.
2. It advertises an **MCP** surface but has **no MCP server**. (It also advertised gRPC, which is being dropped.)

This phase refactors KithLedger onto core and adds the MCP server. Domain code (people, interactions, reminders, relationships) is unchanged in behavior. This phase is also the proof that `@wyrhta/core` is factored correctly before Heorth depends on it.

## Part 1 — Refactor onto @wyrhta/core

- Add `@wyrhta/core` as a git-tag dependency.
- Replace in-repo implementations with core's: response envelope, pagination, request-id / security-headers / rate-limit / error-handler middleware, structured logger, crypto/api-key.
- **Auth migration:** KithLedger's single `ADMIN_PASSWORD` login becomes a **single-user deployment of core's identity** — first boot seeds one `admin` user from `ADMIN_PASSWORD`; `POST /auth/token` authenticates that user and returns a core-issued JWT. No user-visible change; the primitive underneath is now shared. API keys move to core's `api_keys` table (prefix stays `kl_`).
- Household module: **not used** — KithLedger is personal, not household-scoped.
- Keep KithLedger's domain schema (people, interactions, reminders, relationships) and services as-is; only their imports of the moved primitives change.

**Acceptance:** existing integration tests pass unchanged against the refactored auth; envelope/pagination behavior identical.

## Part 2 — MCP server

Register KithLedger's domain as MCP tools via core's scaffold, assembled in a new `src/mcp/`. Tools share the same auth (a `kl_` API key resolves to the admin user) and audit trail as REST.

Tool set (namespaced `kith.*`):

| Tool | Maps to |
|---|---|
| `list_people` | `GET /people` (supports `q`, `tags`, `birthday_month`) |
| `get_person` | `GET /people/:id` |
| `create_person` | `POST /people` |
| `update_person` | `PATCH /people/:id` |
| `get_person_graph` | `GET /people/:id/graph` (`depth`) |
| `list_interactions` | `GET /interactions` (`person_id`, `type`, `from`, `to`) |
| `log_interaction` | `POST /interactions` |
| `list_reminders` | `GET /reminders` (`status`, `overdue`) |
| `create_reminder` | `POST /reminders` |
| `complete_reminder` | `POST /reminders/:id/complete` (recurrence-aware) |
| `snooze_reminder` | `POST /reminders/:id/snooze` |
| `list_relationships` | `GET /relationships` |
| `create_relationship` | `POST /relationships` |

Each tool calls the **existing service layer** (not HTTP), so business rules (recurrence transactions, mutual relationships, `23505` conflict handling) are reused exactly.

## Part 3 — Docs & site

- README: replace any gRPC mention; document MCP connection (`kl_` key, tool list).
- Website copy correction is tracked in the program plan's "Website reconciliation" section.

## Testing

- Existing REST integration tests: must stay green.
- New: MCP tool tests — each tool exercised against a real DB via the same `tests/setup.ts` harness, asserting parity with the REST behavior and auth/role enforcement.

## Non-goals

- gRPC. Multi-user identity (KithLedger stays single-user). Any change to the SPA beyond the envelope/auth import swap.
