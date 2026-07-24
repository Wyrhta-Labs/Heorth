import { beforeAll, beforeEach } from 'vitest';

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
