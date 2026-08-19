import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    // Raised above the 5s/10s defaults on measurement, not on suspicion: on this
    // dev cluster (Postgres in Docker on Windows) checkpoints average 4375ms of
    // fsync each, and during those episodes a test that normally runs in
    // 400-515ms was measured at 5.5-5.7s while its siblings stayed fast — and
    // the `beforeAll` migrate() in tests/setup.ts blew past 10s. These leave
    // roughly 3x headroom over the worst measured stall. The stalls are host
    // I/O; this only stops them from being reported as test failures.
    testTimeout: 20000,
    hookTimeout: 30000,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
