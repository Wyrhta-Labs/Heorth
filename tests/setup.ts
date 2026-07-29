import { beforeAll, beforeEach } from 'vitest';

// Set required env BEFORE importing modules that read process.env at load time.
// The src imports at the bottom are dynamic (`await import`) precisely so these
// assignments land first — a static import would be hoisted above them.
// The .env auto-loader (src/config/env.ts) only fills DATABASE_URL if it is still
// unset by then, so an unexported DATABASE_URL gets the test default below rather
// than the .env dev value.
process.env['DATABASE_URL'] ??= 'postgres://heorth:changeme@localhost:55432/heorth_test';
process.env['JWT_SECRET'] ??= 'test-secret-test-secret-test-secret-123';
process.env['HOUSEHOLD_NAME'] ??= 'Test Household';
process.env['ADMIN_EMAIL'] ??= 'admin@test.local';
process.env['ADMIN_PASSWORD'] ??= 'test-admin-password';
// Feoh satellite — a stub URL/key; tests install an in-process fake Feoh runtime
// via setFeohRuntime, so no real network call is ever made against these.
process.env['FEOH_BASE_URL'] ??= 'http://feoh.test';
process.env['FEOH_API_KEY'] ??= 'fe_test-service-key';
// Force the M365 integration DISABLED for the suite regardless of a local `.env`
// (whose real dev credentials the auto-loader would otherwise inject). Set to
// '' — the env schema treats blank as absent — so config.m365 is null and no
// real-tenant credentials or calls ever enter the test process. Enabled-path
// tests inject a fake-Graph runtime via setM365Runtime instead.
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

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

beforeEach(async () => {
  // Truncate every application table, resetting FKs. Order-independent via CASCADE.
  await db.execute(sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
});
