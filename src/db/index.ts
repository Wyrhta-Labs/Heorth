import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/env.js';
import * as schema from './schema/index.js';

/**
 * ONE connection pool per process, per (URL, pool size) — memoised on `globalThis`.
 *
 * A plain module-level `postgres(...)` leaks an entire pool every time this
 * module is EVALUATED again. In production that never happens: the module graph
 * is built once. Under Vitest it happens constantly:
 *
 *  - `poolOptions.forks.singleFork` runs all 60+ test files sequentially in ONE
 *    process, but `isolate` (on by default) still hands every file a FRESH
 *    module registry — so every test file re-evaluated this module and opened
 *    its own pool;
 *  - `vi.resetModules()` (tests/kith-gating.test.ts, tests/satellite-jwks.test.ts)
 *    does the same again mid-file.
 *
 * Nothing ever closed the orphaned pools, so open connections grew MONOTONICALLY
 * with the number of test files — measured at +1 per file minimum, more for files
 * whose code issues concurrent queries (postgres.js opens up to `max` sockets on
 * demand). A full run reached ~66 connections on a server whose `max_connections`
 * is 100 and which is shared with the dev stack, so the suite sat permanently at
 * the edge of the ceiling and tipped over whenever anything else touched the
 * server.
 *
 * The resulting failures never looked like a pool leak: collection-time
 * `PostgresError: remaining connection slots are reserved for roles with the
 * SUPERUSER attribute`, hook timeouts in the truncate `beforeEach`, and — the
 * signature case — a handler that issues CONCURRENT queries failing while every
 * sequential query in the same file kept working on the one socket the pool
 * already held (`GET /api/v1/m365/status` does `Promise.all([...])`; that is why
 * tests/m365-routes.test.ts appeared to fail "only on /status", and only in a
 * full-suite run).
 *
 * `globalThis` is the only state that survives a module-registry reset, so the
 * memo has to live there — the same pattern used to keep one database client
 * across HMR reloads in dev servers. In production it is exactly equivalent to a
 * module-level `const`: the module is evaluated once and the cache is filled once.
 */
type PoolCache = Map<string, ReturnType<typeof postgres>>;

const POOL_CACHE_KEY = '__heorthPostgresPools__';
const globalCache = globalThis as unknown as Record<string, PoolCache | undefined>;
const pools: PoolCache = (globalCache[POOL_CACHE_KEY] ??= new Map());

// Keyed by the settings that define the pool, so a caller that genuinely needs a
// different database or pool size still gets its own client rather than silently
// reusing an unrelated one.
const poolKey = `${config.databaseUrl} ${config.dbPoolMax}`;

let queryClient = pools.get(poolKey);
if (!queryClient) {
  queryClient = postgres(config.databaseUrl, { max: config.dbPoolMax });
  pools.set(poolKey, queryClient);
}

export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
