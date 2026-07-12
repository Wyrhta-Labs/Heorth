import { sign } from 'hono/jwt';
import { z } from 'zod';
import { config } from '../src/config/env.js';
import { identity, householdCore } from '../src/wiring.js';
import type { McpTool } from '@wyrhta/core/mcp';
import type { Role } from '@wyrhta/core/identity';

type Member = Awaited<ReturnType<typeof identity.createUser>>;

export interface SeededMember {
  user: Member;
  jwt: string;
}

async function jwtFor(user: Member): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: user.id, role: user.role, iat: now, exp: now + 3600 }, config.jwtSecret);
}

/** Seed the household + an admin, plus one adult and one child member, with JWTs. */
export async function seedTestHousehold(): Promise<{
  admin: SeededMember;
  adult: SeededMember;
  child: SeededMember;
}> {
  await householdCore.seedHousehold({ name: 'Test Household' });
  const admin = await identity.createUser({
    email: 'admin@test.local', handle: 'admin', password: 'test-admin-password',
    role: 'admin', displayName: 'Admin', avatarColor: 'ember',
  });
  const adult = await identity.createUser({
    email: 'adult@test.local', handle: 'adult', password: 'pw-adult-1',
    role: 'adult', displayName: 'Adult', avatarColor: 'sage',
  });
  const child = await identity.createUser({
    email: 'child@test.local', handle: 'child', password: 'pw-child-1',
    role: 'child', displayName: 'Child', avatarColor: 'sky',
  });
  return {
    admin: { user: admin, jwt: await jwtFor(admin) },
    adult: { user: adult, jwt: await jwtFor(adult) },
    child: { user: child, jwt: await jwtFor(child) },
  };
}

export function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
}

/**
 * Invoke an MCP tool the way core's scaffold would: validate `input` against the
 * tool's ZodRawShape, call the handler with a `{ principal, requestId }` context,
 * and unwrap the JSON text from the McpToolResult.
 */
export async function invokeTool(
  tools: McpTool[],
  name: string,
  ctx: { userId: string; role: Role },
  input: unknown,
): Promise<any> {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`MCP tool not found: ${name}`);
  const parsed = z.object(t.inputSchema).parse(input ?? {});
  const res = await t.handler({ principal: { userId: ctx.userId, role: ctx.role }, requestId: 'test' }, parsed);
  return JSON.parse(res.content[0]!.text);
}
