import { Hono } from 'hono';
import { ok, err, rateLimit } from '@wyrhta/core/http';
import { logEvent } from '@wyrhta/core/lib';
import { requireAuth, requireJwt, requireRole, identity } from '../wiring.js';
import * as service from './service.js';
import { householdOptions } from './options.js';
import { isMaintenanceAdminId } from './maintenance-admin.js';
import {
  createMemberSchema, updateMemberSchema, setRoleSchema,
  updateHouseholdSchema, loginSchema, createKeySchema, satelliteTokenSchema,
} from './validators.js';
import { mintSatelliteToken, SatelliteTokenError } from '../satellite/token.js';

export const householdRouter = new Hono();
householdRouter.use('*', requireAuth);

householdRouter.get('/', async (c) => {
  const h = await service.getHousehold();
  if (!h) return err(c, 'NOT_FOUND', 'Household not seeded', 404);
  return ok(c, h);
});
// The allowed timezone/locale values the settings UI offers — and the exact set
// `PATCH /` accepts. Readable by any authenticated member (it is static config,
// not household data); only admins can act on it.
householdRouter.get('/options', (c) => ok(c, householdOptions()));

householdRouter.patch('/', requireRole('admin'), async (c) => {
  const body = updateHouseholdSchema.safeParse(await c.req.json());
  if (!body.success) {
    // Surface the field-level reason (e.g. 'Unsupported timezone') so an API
    // client that bypassed the select knows what to fix.
    return err(c, 'VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid request body', 400);
  }
  const h = await service.updateHousehold(body.data);
  return ok(c, h);
});

export const membersRouter = new Hono();
membersRouter.use('*', requireAuth);

membersRouter.get('/', async (c) => {
  const members = await service.listMembers();
  return ok(c, members, { total: members.length });
});

membersRouter.post('/', requireRole('admin'), async (c) => {
  const body = createMemberSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const member = await service.createMember(body.data);
    logEvent({ event: 'member.created', member_id: member.id, request_id: c.get('requestId') });
    return ok(c, member, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'EMAIL_TAKEN') {
      return err(c, 'CONFLICT', 'A member with that email already exists', 409);
    }
    throw e;
  }
});

membersRouter.get('/:id', async (c) => {
  const member = await service.getMember(c.req.param('id'));
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  return ok(c, member);
});

membersRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const auth = c.get('auth');
  if (auth.role !== 'admin' && auth.userId !== id) {
    return err(c, 'FORBIDDEN', 'You may only edit your own profile', 403);
  }
  const body = updateMemberSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  // Maintenance credentials (email AND password) are env-only by design — see
  // `repairMaintenanceAdmin`, which re-syncs both from env on every boot, so a
  // manual change here would just be silently overwritten anyway.
  // NOTE: `updateMemberSchema` currently has no `handle` field, which is why a
  // handle change is already impossible; if one is ever added, it MUST be
  // guarded here too — the quarantine is anchored on the handle.
  if ((body.data.email !== undefined || body.data.password !== undefined) && (await isMaintenanceAdminId(id))) {
    return err(c, 'ADMIN_PROTECTED', 'The maintenance account credentials are managed by env', 403);
  }
  const member = await service.updateMember(id, body.data);
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  return ok(c, member);
});

membersRouter.patch('/:id/role', requireRole('admin'), async (c) => {
  if (await isMaintenanceAdminId(c.req.param('id'))) {
    return err(c, 'ADMIN_PROTECTED', 'The maintenance account cannot be demoted', 403);
  }
  const body = setRoleSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const member = await service.setMemberRole(c.req.param('id'), body.data.role);
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  logEvent({ event: 'member.role_changed', member_id: member.id, role: body.data.role, request_id: c.get('requestId') });
  return ok(c, member);
});

membersRouter.delete('/:id', requireRole('admin'), async (c) => {
  try {
    if (await isMaintenanceAdminId(c.req.param('id'))) {
      return err(c, 'ADMIN_PROTECTED', 'The maintenance account cannot be removed', 403);
    }
    const member = await service.deleteMember(c.req.param('id'), c.get('auth').userId);
    if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
    return ok(c, { id: member.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'CANNOT_DELETE_SELF') return err(c, 'FORBIDDEN', 'You cannot delete yourself', 403);
    if (e instanceof Error && e.message === 'LAST_ADMIN') return err(c, 'CONFLICT', 'Cannot remove the last admin', 409);
    throw e;
  }
});

export const authRouter = new Hono();

authRouter.post('/token', rateLimit(), async (c) => {
  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const result = await service.login(body.data.email, body.data.password);
  if (!result) {
    logEvent({ event: 'auth.token.failure', email: body.data.email, request_id: c.get('requestId') });
    return err(c, 'UNAUTHORIZED', 'Invalid email or password', 401);
  }
  logEvent({ event: 'auth.token.success', member_id: result.user.id, request_id: c.get('requestId') });
  return ok(c, { token: result.token, expires_in: result.expiresIn });
});

authRouter.get('/whoami', requireAuth, async (c) => {
  const member = await service.getMember(c.get('auth').userId);
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  return ok(c, member);
});

// Keys are self-scoped (each handler uses `auth.userId`), but the role gate is
// still required: children get no programmatic credential for the household API.
// `requireJwt` sets `principal`, which `requireRole` reads — so this composes.
authRouter.get('/keys', requireJwt, requireRole('admin', 'adult'), async (c) => {
  const keys = await identity.listApiKeys(c.get('auth').userId);
  return ok(c, keys);
});

authRouter.post('/keys', requireJwt, requireRole('admin', 'adult'), async (c) => {
  const body = createKeySchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const key = await identity.createApiKey(c.get('auth').userId, body.data.name);
  logEvent({ event: 'auth.key.created', key_id: key.id, member_id: c.get('auth').userId, request_id: c.get('requestId') });
  return ok(c, key, undefined, 201);
});

authRouter.delete('/keys/:id', requireJwt, requireRole('admin', 'adult'), async (c) => {
  const id = c.req.param('id');
  const revoked = await identity.revokeApiKey(c.get('auth').userId, id);
  if (!revoked) return err(c, 'NOT_FOUND', 'API key not found', 404);
  logEvent({ event: 'auth.key.revoked', key_id: id, member_id: c.get('auth').userId, request_id: c.get('requestId') });
  return ok(c, { id });
});

/**
 * Satellite token exchange (B3, ADR 0009): trade a credential Heorth already
 * accepts for a short-lived, audience-bound member token for ONE named
 * satellite. This is how member identity reaches KithLedger without any
 * component but Heorth being able to assert it — heorth-mcp holds no signing
 * key and must stay unmintable.
 *
 * `requireAuth`, so an `he_` API key or a member JWT both work; the claims are
 * built from the resolved principal, so the token grants exactly what its
 * bearer already had and nothing in the body can change whose identity is
 * minted.
 *
 * Rate-limited like `POST /token` above — it is credential-minting surface —
 * but with a budget sized for a machine caller rather than a human typing a
 * password: heorth-mcp is one source IP for the whole household, and with a
 * 5-minute TTL every member behind it needs ~3 mints per 15-minute window.
 * The default 10/window would lock the household out; 60 leaves ample room
 * while still capping a runaway or hostile caller.
 */
authRouter.post(
  '/satellite-token',
  rateLimit({ max: 60 }),
  requireAuth,
  async (c) => {
    const raw = await c.req.json().catch(() => null);
    const body = satelliteTokenSchema.safeParse(raw);
    if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
    const auth = c.get('auth');
    try {
      // userId/role come from the PRINCIPAL, never from `raw`.
      const result = await mintSatelliteToken(
        { userId: auth.userId, role: auth.role },
        body.data.audience,
      );
      // Audited: this mints a credential. Heorth only ever sees heorth-mcp's
      // cache MISSES (ADR 0009 caches for the token's life), so the volume is
      // bounded at roughly one line per member per TTL. No token material,
      // and no key material, is ever logged.
      logEvent({
        event: 'auth.satellite_token.issued',
        member_id: auth.userId,
        role: auth.role,
        audience: result.audience,
        credential: auth.type,
        expires_in: result.expiresIn,
        request_id: c.get('requestId'),
      });
      return ok(c, { token: result.token, expires_in: result.expiresIn, audience: result.audience });
    } catch (e: unknown) {
      if (e instanceof SatelliteTokenError) {
        // Refusals are audited too: a request for an audience nobody trusts is
        // exactly the signal worth having.
        logEvent({
          event: 'auth.satellite_token.refused',
          member_id: auth.userId,
          // Truncated: on the refusal path this is unvalidated caller input,
          // and a log line is not the place for an arbitrarily long string.
          audience: body.data.audience.slice(0, 64),
          reason: e.code,
          request_id: c.get('requestId'),
        });
        if (e.code === 'UNKNOWN_AUDIENCE') {
          return err(c, 'UNKNOWN_AUDIENCE', 'Unknown satellite audience', 400);
        }
        // Configured audience, but no signing key on this deployment. A
        // deliberate, explicit refusal — never a 500, and never a token signed
        // with something else (JWT_SECRET stays inside this service).
        // `err` from core caps at 500, so this 503 is built directly — the
        // same precedent as kith's 502 (`src/modules/kith/routes.ts`).
        return c.json(
          {
            error: {
              code: 'SATELLITE_SIGNING_UNAVAILABLE',
              message: 'Satellite token signing is not configured on this deployment',
            },
          },
          503,
        );
      }
      throw e;
    }
  },
);
