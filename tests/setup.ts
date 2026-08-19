import { beforeAll, beforeEach } from 'vitest';

// Set required env BEFORE importing modules that read process.env at load time.
// The src imports at the bottom are dynamic (`await import`) precisely so these
// assignments land first — a static import would be hoisted above them.
// The .env auto-loader (src/config/env.ts) is a no-op under Vitest, so the
// suite sees ONLY what this file (and individual tests) put into process.env —
// an unexported DATABASE_URL gets the test default below, never the .env dev
// value, and gating vars a test deletes stay deleted across vi.resetModules().
process.env['DATABASE_URL'] ??= 'postgres://heorth:changeme@localhost:5432/heorth_test';
process.env['JWT_SECRET'] ??= 'test-secret-test-secret-test-secret-123';
process.env['HOUSEHOLD_NAME'] ??= 'Test Household';
process.env['ADMIN_EMAIL'] ??= 'admin@test.local';
process.env['ADMIN_PASSWORD'] ??= 'test-admin-password';
// Force the M365 integration DISABLED for the suite regardless of what the
// spawning shell exported. Set to '' — the env schema treats blank as absent —
// so config.m365 is null and no real-tenant credentials or calls ever enter
// the test process. Enabled-path tests inject a fake-Graph runtime via
// setM365Runtime instead.
for (const k of [
  'M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET',
  'M365_REDIRECT_URI', 'M365_FAMILY_MAILBOX', 'M365_SHARED_TODO_LIST',
]) {
  process.env[k] = '';
}

// Destructive-suite guard. This file TRUNCATEs every application table between
// tests, so it must only ever run against a throwaway database.
//
// This is an ALLOWLIST — the database name has to END IN `_test`. It replaces an
// earlier denylist that merely rejected names containing `_dev`, which failed
// open: a primary database name like `heorth` passed the check, so pointing
// DATABASE_URL at the running dev stack silently wiped real data.
//
// Checked AFTER the assignments above so it validates the URL actually in force,
// whichever source it came from, and BEFORE the dynamic imports below so no
// database client is constructed against a rejected URL.
const testDbName = (() => {
  try {
    return new URL(process.env['DATABASE_URL'] ?? '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!testDbName.endsWith('_test')) {
  // Never interpolate the URL itself — it carries a password.
  throw new Error(
    `Refusing to run destructive tests against database '${testDbName || '<unparseable DATABASE_URL>'}'. ` +
      'Export a DATABASE_URL whose database name ends in _test (e.g. heorth_test).',
  );
}

const { migrate } = await import('drizzle-orm/postgres-js/migrator');
const { db } = await import('../src/db/index.js');
const { sql } = await import('drizzle-orm');

/**
 * Migrate ONCE per process, memoised on `globalThis` — same reason (and same
 * mechanism) as the postgres pool memo in `src/db/index.ts`.
 *
 * `poolOptions.forks.singleFork` runs all test files in ONE process, but
 * `isolate: true` gives each file a FRESH module registry, so this setup file —
 * and therefore this `beforeAll` — is re-evaluated per file. The database is
 * fully migrated after the first file; the other 50+ calls are pure no-ops that
 * still pay for two fsync'd DDL statements (`CREATE SCHEMA IF NOT EXISTS
 * drizzle`, `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations`) plus a
 * SELECT — measured at 35-190ms each against an already-migrated database.
 *
 * This is also the hook `hookTimeout` guards (now 30s in `vitest.config.ts`),
 * and one observed `--sequence.shuffle` failure under the old 10s default was
 * exactly `Error: Hook timed out in 10000ms` here — which fails the WHOLE file
 * (reported as a failed suite with its tests "skipped"), so the file blamed
 * looks random. Running the migration once removes 50+ exposures to that. It
 * does NOT fix the underlying flake: the stalls come from the environment (see
 * the truncate note below), and the same timeouts can still fire in a test
 * body. Do not read this as a flake fix.
 *
 * The PROMISE is cached, not a boolean: later files await the settled promise,
 * and a genuine migration failure still surfaces in every file rather than
 * being swallowed after the first.
 */
const MIGRATED_KEY = '__heorthTestMigrated__';
const migrationCache = globalThis as unknown as Record<string, Promise<void> | undefined>;

beforeAll(async () => {
  await (migrationCache[MIGRATED_KEY] ??= migrate(db, { migrationsFolder: './src/db/migrations' }));
});

beforeEach(async () => {
  // Truncate every application table, resetting FKs. Order-independent via
  // CASCADE, and every table is named in ONE statement rather than truncated in
  // a per-table loop.
  //
  // That is not cosmetic. A per-table loop re-truncates a table once more for
  // every parent that cascades into it: measured on this schema (24 tables) the
  // loop performs 24 explicit + 33 cascaded = 57 table truncations per test,
  // this statement performs 24 with zero cascades. Every truncation creates a
  // fresh relfilenode that the next checkpoint must fsync and unlink, and the
  // commit itself is fsync-bound (`pg_stat_activity` shows this hook waiting on
  // `IO/WalSync` and `LWLock/WALWrite`).
  //
  // Timings, same schema, same database: idle machine 156-198ms for the loop vs
  // 31-34ms for this statement; with a second suite running concurrently the gap
  // widens to 771-875ms vs 40-46ms. Paid once per TEST, so the full 373-test
  // suite drops from ~233s to ~80s. Naming every table also stops the flood of
  // "truncate cascades to table ..." NOTICEs the loop printed through the test
  // reporter — about 670KB of log per 40 tests, now ~3KB.
  //
  // Why this matters beyond speed: on this dev cluster (Postgres in Docker on
  // Windows) checkpoints fsync 55k-97k files with 17-76s sync phases every 5
  // minutes, and during those episodes a test that normally takes 400-500ms can
  // take 5.5s+, which tripped Vitest's default 5s `testTimeout` (now 20s in
  // `vitest.config.ts`). Cutting the churn shortens each run's exposure window;
  // it does not remove the stalls.
  await db.execute(sql`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(quote_ident(tablename), ', ')
        INTO tables
        FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations';
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$;
  `);
});
