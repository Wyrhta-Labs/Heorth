import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/drizzle-schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://heorth:changeme@localhost:5432/heorth',
  },
});
