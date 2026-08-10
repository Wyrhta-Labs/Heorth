# Plugin system (host side) — design

> **SUPERSEDED 2026-08-10** by the Feoh merge (meta repo docs/plans/feoh-merge.md, ADR 0007) — the plugin host was never implemented; Feoh ships as a built-in env-gated module instead.

**Date:** 2026-08-06
**Status:** approved, not implemented
**Scope:** spec 1 of 3. This spec covers the plugin contract and Heorth's plugin
host only. The **Feoh repo is untouched** by it; the one Feoh-shaped change here
is Heorth-side web gating.

## Why

Finance lives in the **Feoh** satellite: its own repo, its own database, its own
container, reached from Heorth through the HTTP proxy in `src/satellites/feoh/`.
For a self-hosted household system that is one container, one database, one API
key, and one liveness surface too many. The decision is to retire the satellite
and run Feoh **inside the Heorth process** — but without reabsorbing it, so it
keeps its own repo and release cadence.

That requires a general extension point Heorth does not have. The existing
`HeorthModule` registry (`src/modules/registry.ts`) is compile-time only: modules
are imported by `src/modules/index.ts`, so anything registered there must be part
of the Heorth build. Feoh must load at **runtime** instead.

## Decomposition

Three specs, in order:

1. **This spec — plugin host system.** The contract in `@wyrhta/core/plugin`,
   Heorth's loader, `GET /api/v1/plugins`, UI gating. Verified against fixture
   plugins; Feoh not involved.
2. **Feoh as a plugin.** Port Feoh's modules to the contract, schema-qualify its
   migrations, replace the roster HTTP sync with the host household API, delete
   `src/satellites/feoh/`, retire Feoh's server entrypoint and container.
3. **Deploy.** Meta repo `deploy/`: drop the `feoh` service and its database.

## Decisions

| Question | Decision |
|---|---|
| Satellite or plugin? | **Plugin only.** The satellite path is retired, not kept as a second mode. |
| Feoh's identity | **Own repo, runtime-loaded.** Not a compile-time dependency of Heorth; a Heorth build does not need Feoh to exist. |
| Plugin data | **Shared database, own Postgres schema.** Plugin owns e.g. `feoh.*` in Heorth's database; the host runs the plugin's migrations at boot. |
| Member boundary | Feoh **keeps its `parties` table**; the host exposes a read-only household API that replaces the HTTP roster sync. |
| Discovery | **Plugin directory + manifest.** Scan `PLUGINS_DIR`, one subdirectory per plugin, each with `plugin.json`. |
| Failure policy | **Skip and degrade.** A failing plugin never blocks boot; its routes return `503` and its UI is hidden. |

## Trust model

A loaded plugin is **fully trusted host code**: same process, same connection
pool, same privileges. There is no sandbox and no capability model. The Postgres
schema boundary is hygiene against name collisions and accidental coupling — it
is not a security boundary. Discovery is filesystem-only: the host never
downloads, resolves, or fetches a plugin from anywhere.

The operator's act of placing a directory in `PLUGINS_DIR` is the trust
decision, and it is the only one.

## The contract

Lives in **`@wyrhta/core/plugin`** as types only, with no runtime code. This is
what keeps the repos decoupled in both directions: Feoh never imports Heorth,
and Heorth never imports Feoh. Both already pin `@wyrhta/core` by tag.

```ts
export const PLUGIN_API_VERSION = 1;

export interface HeorthPlugin {
  /** Must equal the manifest `id`; the host rejects a mismatch. */
  id: string;
  register(ctx: PluginContext): void | Promise<void>;
}

export interface PluginContext {
  /** Router the host has already mounted at /api/v1/<id>. The host owns the prefix. */
  routes: Hono;
  mcp: { add(...tools: McpTool[]): void };
  /** Host's pool, search_path bound to the plugin's schema. */
  db: PluginDb;
  /** The plugin's Postgres schema name, for pgSchema() and raw SQL. */
  schema: string;
  auth: {
    requireAuth: MiddlewareHandler;
    requireRole(...roles: Role[]): MiddlewareHandler;
  };
  household: HouseholdReadApi;
  /** Values for the env names the manifest declared, already validated. */
  env: Record<string, string>;
  log: Logger;
}

export interface HouseholdReadApi {
  listMembers(): Promise<HouseholdMember[]>;
  getMember(id: string): Promise<HouseholdMember | null>;
  /** In-process notification; fires after member create/update/delete commits. */
  onMemberChanged(cb: (e: MemberChangedEvent) => void): void;
}
```

`Logger` and `McpTool` come from core's existing exports. `PluginDb` is the
drizzle handle type. `HouseholdMember` is core's household member shape;
`MemberChangedEvent` is `{ kind: 'created' | 'updated' | 'deleted'; memberId: string }`.

### Version and dependency constraint

`apiVersion` is a **single integer**, checked for exact equality. Because the
host hands the plugin a live drizzle handle, host and plugin must agree on a
`drizzle-orm` major version; `apiVersion` is the contractual carrier for that.
A plugin declares `drizzle-orm` (and `hono`, `zod`) as **peer** dependencies and
must not bundle its own copy.

### Manifest

`plugin.json`, validated with Zod before anything is executed:

```json
{
  "id": "feoh",
  "name": "Feoh — finance",
  "apiVersion": 1,
  "entry": "./dist/plugin.js",
  "dbSchema": "feoh",
  "env": [{ "name": "FEOH_SOMETHING", "required": false }],
  "optional": true
}
```

- `id` — `^[a-z][a-z0-9-]{1,31}$`. Determines the route prefix. Must not collide
  with an existing route area or another plugin.
- `entry` — path relative to the plugin directory, must resolve inside it.
- `dbSchema` — `^[a-z][a-z0-9_]{1,31}$`, must not be `public` or collide with
  another plugin's schema.
- `env` — names the plugin needs; the host reads them from its own process env
  and passes only these through. A missing `required` name is a load failure.
- `optional` — accepted and recorded, but has no effect under the skip-and-degrade
  policy. Retained so a future fail-fast mode has somewhere to hang.

## Load sequence

`loadPlugins()` runs once in `main()`, **before** `createApp` — migrations and
dynamic imports are async, and `createApp` is synchronous.

For each subdirectory of `PLUGINS_DIR`:

1. Read and Zod-parse `plugin.json`.
2. Check `apiVersion === PLUGIN_API_VERSION`.
3. Check `id` / `dbSchema` uniqueness and legality; check `entry` resolves inside
   the plugin directory.
4. Collect declared env; fail on a missing required name.
5. `CREATE SCHEMA IF NOT EXISTS <dbSchema>`.
6. Run the plugin's migrations: the **host** calls drizzle's
   `postgres-js` migrator with the plugin's `migrations/` folder,
   `migrationsSchema: <dbSchema>`, and its own migrations table. The plugin
   never ships or invokes a migrator.
7. Dynamic-import `entry`; validate the default export shape and that
   `plugin.id === manifest.id`.
8. Build the `PluginContext` and `await register(ctx)`.

Every step is wrapped. A throw at any point yields
`{ manifest, status: 'failed', error }` and the scan continues.

```ts
type LoadedPlugin =
  | { manifest: PluginManifest; status: 'ok'; plugin: HeorthPlugin }
  | { manifest: PluginManifest | { id: string }; status: 'failed'; error: string };
```

A manifest that cannot be parsed still produces a `failed` entry keyed by the
directory name, so a typo is visible in `GET /api/v1/plugins` rather than silent.

`PLUGINS_DIR` (`src/config/env.ts`, optional, default `./plugins`): a missing
directory means zero plugins and no error. With no plugins present, behaviour is
identical to today.

## Mounting

`createApp(modules, plugins)` mounts, in order:

- each `ok` plugin's router at `/api/v1/<id>`;
- for each `failed` plugin, a catch-all at `/api/v1/<id>/*` returning
  `503 { error: { code: 'PLUGIN_UNAVAILABLE', message } }`;
- then the existing `/api/*` 404 catch-all, unchanged.

`GET /api/v1/plugins` (auth required, any role) returns
`[{ id, name, status }]` — `error` detail is logged, not exposed.

`/health` stays `{ status: 'ok' }`. It is a liveness probe and must not fail
because a plugin is broken; plugin status is reported only by
`/api/v1/plugins`.

### Change to existing code

`createApp` returns `{ app, mcp }` and **`collectMcpTools` is deleted.** Today
`collectMcpTools` calls every module's `register()` a second time against a
throwaway Hono to harvest MCP tools. Doing that to a plugin would execute
third-party side effects twice. Registering once and returning the registry
removes the hazard for modules as well. `src/index.ts` and the MCP server wiring
consume the returned registry.

## Household read API

`context.ts` wraps the existing `src/household/service.ts`; no new query paths.
`onMemberChanged` is a small in-process emitter that the member create / update /
delete paths fire after commit. It is what replaces the satellite roster's boot
sync, its deduped lazy re-sync, and the documented staleness window where a
renamed member's Feoh party could go stale.

Listener errors are caught and logged; a throwing plugin listener must not break
a household mutation.

## New and changed files

```
src/plugins/manifest.ts   Zod manifest schema + parse
src/plugins/loader.ts     loadPlugins(): scan, validate, migrate, import, register
src/plugins/context.ts    PluginContext construction (db, auth, household, env, log)
src/plugins/routes.ts     GET /api/v1/plugins
src/app.ts                createApp(modules, plugins) -> { app, mcp }; mount plugins; drop collectMcpTools
src/index.ts              await loadPlugins() before createApp; consume returned mcp
src/config/env.ts         PLUGINS_DIR
src/household/service.ts  emit member-changed events
web/src/api/plugins.ts    fetch enabled plugins
web/src/components/layout/sidebar.tsx  filter nav by plugin status
web/src/pages/feoh.tsx    unavailable state when the finance plugin is absent/failed
```

## UI gating

The web app fetches `GET /api/v1/plugins` once after login and filters the
sidebar. Plugin-backed routes stay registered in the bundle; a route whose plugin
is absent or failed renders an "unavailable" state instead of its normal content.

There is **no per-plugin UI loading**. The finance UI is already host-side
(`web/src/pages/feoh.tsx`, `web/src/api/feoh.ts`, `web/src/components/feoh/`) and
stays there.

## Testing

Real `_test` Postgres, per the repo convention. Fixtures live in
`tests/fixtures/plugins/<case>/` — a real `plugin.json` plus an entry written as
plain **`.mjs`**, so the identical file loads under Vitest and under production
Node with no build step. Migration fixtures are a hand-written drizzle folder
(one `.sql` plus a minimal `meta/_journal.json`).

Cases:

- **happy path** — routes reachable at `/api/v1/<id>`, MCP tools present in the
  returned registry, migration applied, and the created tables exist in the
  plugin's schema and **not** in `public`
- **`apiVersion` mismatch** → boots, `failed`, `503`
- **malformed / missing manifest** → boots, `failed` keyed by directory name
- **missing required env** → boots, `failed`
- **migration failure** → boots, `failed`, no partial mount
- **`register()` throws** → boots, `failed`
- **id / dbSchema collision** between two fixtures → second one `failed`
- **`PLUGINS_DIR` missing or empty** → zero plugins, no error, existing routes
  unchanged
- **auth** — a fixture route using `ctx.auth.requireRole('admin')` rejects an
  adult with the host's own error envelope
- **`GET /api/v1/plugins`** shape across ok / failed / none
- **household API** — sees seeded members; `onMemberChanged` fires on rename; a
  throwing listener does not break the rename

`tests/setup.ts` gains teardown that drops schemas created by fixtures, alongside
the existing per-test truncation.

## Non-goals

Deliberately excluded, so they do not get half-built:

- sandboxing, permissions, or any capability model — trust is binary
- hot reload, unload, or enable/disable at runtime
- plugin-supplied frontend assets or bundles
- plugin-to-plugin APIs or a shared event bus beyond `onMemberChanged`
- a registry, marketplace, or downloading anything
- dependency resolution between plugins beyond the `apiVersion` equality check
- multiple versions of the same plugin id loaded side by side
