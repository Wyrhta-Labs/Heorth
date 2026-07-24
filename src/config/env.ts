import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Load .env from the working directory for local dev (`npm run dev` etc.).
// Never overrides variables already present in the environment — exported
// vars always win, so test runs pointing DATABASE_URL at the test database
// cannot be hijacked by a dev .env. Full-line comments only (no inline `#`).
try {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
} catch {
  // no .env file — rely on the real environment (CI, docker, production)
}

/** Treat an empty string as "not provided" (undefined), then apply `inner`. */
function emptyToUndefined<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), inner.optional());
}

export function buildEnvSchema() {
  return z.object({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
    HOUSEHOLD_NAME: z.string().min(1),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(1),
    API_PORT: z.coerce.number().int().positive().default(3000),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    CORS_ORIGIN: z.string().default('*'),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    // Feoh satellite service — Heorth proxies its finance routes to this
    // independent service and authenticates with one service API key. Both are
    // required (production and test alike); the test env points them at a stub.
    FEOH_BASE_URL: z.string().url(),
    FEOH_API_KEY: z.string().min(1),
    TRAKT_CLIENT_ID: z.string().min(1).optional(),
    TRAKT_CLIENT_SECRET: z.string().min(1).optional(),
    LIBRARY_ENCRYPTION_KEY: z.string().min(1).optional(),
    // Microsoft 365 integration (Phase 2). Optional AS A GROUP: either all six
    // present (integration enabled) or all absent (integration disabled). Partial
    // presence is a startup error (see superRefine). Absent = zero impact: the
    // m365 area does not register any routes and boot/tests are unaffected.
    // `emptyToUndefined` so a blank value (e.g. a placeholder-only `.env`, or a
    // test that explicitly blanks the group) counts as absent, not as a
    // validation error — this is what keeps the group cleanly all-or-nothing.
    M365_TENANT_ID: emptyToUndefined(z.string().min(1)),
    M365_CLIENT_ID: emptyToUndefined(z.string().min(1)),
    M365_CLIENT_SECRET: emptyToUndefined(z.string().min(1)),
    M365_REDIRECT_URI: emptyToUndefined(z.string().url()),
    M365_FAMILY_MAILBOX: emptyToUndefined(z.string().min(1)),
    M365_SHARED_TODO_LIST: emptyToUndefined(z.string().min(1)),
    // Background mirror poll interval. OPTIONAL and INDEPENDENT of the all-or-
    // nothing group above (a tuning knob, not a credential): default 300s, floored
    // at 60s by the scheduler. Absent when the integration is disabled anyway.
    M365_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  }).superRefine((env, ctx) => {
    const m365Keys = [
      'M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET',
      'M365_REDIRECT_URI', 'M365_FAMILY_MAILBOX', 'M365_SHARED_TODO_LIST',
    ] as const;
    const present = m365Keys.filter((k) => env[k] !== undefined && env[k] !== '');
    if (present.length > 0 && present.length < m365Keys.length) {
      const missing = m365Keys.filter((k) => env[k] === undefined || env[k] === '');
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['M365'],
        message:
          `M365 integration is partially configured — set all of [${m365Keys.join(', ')}] ` +
          `or none. Missing: ${missing.join(', ')}.`,
      });
    }
  });
}

const parsed = buildEnvSchema().safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  householdName: parsed.data.HOUSEHOLD_NAME,
  adminEmail: parsed.data.ADMIN_EMAIL,
  adminPassword: parsed.data.ADMIN_PASSWORD,
  port: parsed.data.API_PORT,
  jwtTtlSeconds: parsed.data.JWT_TTL_SECONDS,
  corsOrigin: parsed.data.CORS_ORIGIN,
  dbPoolMax: parsed.data.DB_POOL_MAX,
  feohBaseUrl: parsed.data.FEOH_BASE_URL,
  feohApiKey: parsed.data.FEOH_API_KEY,
  traktClientId: parsed.data.TRAKT_CLIENT_ID,
  traktClientSecret: parsed.data.TRAKT_CLIENT_SECRET,
  libraryEncryptionKey: parsed.data.LIBRARY_ENCRYPTION_KEY,
  // Mirror poll interval (seconds). Independent optional tuning knob; the
  // scheduler floors it at 60s and only runs when the integration is enabled.
  m365SyncIntervalSeconds: parsed.data.M365_SYNC_INTERVAL_SECONDS,
  // Resolved M365 config, or null when the integration is disabled (env absent).
  // The env schema guarantees this is all-or-nothing, so the presence of
  // M365_TENANT_ID implies the whole group is present.
  m365:
    parsed.data.M365_TENANT_ID
      ? {
          tenantId: parsed.data.M365_TENANT_ID,
          clientId: parsed.data.M365_CLIENT_ID!,
          clientSecret: parsed.data.M365_CLIENT_SECRET!,
          redirectUri: parsed.data.M365_REDIRECT_URI!,
          familyMailbox: parsed.data.M365_FAMILY_MAILBOX!,
          sharedTodoList: parsed.data.M365_SHARED_TODO_LIST!,
        }
      : null,
} as const;

/** The resolved Microsoft 365 config shape (present only when enabled). */
export type M365Config = NonNullable<typeof config.m365>;
