import { beforeAll, beforeEach } from 'vitest';

// The .env auto-loader (src/config/env.ts) fills DATABASE_URL when it isn't
// exported. This destructive suite truncates tables — refuse dev databases.
// (The ??= defaults below run before src is imported, so an unexported
// DATABASE_URL gets the test default, never the .env dev value.)
if ((process.env['DATABASE_URL'] ?? '').includes('_dev')) {
  throw new Error(
    'Refusing to run tests against a _dev database — export a dedicated test DATABASE_URL.',
  );
}

// Set required env BEFORE importing modules that read process.env at load time.
process.env['DATABASE_URL'] ??= 'postgres://heorth:changeme@localhost:5432/heorth';
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
