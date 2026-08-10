import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { seedHousehold } from '@wyrhta/core/household';
import { db } from './db/index.js';
import { config } from './config/env.js';
import { createApp } from './app.js';
import { ALL_MODULES } from './modules/index.js';
import { buildMcpServer } from './mcp/server.js';
import { startM365Scheduler } from './m365/scheduler.js';
import { repairMaintenanceAdmin } from './household/maintenance-admin.js';

/**
 * Migrate, seed the household + admin (both idempotent), and build the app + MCP server.
 */
export async function bootstrap(): Promise<{
  app: ReturnType<typeof createApp>;
  mcpServer: ReturnType<typeof buildMcpServer>;
}> {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await seedHousehold(db, { name: config.householdName });
  // Seeds the maintenance admin, re-syncs its env credentials, and strips any
  // household data it accumulated. Idempotent — safe on every boot.
  await repairMaintenanceAdmin({
    adminEmail: config.adminEmail,
    adminPassword: config.adminPassword,
  });

  const app = createApp(ALL_MODULES);
  const mcpServer = buildMcpServer(ALL_MODULES);
  return { app, mcpServer };
}

async function main() {
  console.log('Booting Heorth: migrations, household + admin seed/repair, module registration...');
  const { app, mcpServer } = await bootstrap();

  // Mount the MCP HTTP transport on the same server.
  app.all('/mcp', (c) => mcpServer.fetch(c.req.raw));

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Heorth running on http://localhost:${info.port}`);
  });

  // Start the M365 read-only mirror poll loop. No-op when the integration is
  // disabled or under tests (see scheduler.ts) — zero impact in either case.
  startM365Scheduler();
}

// Only auto-run when executed directly (not when imported by tests).
if (process.env['VITEST'] === undefined) {
  main().catch((err) => {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  });
}
