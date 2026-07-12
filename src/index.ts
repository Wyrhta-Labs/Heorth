import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { seedHousehold } from '@wyrhta/core/household';
import { createUser, users } from '@wyrhta/core/identity';
import { db } from './db/index.js';
import { config } from './config/env.js';
import { createApp } from './app.js';
import { ALL_MODULES } from './modules/index.js';
import { buildMcpServer } from './mcp/server.js';

/**
 * Seed the single admin user (idempotent). Core's `seedHousehold` creates only
 * the household row — it does NOT create the admin — so Heorth seeds the admin
 * itself from the validated env config.
 */
async function seedAdmin(): Promise<void> {
  const [existing] = await db.select().from(users).where(eq(users.email, config.adminEmail)).limit(1);
  if (existing) return;
  await createUser(db, {
    email: config.adminEmail,
    handle: 'admin',
    password: config.adminPassword,
    role: 'admin',
    displayName: 'Admin',
  });
}

/**
 * Migrate, seed the household + admin (both idempotent), and build the app + MCP server.
 */
export async function bootstrap(): Promise<{
  app: ReturnType<typeof createApp>;
  mcpServer: ReturnType<typeof buildMcpServer>;
}> {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await seedHousehold(db, { name: config.householdName });
  await seedAdmin();

  const app = createApp(ALL_MODULES);
  const mcpServer = buildMcpServer(ALL_MODULES);
  return { app, mcpServer };
}

async function main() {
  console.log('Booting Heorth: migrations, household + admin seed, module registration...');
  const { app, mcpServer } = await bootstrap();

  // Mount the MCP HTTP transport on the same server.
  app.all('/mcp', (c) => mcpServer.fetch(c.req.raw));

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Heorth running on http://localhost:${info.port}`);
  });
}

// Only auto-run when executed directly (not when imported by tests).
if (process.env['VITEST'] === undefined) {
  main().catch((err) => {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  });
}
