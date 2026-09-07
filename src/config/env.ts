import { z } from 'zod';
import {
  baseEnvSchema,
  emptyToUndefined,
  loadDotEnv,
  parseEnvOrExit,
} from '@wyrhta/core/config';

// Load .env from the working directory for local dev (`npm run dev` etc.).
// Exported vars always win, so a test run pointing DATABASE_URL at the test
// database cannot be hijacked by a dev .env.
//
// Skipped entirely under Vitest: tests/setup.ts owns the test environment,
// and gating suites (feoh/kith/M365) DELETE vars before re-importing this
// module via vi.resetModules() — the "never overrides" guard cannot protect
// a deleted var, so re-reading .env here would silently re-enable modules
// from the developer's local .env and break test hermeticity.
loadDotEnv({ skip: process.env['VITEST'] !== undefined });

export function buildEnvSchema() {
  return baseEnvSchema.extend({
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
    HOUSEHOLD_NAME: z.string().min(1),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(1),
    API_PORT: z.coerce.number().int().positive().default(3000),
    // Library credentials. `emptyToUndefined` like every other optional here:
    // the household stack's compose files pass these as `${VAR:-}`, so an
    // unset variable arrives as an EMPTY STRING, not as absent. Plain
    // `.min(1).optional()` would turn a blank template value into a startup
    // failure — the exact opposite of optional.
    TRAKT_CLIENT_ID: emptyToUndefined(z.string().min(1)),
    TRAKT_CLIENT_SECRET: emptyToUndefined(z.string().min(1)),
    // The AES-256-GCM key for stored library credentials (base64, decoding to
    // exactly 32 bytes — checked in src/modules/library/crypto.ts). Absent
    // means the key is derived from JWT_SECRET by HKDF, which pins JWT_SECRET
    // for the life of those credentials; the module warns at boot.
    LIBRARY_ENCRYPTION_KEY: emptyToUndefined(z.string().min(1)),
    // Microsoft 365 integration (Phase 2). Optional AS A GROUP: either all five
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
    // Google integration (Calendar + Tasks). Optional AS A GROUP with exactly
    // the same contract as M365_* above: all three present (enabled) or all
    // absent (the google module registers as a no-op). Partial presence is a
    // startup error (see superRefine). There is no family-mailbox equivalent —
    // the shared family calendar is a designated `calendar_allowlist` row — and
    // no shared-list equivalent: the household task list is a flag on
    // `todo_list_allowlist`.
    GOOGLE_CLIENT_ID: emptyToUndefined(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: emptyToUndefined(z.string().min(1)),
    GOOGLE_REDIRECT_URI: emptyToUndefined(z.string().url()),
    // Background mirror poll interval. OPTIONAL and INDEPENDENT of the all-or-
    // nothing group above (a tuning knob, not a credential): default 300s, floored
    // at 60s by the scheduler. Absent when the integration is disabled anyway.
    INTEGRATIONS_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
    // KithLedger integration. Optional AS A GROUP, same contract as M365_*:
    // both present → the kith module mounts and proxies upcoming reminders;
    // both absent → zero impact (routes fall through to the catch-all 404);
    // partial presence is a startup error (see superRefine). The key MUST be
    // a `household`-kinded `kl_` key — see KITH_API_KEY_KIND below.
    KITH_BASE_URL: emptyToUndefined(z.string().url()),
    // Browser-facing URL for opening the KithLedger web UI from Heorth. Optional
    // within the KITH group: omitted deployments fall back to KITH_BASE_URL.
    KITH_PUBLIC_URL: emptyToUndefined(z.string().url()),
    KITH_API_KEY: emptyToUndefined(z.string().min(1)),
    // WHICH of ADR 0004 §2's three principals `KITH_API_KEY` is. A `kl_` key
    // carries a kind — member | household | ops — decided by KithLedger when
    // the key was minted, and nothing in the key's TEXT reveals it (they all
    // read `kl_…`). This variable is therefore the operator's DECLARATION of
    // what they pasted, not a check on it: Heorth cannot introspect a key's
    // kind (KithLedger's `GET /auth/keys` needs a local-account JWT, which
    // Heorth does not have and must not have).
    //
    // Only `household` is accepted. The reminders feed is always-on with no
    // logged-in member, so the household dashboard principal — the
    // `household`-visible slice, read-only, member-less by design — is the
    // only correct credential for it. Naming `member` or `ops` is refused at
    // boot with the migration procedure rather than silently accepted: a
    // `member` key would give an always-on dashboard the full personal scope
    // of the account that issued it (exactly what ADR 0004 §2 splits the
    // credentials to prevent), and an `ops` key has no data access at all.
    //
    // Optional WITHIN the group (defaults to `household`, the only legal
    // value, so nothing has to change in an .env that already works); setting
    // it without the group is a startup error like SATELLITE_SIGNING_ALG.
    KITH_API_KEY_KIND: emptyToUndefined(z.enum(['household', 'member', 'ops'])),
    // Satellite identity signing keys (B1c). Heorth signs member tokens for
    // satellite services (KithLedger first) with an ASYMMETRIC key and
    // publishes the public half at /.well-known/jwks.json; a satellite only
    // ever verifies and is structurally unable to mint. This key is SEPARATE
    // from JWT_SECRET, which stays inside Heorth (it also derives the M365
    // refresh-token encryption key, src/m365/crypto.ts) and must never leave
    // this service.
    //
    // Optional AS A GROUP, same contract as M365_*/KITH_*: KEY + KID present →
    // the active signing key is configured and JWKS publishes it; both absent →
    // nothing is published (`GET /.well-known/jwks.json` returns `{"keys":[]}`)
    // and Heorth behaves exactly as before. Partial presence is a startup
    // error (see superRefine).
    //
    // Material: a PKCS#8 PEM or a JWK JSON string. PEMs may use literal `\n`
    // escapes so they survive a single-line .env (see src/satellite/keys.ts).
    SATELLITE_SIGNING_KEY: emptyToUndefined(z.string().min(1)),
    SATELLITE_SIGNING_KID: emptyToUndefined(z.string().min(1)),
    // Algorithm of the active key. Optional WITHIN the group (EdDSA/Ed25519 is
    // the recommended default); RS256 is supported for clients that cannot do
    // Ed25519. Setting it alone, without the group, is a startup error.
    SATELLITE_SIGNING_ALG: emptyToUndefined(z.enum(['EdDSA', 'RS256'])),
    // A SECOND key, published in the JWKS but NEVER used for signing — the
    // rotation overlap slot. It holds either the outgoing key (still verifying
    // tokens in flight) or the incoming one (pre-published before it goes
    // active). Because it is publish-only it accepts PUBLIC material too, so
    // retired private material can be deleted from the host while its public
    // half stays published. Requires the active group to be configured.
    SATELLITE_SIGNING_KEY_SECONDARY: emptyToUndefined(z.string().min(1)),
    SATELLITE_SIGNING_KID_SECONDARY: emptyToUndefined(z.string().min(1)),
    SATELLITE_SIGNING_ALG_SECONDARY: emptyToUndefined(z.enum(['EdDSA', 'RS256'])),
    // The satellites Heorth will mint tokens FOR (B3, ADR 0009): a
    // comma-separated allowlist of audience names, e.g. `kithledger,heimr`.
    // `POST /api/v1/auth/satellite-token` refuses any audience not on this
    // list — a token is never minted optimistically for a service nobody
    // decided to trust. Adding a satellite is therefore an explicit
    // deployment change, which is the friction ADR 0009 asks for.
    //
    // Absent (the default) → the list is empty and EVERY exchange is refused,
    // so the endpoint is inert until an operator opts a satellite in. Names
    // are lowercase slugs so the `aud` claim is stable and comparable
    // byte-for-byte on the satellite side. Requires the active signing key
    // group (an audience with no key to sign for it is a misconfiguration —
    // see superRefine).
    SATELLITE_AUDIENCES: emptyToUndefined(
      z
        .string()
        .transform((raw) => raw.split(',').map((a) => a.trim()).filter((a) => a.length > 0))
        .refine(
          (list) => list.every((a) => /^[a-z][a-z0-9-]*$/.test(a)),
          'SATELLITE_AUDIENCES entries must be lowercase slugs (e.g. kithledger)',
        )
        .refine((list) => new Set(list).size === list.length, 'SATELLITE_AUDIENCES has duplicates'),
    ),
    // Bank ingestion (ADR 0016). Firefly III is a one-way ingestion provider,
    // never the ledger. `true` requires BOTH FIREFLY_BASE_URL and FIREFLY_PAT
    // (see superRefine); blank or `false` means the import scheduler never
    // starts and the sync trigger answers PROVIDER_UNAVAILABLE. The inbox,
    // the rules and confirming pending rows keep working either way — they
    // are pure Feoh writes. The FIREFLY_* values may be present while disabled
    // (compose passes defaults); they are simply unused then.
    FEOH_IMPORT_ENABLED: emptyToUndefined(z.enum(['true', 'false'])),
    FIREFLY_BASE_URL: emptyToUndefined(z.string().url()),
    FIREFLY_PAT: emptyToUndefined(z.string().min(1)),
    // The household's ONE currency (Feoh is single-currency by construction —
    // there is no currency column anywhere). An imported line in any other
    // currency stays in the inbox and is never booked. ISO 4217, default EUR.
    FEOH_CURRENCY: emptyToUndefined(z.string().regex(/^[A-Z]{3}$/, 'FEOH_CURRENCY must be an ISO 4217 code such as EUR')),
  }).superRefine((env, ctx) => {
    const m365Keys = [
      'M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET',
      'M365_REDIRECT_URI', 'M365_FAMILY_MAILBOX',
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
    const googleKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const;
    const googlePresent = googleKeys.filter((k) => env[k] !== undefined && env[k] !== '');
    if (googlePresent.length > 0 && googlePresent.length < googleKeys.length) {
      const missing = googleKeys.filter((k) => env[k] === undefined || env[k] === '');
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE'],
        message:
          `Google integration is partially configured — set all of [${googleKeys.join(', ')}] ` +
          `or none. Missing: ${missing.join(', ')}.`,
      });
    }
    const kithKeys = ['KITH_BASE_URL', 'KITH_API_KEY'] as const;
    const kithPresent = kithKeys.filter((k) => env[k] !== undefined && env[k] !== '');
    if (kithPresent.length > 0 && kithPresent.length < kithKeys.length) {
      const missing = kithKeys.filter((k) => env[k] === undefined || env[k] === '');
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KITH'],
        message:
          `KithLedger integration is partially configured — set all of [${kithKeys.join(', ')}] ` +
          `or none. Missing: ${missing.join(', ')}.`,
      });
    }
    // The declared credential kind (ADR 0004 §2, task B8). Orphaned without
    // the group, and only `household` is a legal value — see the schema above
    // for why Heorth trusts the declaration but refuses the wrong one.
    if (kithPresent.length === 0 && env.KITH_API_KEY_KIND !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KITH'],
        message:
          'KITH_API_KEY_KIND is set without the KithLedger group — also set ' +
          'KITH_BASE_URL and KITH_API_KEY, or unset it.',
      });
    }
    if (kithPresent.length === 0 && env.KITH_PUBLIC_URL !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KITH'],
        message:
          'KITH_PUBLIC_URL is set without the KithLedger group — also set ' +
          'KITH_BASE_URL and KITH_API_KEY, or unset it.',
      });
    }
    if (env.KITH_API_KEY_KIND !== undefined && env.KITH_API_KEY_KIND !== 'household') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KITH'],
        message:
          `KITH_API_KEY_KIND must be 'household' (got '${env.KITH_API_KEY_KIND}'). The always-on ` +
          'reminders feed has no logged-in member, so it may only present the household ' +
          "dashboard key. Mint one in KithLedger as the local admin: POST /api/v1/auth/keys " +
          '{"name":"heorth-dashboard","kind":"household"} — see README.md, "KithLedger ' +
          'reminders".',
      });
    }
    const satelliteKeys = ['SATELLITE_SIGNING_KEY', 'SATELLITE_SIGNING_KID'] as const;
    const satPresent = satelliteKeys.filter((k) => env[k] !== undefined && env[k] !== '');
    if (satPresent.length === 1) {
      const missing = satelliteKeys.filter((k) => env[k] === undefined || env[k] === '');
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SATELLITE'],
        message:
          `Satellite signing key is partially configured — set all of [${satelliteKeys.join(', ')}] ` +
          `or none. Missing: ${missing.join(', ')}.`,
      });
    }
    // The secondary (publish-only) slot is itself all-or-nothing, and is
    // meaningless without an active key — a JWKS with only a retired key would
    // publish keys Heorth cannot sign with.
    const secondaryKeys = ['SATELLITE_SIGNING_KEY_SECONDARY', 'SATELLITE_SIGNING_KID_SECONDARY'] as const;
    const secPresent = secondaryKeys.filter((k) => env[k] !== undefined && env[k] !== '');
    if (secPresent.length === 1) {
      const missing = secondaryKeys.filter((k) => env[k] === undefined || env[k] === '');
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SATELLITE'],
        message:
          `Secondary satellite signing key is partially configured — set all of ` +
          `[${secondaryKeys.join(', ')}] or none. Missing: ${missing.join(', ')}.`,
      });
    }
    if (satPresent.length === 0) {
      const orphans = [
        'SATELLITE_SIGNING_ALG',
        'SATELLITE_SIGNING_KEY_SECONDARY',
        'SATELLITE_SIGNING_KID_SECONDARY',
        'SATELLITE_SIGNING_ALG_SECONDARY',
      ].filter((k) => env[k as keyof typeof env] !== undefined && env[k as keyof typeof env] !== '');
      // Audiences without a signing key would be an allowlist Heorth can never
      // honour: every exchange would fail at signing time instead of at boot.
      if (env.SATELLITE_AUDIENCES !== undefined && env.SATELLITE_AUDIENCES.length > 0) {
        orphans.push('SATELLITE_AUDIENCES');
      }
      if (orphans.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SATELLITE'],
          message:
            `[${orphans.join(', ')}] set without an active signing key — also set ` +
            'SATELLITE_SIGNING_KEY and SATELLITE_SIGNING_KID, or unset these.',
        });
      }
    }
    if (env.FEOH_IMPORT_ENABLED === 'true') {
      const missing = (['FIREFLY_BASE_URL', 'FIREFLY_PAT'] as const)
        .filter((k) => env[k] === undefined || env[k] === '');
      if (missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FEOH_IMPORT'],
          message:
            `FEOH_IMPORT_ENABLED=true but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} blank — ` +
            'set both, or set FEOH_IMPORT_ENABLED=false.',
        });
      }
    }
  });
}

const parsed = parseEnvOrExit(buildEnvSchema());

export const config = {
  databaseUrl: parsed.DATABASE_URL,
  jwtSecret: parsed.JWT_SECRET,
  householdName: parsed.HOUSEHOLD_NAME,
  adminEmail: parsed.ADMIN_EMAIL,
  adminPassword: parsed.ADMIN_PASSWORD,
  port: parsed.API_PORT,
  jwtTtlSeconds: parsed.JWT_TTL_SECONDS,
  corsOrigin: parsed.CORS_ORIGIN,
  dbPoolMax: parsed.DB_POOL_MAX,
  traktClientId: parsed.TRAKT_CLIENT_ID,
  traktClientSecret: parsed.TRAKT_CLIENT_SECRET,
  libraryEncryptionKey: parsed.LIBRARY_ENCRYPTION_KEY,
  // Mirror poll interval (seconds). Independent optional tuning knob; the
  // scheduler floors it at 60s and only runs when the integration is enabled.
  integrationsSyncIntervalSeconds: parsed.INTEGRATIONS_SYNC_INTERVAL_SECONDS,
  // Resolved M365 config, or null when the integration is disabled (env absent).
  // The env schema guarantees this is all-or-nothing, so the presence of
  // M365_TENANT_ID implies the whole group is present.
  m365:
    parsed.M365_TENANT_ID
      ? {
          tenantId: parsed.M365_TENANT_ID,
          clientId: parsed.M365_CLIENT_ID!,
          clientSecret: parsed.M365_CLIENT_SECRET!,
          redirectUri: parsed.M365_REDIRECT_URI!,
          familyMailbox: parsed.M365_FAMILY_MAILBOX!,
        }
      : null,
  // Resolved Google config, or null when the integration is disabled (env
  // absent). All-or-nothing like m365 above: GOOGLE_CLIENT_ID present implies
  // the rest of the group is present.
  google:
    parsed.GOOGLE_CLIENT_ID
      ? {
          clientId: parsed.GOOGLE_CLIENT_ID,
          clientSecret: parsed.GOOGLE_CLIENT_SECRET!,
          redirectUri: parsed.GOOGLE_REDIRECT_URI!,
        }
      : null,
  // Resolved KithLedger config, or null when the integration is disabled
  // (env absent). All-or-nothing like m365 above: KITH_BASE_URL present
  // implies KITH_API_KEY is present too.
  kith:
    parsed.KITH_BASE_URL
      ? {
          baseUrl: parsed.KITH_BASE_URL,
          publicUrl: parsed.KITH_PUBLIC_URL ?? parsed.KITH_BASE_URL,
          /**
           * The household dashboard credential (ADR 0004 §2.2) — read-only,
           * member-less, and limited to the `household`-visible slice. Never
           * a member key: see `keyKind`.
           */
          apiKey: parsed.KITH_API_KEY!,
          /**
           * Always `'household'` — the schema refuses any other declaration.
           * Carried in the config (rather than left implicit) so the one call
           * path that uses the key states which principal it presents, and so
           * a future member-scoped call path cannot quietly reuse this one.
           */
          keyKind: (parsed.KITH_API_KEY_KIND ?? 'household') as 'household',
        }
      : null,
  // Bank ingestion (ADR 0016) — `null` when FEOH_IMPORT_ENABLED is not `true`.
  // The schema guarantees both Firefly values are present when enabled.
  feohImport:
    parsed.FEOH_IMPORT_ENABLED === 'true'
      ? { baseUrl: parsed.FIREFLY_BASE_URL!, pat: parsed.FIREFLY_PAT! }
      : null,
  // The household's single currency; imported rows in any other currency are
  // never booked (spec §2 "Currency").
  feohCurrency: parsed.FEOH_CURRENCY ?? 'EUR',
  // Resolved satellite signing config, or null when no key is configured
  // (the default — JWKS then publishes an empty key set and nothing else
  // changes). All-or-nothing like m365/kith above: SATELLITE_SIGNING_KEY
  // present implies SATELLITE_SIGNING_KID is present too.
  //
  // NOTE: this holds PRIVATE key material. Never log it, never return it over
  // the API — only the derived public half is ever published (src/satellite).
  satellite:
    parsed.SATELLITE_SIGNING_KEY
      ? {
          /** The ACTIVE key: the only one tokens are ever signed with. */
          active: {
            material: parsed.SATELLITE_SIGNING_KEY,
            kid: parsed.SATELLITE_SIGNING_KID!,
            alg: parsed.SATELLITE_SIGNING_ALG ?? ('EdDSA' as const),
          },
          /** Publish-only rotation-overlap key, or null when not rotating. */
          secondary:
            parsed.SATELLITE_SIGNING_KEY_SECONDARY
              ? {
                  material: parsed.SATELLITE_SIGNING_KEY_SECONDARY,
                  kid: parsed.SATELLITE_SIGNING_KID_SECONDARY!,
                  alg: parsed.SATELLITE_SIGNING_ALG_SECONDARY ?? ('EdDSA' as const),
                }
              : null,
        }
      : null,
  /**
   * The satellite audiences `POST /api/v1/auth/satellite-token` will mint for
   * (B3, ADR 0009). Empty by default — an unknown audience is refused, never
   * minted optimistically, so the exchange endpoint stays inert until an
   * operator names a satellite here.
   */
  satelliteAudiences: (parsed.SATELLITE_AUDIENCES ?? []) as readonly string[],
} as const;

/** The resolved Microsoft 365 config shape (present only when enabled). */
export type M365Config = NonNullable<typeof config.m365>;

/** The resolved Google config shape (present only when enabled). */
export type GoogleConfig = NonNullable<typeof config.google>;

/** The resolved KithLedger config shape (present only when enabled). */
export type KithConfig = NonNullable<typeof config.kith>;

/** The resolved satellite signing config shape (present only when configured). */
export type SatelliteConfig = NonNullable<typeof config.satellite>;
