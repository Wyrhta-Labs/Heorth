import { z } from 'zod';

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
} as const;
