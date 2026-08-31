import { sign, verify } from 'hono/jwt';
import { config } from '../config/env.js';

/**
 * The OAuth `state` parameter is a short-lived signed token binding the connect
 * flow to the member who started it. Signed with the same HS256 `JWT_SECRET` as
 * the app's sessions, so the callback can trust the member id without a session
 * cookie (the Microsoft redirect does not carry the API bearer token).
 */

const PURPOSE = 'm365-connect';
const TTL_SECONDS = 600; // 10 minutes to complete the consent round-trip.

export async function signConnectState(memberId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: memberId, purpose: PURPOSE, iat: now, exp: now + TTL_SECONDS }, config.jwtSecret);
}

/** Verify a callback `state`, returning the bound member id, or null if invalid. */
export async function verifyConnectState(state: string): Promise<string | null> {
  try {
    const payload = (await verify(state, config.jwtSecret, 'HS256')) as { sub?: string; purpose?: string };
    if (payload.purpose !== PURPOSE || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
