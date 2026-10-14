import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    // Raised above the 5s/10s defaults as headroom for a slow host, not because
    // any test needs it. They were set while the suite shared the dev cluster,
    // whose checkpoint fsync stalls pushed single tests past 5s and the
    // `beforeAll` migrate() in tests/setup.ts past 10s. The suite now runs on
    // its own disposable cluster (`db-test`), so that cause is gone; the values
    // stay as a cheap guard against host I/O hiccups (Postgres in Docker on
    // Windows) being reported as test failures.
    testTimeout: 20000,
    hookTimeout: 30000,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
