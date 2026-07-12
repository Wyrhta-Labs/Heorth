import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import {
  users,
  apiKeys,
  createUser as coreCreateUser,
  authenticate as coreAuthenticate,
  issueToken as coreIssueToken,
  createApiKey as coreCreateApiKey,
  listApiKeys as coreListApiKeys,
  revokeApiKey as coreRevokeApiKey,
  validateApiKey as coreValidateApiKey,
  isUniqueViolation,
  hashPassword,
  type Role,
  type User,
} from '@wyrhta/core/identity';
import { createAuthGuards, type Principal } from '@wyrhta/core/auth';
import {
  seedHousehold as coreSeedHousehold,
  listMembers as coreListMembers,
  setRole as coreSetRole,
  household,
} from '@wyrhta/core/household';
import { db } from './db/index.js';
import { config } from './config/env.js';

/**
 * Thin wiring layer over @wyrhta/core. Core exports standalone functions (not
 * `create*Service` factories) that take `db` as their first argument, uses a
 * `principal` context key (not `auth`), and does NOT ship `getUser/updateUser/
 * deleteUser`. This file is the single place that reconciles all of that, so
 * module code depends only on the stable surface below.
 */

export const API_KEY_PREFIX = 'he_';

/** Validate a raw `he_` key and resolve its owning user + role (REST api-key path). */
async function resolveApiKey(raw: string): Promise<Principal | null> {
  const keyRow = await coreValidateApiKey(raw, async (hash: string) => {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    return row ?? null;
  });
  if (!keyRow) return null;
  const [user] = await db.select().from(users).where(eq(users.id, keyRow.userId)).limit(1);
  if (!user) return null;
  return { type: 'api_key', userId: user.id, role: user.role };
}

/** Identity: core fns partially applied over `db`, plus locally-built user CRUD. */
export const identity = {
  createUser: (input: Parameters<typeof coreCreateUser>[1]) => coreCreateUser(db, input),
  authenticate: (email: string, password: string) => coreAuthenticate(db, email, password),
  issueToken: (user: { id: string; role: Role }) =>
    coreIssueToken(user, config.jwtSecret, config.jwtTtlSeconds),
  createApiKey: (userId: string, name: string) => coreCreateApiKey(db, userId, name, API_KEY_PREFIX),
  listApiKeys: (userId: string) => coreListApiKeys(db, userId),
  revokeApiKey: (userId: string, keyId: string) => coreRevokeApiKey(db, userId, keyId),
  validateApiKey: resolveApiKey,

  // Core has no getUser/updateUser/deleteUser — implement directly on the users table.
  async getUser(id: string): Promise<User | null> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  },
  async updateUser(
    id: string,
    patch: { displayName?: string; avatarColor?: string; email?: string; password?: string },
  ): Promise<User | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) set['displayName'] = patch.displayName;
    if (patch.avatarColor !== undefined) set['avatarColor'] = patch.avatarColor;
    if (patch.email !== undefined) set['email'] = patch.email;
    if (patch.password !== undefined) set['passwordHash'] = await hashPassword(patch.password);
    const [row] = await db.update(users).set(set).where(eq(users.id, id)).returning();
    return row ?? null;
  },
  async deleteUser(id: string): Promise<User | null> {
    const [row] = await db.delete(users).where(eq(users.id, id)).returning();
    return row ?? null;
  },

  isUniqueViolation,
};

/** Household: core fns over `db`, plus a getHousehold reading the singleton row. */
export const householdCore = {
  seedHousehold: (input: { name: string; timezone?: string; locale?: string }) =>
    coreSeedHousehold(db, input),
  listMembers: () => coreListMembers(db),
  setRole: (userId: string, role: Role) => coreSetRole(db, userId, role),
  async getHousehold() {
    const [row] = await db.select().from(household).limit(1);
    return row ?? null;
  },
};

/**
 * Auth guards built from core's factory, wrapped to also expose the resolved
 * principal under the `auth` context key that Heorth's module routes read.
 */
const coreGuards = createAuthGuards({
  jwtSecret: config.jwtSecret,
  keyPrefix: API_KEY_PREFIX,
  resolveApiKey,
});

function normalize(guard: MiddlewareHandler): MiddlewareHandler {
  return async (c, next) =>
    guard(c, async () => {
      const p = c.get('principal');
      if (p) c.set('auth', { type: p.type, userId: p.userId, role: p.role });
      await next();
    });
}

export const requireAuth = normalize(coreGuards.requireAuth);
export const requireJwt = normalize(coreGuards.requireJwt);
/** requireRole reads `principal`, which requireAuth sets before this runs. */
export const requireRole = coreGuards.requireRole;
