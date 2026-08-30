import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { seedHousehold } from '@wyrhta/core/household';
import { db } from './db/index.js';
import { config } from './config/env.js';
import { createApp } from './app.js';
import { ALL_MODULES } from './modules/index.js';
import { startIntegrationsScheduler } from './integrations/scheduler.js';
import { startWeorcScheduler } from './modules/weorc/scheduler.js';
import { repairMaintenanceAdmin } from './household/maintenance-admin.js';

/**
 * Migrate, seed the household + admin (both idempotent), and build the app.
 */
export async function bootstrap(): Promise<{ app: ReturnType<typeof createApp> }> {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await seedHousehold(db, { name: config.householdName });
  // Seeds the maintenance admin, re-syncs its env credentials, and strips any
  // household data it accumulated. Idempotent — safe on every boot.
  await repairMaintenanceAdmin({
    adminEmail: config.adminEmail,
    adminPassword: config.adminPassword,
  });

  const app = createApp(ALL_MODULES);
  return { app };
}

async function main() {
  console.log('Booting Heorth: migrations, household + admin seed/repair, module registration...');
  const { app } = await bootstrap();

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Heorth running on http://localhost:${info.port}`);
  });

  // Start the integrations poll loop. No-op when no providers are registered
  // or under tests (see scheduler.ts) — zero impact in either case.
  startIntegrationsScheduler();

  // Start Weorc's native due-work tick. Deliberately not gated on M365: it
  // must keep materialising household work even with no task provider attached.
  startWeorcScheduler();
}

// Only auto-run when executed directly (not when imported by tests).
if (process.env['VITEST'] === undefined) {
  main().catch((err) => {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  });
}
