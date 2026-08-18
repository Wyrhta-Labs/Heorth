import {
  loadPrivateKey,
  loadPublicKey,
  publicKeyFromPrivate,
  toJwks,
  type AsymmetricJwtAlgorithm,
  type JwksDocument,
  type PrivateSigningKey,
  type PublicVerificationKey,
} from '@wyrhta/core/identity';
import { config, type SatelliteConfig } from '../config/env.js';

/**
 * Satellite identity signing keys (B1c, Wyrhta-Labs/wyrhta-labs#1).
 *
 * Heorth is the household's identity provider for satellite services. It signs
 * satellite tokens with an ASYMMETRIC private key and publishes the public
 * half as a JWKS, so a satellite can only ever VERIFY and is structurally
 * unable to mint. A shared signing secret was rejected for exactly that
 * reason.
 *
 * This key is SEPARATE from `JWT_SECRET`. `JWT_SECRET` signs member login
 * tokens *and* derives the M365 refresh-token encryption key
 * (`src/m365/crypto.ts`); it must never leave this service and is untouched by
 * anything here.
 *
 * ROTATION: `config.satellite.active` is the single key tokens are signed
 * with; `config.satellite.secondary` is published alongside it but never
 * signs. That overlap slot is what makes a rotation non-disruptive — see the
 * "Rotating the satellite signing key" section of README.md for the operator
 * procedure.
 *
 * Core reads no env and no files, so this module is the seam that turns
 * validated env into loaded key material.
 */

/** The loaded key material for this deployment. */
export interface SatelliteKeySet {
  /**
   * The key satellite tokens are signed with, or `null` when the feature is
   * not configured. Only ever held in memory here; never serialized outward.
   */
  signingKey: PrivateSigningKey | null;
  /**
   * Every public key published in the JWKS — the active key's public half plus
   * the rotation-overlap key when one is configured. Empty when unconfigured.
   */
  publicKeys: PublicVerificationKey[];
}

/**
 * A PEM carries newlines, which a single-line `.env` (and most container env
 * plumbing) cannot hold. Accept the conventional `\n`-escaped form and restore
 * the real newlines before handing the material to core. JWK JSON needs no
 * such treatment but is harmless to pass through — a JSON string containing a
 * literal `\n` escape inside a value is not something key material has.
 */
function normalizeMaterial(material: string): string {
  return material.includes('-----BEGIN') || material.includes('\\n')
    ? material.replace(/\\n/g, '\n')
    : material;
}

/**
 * Load publish-only material, which may be either half of a key pair: a
 * private key (the operator has not yet removed the outgoing key's private
 * material) or a bare public key (they have). Either way only the public half
 * is ever returned, so the secondary slot can never become a signing key.
 */
async function loadPublishOnlyKey(
  material: string,
  options: { kid: string; alg: AsymmetricJwtAlgorithm },
): Promise<PublicVerificationKey> {
  try {
    return await loadPublicKey(material, options);
  } catch {
    // Not public material — try the private form and immediately drop the
    // private component. A genuinely bad value fails again here and the
    // bare `INVALID_KEY_MATERIAL` from core propagates.
    return publicKeyFromPrivate(await loadPrivateKey(material, options));
  }
}

/** Load a key set from an explicit config (production passes `config.satellite`). */
export async function loadSatelliteKeys(cfg: SatelliteConfig | null): Promise<SatelliteKeySet> {
  if (!cfg) return { signingKey: null, publicKeys: [] };

  const signingKey = await loadPrivateKey(normalizeMaterial(cfg.active.material), {
    kid: cfg.active.kid,
    alg: cfg.active.alg,
  });
  const publicKeys: PublicVerificationKey[] = [publicKeyFromPrivate(signingKey)];

  if (cfg.secondary) {
    if (cfg.secondary.kid === cfg.active.kid) {
      // Two keys sharing a kid would make verification ambiguous — core selects
      // a verification key BY kid, so the satellite could pick the wrong one.
      throw new Error('DUPLICATE_KEY_ID');
    }
    publicKeys.push(
      await loadPublishOnlyKey(normalizeMaterial(cfg.secondary.material), {
        kid: cfg.secondary.kid,
        alg: cfg.secondary.alg,
      }),
    );
  }

  return { signingKey, publicKeys };
}

let cached: Promise<SatelliteKeySet> | null = null;

/**
 * The lazily-loaded singleton key set. Loading is async (WebCrypto import) and
 * pure, so the promise itself is cached — concurrent JWKS requests share one
 * load, and a failed load is not cached silently: the rejected promise is
 * cleared so the next call retries and surfaces the error again.
 */
export function getSatelliteKeys(): Promise<SatelliteKeySet> {
  if (!cached) {
    cached = loadSatelliteKeys(config.satellite).catch((e: unknown) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

/** Test seam: install a key set (or null to reset to the env-derived one). */
export function setSatelliteKeys(next: SatelliteKeySet | null): void {
  cached = next ? Promise.resolve(next) : null;
}

/** Whether an active satellite signing key is configured. */
export function isSatelliteSigningConfigured(): boolean {
  return config.satellite !== null;
}

/**
 * The JWKS document to publish. Built by core's `toJwks`, which emits public
 * members only — a private component can never reach it. An empty `keys` array
 * is the correct, standard answer when nothing is configured.
 */
export async function getSatelliteJwks(): Promise<JwksDocument> {
  return toJwks((await getSatelliteKeys()).publicKeys);
}
