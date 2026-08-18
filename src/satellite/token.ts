import { signToken, type Role } from '@wyrhta/core/identity';
import { config } from '../config/env.js';
import { getSatelliteKeys } from './keys.js';

/**
 * Satellite token exchange (B3, ADR 0009).
 *
 * A caller presenting a credential Heorth already accepts (`he_` API key or a
 * member JWT) trades it for a short-lived, audience-bound member token for ONE
 * named satellite. Only Heorth can do this: it is the sole authority on who
 * the household's members are, and heorth-mcp deliberately holds no signing
 * key so that a compromise of the translator cannot mint identities.
 *
 * Three invariants live here:
 *
 * 1. **The token grants no more than its bearer already had.** `sub` and
 *    `role` come from the authenticated principal — never from the request
 *    body. A satellite must not treat the token as privileged merely because
 *    Heorth issued it.
 * 2. **Only known audiences are minted for.** The allowlist is deployment
 *    config (`SATELLITE_AUDIENCES`); an unknown audience is refused rather
 *    than minted optimistically. Registering a satellite is deliberate
 *    friction, not an oversight.
 * 3. **It is signed with the satellite private key, never `JWT_SECRET`.**
 *    `JWT_SECRET` signs member logins AND derives the M365 refresh-token
 *    encryption key (`src/m365/crypto.ts`); it never leaves this service and
 *    must never be reused here. If no satellite key is configured the mint
 *    FAILS — it never silently falls back to another key.
 */

/**
 * TTL of an exchanged token, in seconds. ADR 0009 fixes this at 5 minutes:
 * exchange is one cheap local call and heorth-mcp caches the result, so a
 * short life costs almost nothing — and a leaked token expires before it is
 * useful, which is why no revocation list is needed.
 */
export const SATELLITE_TOKEN_TTL_SECONDS = 300;

/** The `iss` claim every satellite token carries. */
export const SATELLITE_TOKEN_ISSUER = 'heorth';

/** Why an exchange was refused. Both map to a domain code, never a 500. */
export type SatelliteTokenErrorCode = 'UNKNOWN_AUDIENCE' | 'SIGNING_UNAVAILABLE';

export class SatelliteTokenError extends Error {
  constructor(readonly code: SatelliteTokenErrorCode) {
    super(code);
    this.name = 'SatelliteTokenError';
  }
}

/**
 * Test/runtime seam over the configured audience allowlist, mirroring
 * `setSatelliteKeys`. `null` resets to the env-derived list.
 */
let audienceOverride: readonly string[] | null = null;

/** The satellites this deployment will mint tokens for. */
export function getSatelliteAudiences(): readonly string[] {
  return audienceOverride ?? config.satelliteAudiences;
}

/** Test seam: install an audience allowlist (or `null` to reset to env). */
export function setSatelliteAudiences(next: readonly string[] | null): void {
  audienceOverride = next;
}

/** What the exchange endpoint returns (minus the envelope). */
export interface SatelliteTokenResult {
  token: string;
  /** Seconds until `exp`, so a caller need not parse the token to renew. */
  expiresIn: number;
  /** Echo of the audience the token is bound to. */
  audience: string;
}

/**
 * Mint a satellite token for `principal`, bound to `audience`.
 *
 * The principal MUST be the authenticated caller. Nothing from the request
 * body reaches the claims except the audience, which is checked against the
 * allowlist first.
 */
export async function mintSatelliteToken(
  principal: { userId: string; role: Role },
  audience: string,
): Promise<SatelliteTokenResult> {
  if (!getSatelliteAudiences().includes(audience)) {
    throw new SatelliteTokenError('UNKNOWN_AUDIENCE');
  }
  const { signingKey } = await getSatelliteKeys();
  if (!signingKey) {
    // No key configured (or only publish-only material). Refuse cleanly —
    // signing with anything else, `JWT_SECRET` above all, is not an option.
    throw new SatelliteTokenError('SIGNING_UNAVAILABLE');
  }
  const token = await signToken(
    {
      sub: principal.userId,
      role: principal.role,
      iss: SATELLITE_TOKEN_ISSUER,
      aud: audience,
    },
    signingKey,
    SATELLITE_TOKEN_TTL_SECONDS,
  );
  return { token, expiresIn: SATELLITE_TOKEN_TTL_SECONDS, audience };
}
