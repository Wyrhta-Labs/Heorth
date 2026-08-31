import type { GoogleConfig } from '../config/env.js';
import type { IntegrationStore } from '../integrations/store.js';
import {
  GoogleApiError, googleFetch,
  GOOGLE_OAUTH_AUTHORIZE, GOOGLE_OAUTH_TOKEN, GOOGLE_USERINFO,
} from './api.js';

/**
 * Delegated scopes Heorth requests. `calendar.readonly` because the mirror is
 * read-only (ADR 0001 phase 1); `tasks` is read/write because completion writes
 * back and Heorth creates tasks outward; `email` resolves the account label.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks',
  'openid',
  'email',
].join(' ');

/**
 * The connect flow returned no refresh token.
 *
 * Google issues one ONLY on the first consent for a given client/user pair
 * unless the authorize URL carries both `access_type=offline` and
 * `prompt=consent` — and even with both, a malformed flow can come back without
 * one. Storing such a connection produces something that works for about an
 * hour and then dies silently, presenting as "it worked yesterday". So this is
 * a hard failure at connect time, not a warning.
 */
export class GoogleNoRefreshTokenError extends Error {
  /**
   * Surfaced verbatim as `?connectError=<code>` by the integrations callback,
   * so the member is told what actually went wrong instead of getting the
   * generic exchange failure. The spec names this exact code.
   */
  readonly connectErrorCode = 'GOOGLE_NO_REFRESH_TOKEN';

  constructor() {
    super('Google returned no refresh_token — the connection would expire within the hour');
    this.name = 'GoogleNoRefreshTokenError';
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

interface UserInfo {
  sub: string;
  email?: string;
}

interface CachedAccess {
  token: string;
  expiresAt: number; // epoch ms
}

const EXPIRY_SKEW_MS = 60_000; // refresh a minute early

/**
 * Delegated (per-member) auth-code client for Google. Builds the authorize URL,
 * exchanges the callback code, and hands out access tokens — refreshing on
 * demand from the stored refresh token.
 *
 * Note the difference from {@link import('../m365/delegated.js').DelegatedClient}:
 * Google does NOT rotate refresh tokens on refresh, so a successful refresh
 * records success WITHOUT re-storing a token. Passing `undefined` to
 * `recordRefreshSuccess` is what keeps the stored ciphertext untouched.
 */
export class GoogleOAuthClient {
  private readonly cache = new Map<string, CachedAccess>();

  constructor(
    private readonly cfg: GoogleConfig,
    private readonly store: IntegrationStore,
    private readonly fetchImpl: typeof fetch,
  ) {}

  /** Google consent URL. `state` binds the member (signed, see integrations/state.ts). */
  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      // BOTH are required for a refresh token to be issued at all. See
      // GoogleNoRefreshTokenError. `prompt=consent` also forces re-issue on a
      // reconnect, which is exactly the case that otherwise fails silently.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${GOOGLE_OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  private async postToken(body: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetchImpl(GOOGLE_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) {
      let reason: string | null = null;
      try {
        const j = (await res.json()) as { error?: string };
        reason = j.error ?? null;
      } catch { /* ignore */ }
      throw new GoogleApiError(`Google token request failed (${res.status})`, res.status, reason);
    }
    return (await res.json()) as TokenResponse;
  }

  /** Exchange the callback code. Throws when no refresh token comes back. */
  async exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string; scopes: string }> {
    const tok = await this.postToken({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
    });
    if (!tok.refresh_token) throw new GoogleNoRefreshTokenError();
    return {
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      scopes: tok.scope ?? GOOGLE_SCOPES,
    };
  }

  /** The signed-in account's email, used as the connection's `accountLabel`. */
  async getUserEmail(accessToken: string): Promise<string> {
    const me = await googleFetch<UserInfo>({ fetch: this.fetchImpl }, accessToken, GOOGLE_USERINFO);
    return me.email ?? me.sub;
  }

  /**
   * A valid access token for the member — from cache, or refreshed from the
   * stored refresh token. A rejected refresh marks the connection
   * `needs_reauth`; so does a decryption failure (JWT_SECRET rotated), which is
   * equally unrecoverable without re-consent.
   */
  async getAccessToken(memberId: string): Promise<string> {
    const cached = this.cache.get(memberId);
    if (cached && cached.expiresAt > Date.now() + EXPIRY_SKEW_MS) return cached.token;

    let refreshToken: string | null;
    try {
      refreshToken = await this.store.getRefreshToken(memberId);
    } catch (e) {
      await this.store.recordRefreshError(memberId, (e as Error).message, 'needs_reauth');
      this.cache.delete(memberId);
      throw new GoogleApiError('Stored Google refresh token could not be decrypted', 401, 'needs_reauth');
    }
    if (!refreshToken) throw new GoogleApiError('No Google connection for member', 401, 'no_connection');

    let tok: TokenResponse;
    try {
      tok = await this.postToken({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
    } catch (e) {
      const needsReauth = e instanceof GoogleApiError && (e.status === 400 || e.status === 401);
      await this.store.recordRefreshError(
        memberId, (e as Error).message, needsReauth ? 'needs_reauth' : 'error',
      );
      this.cache.delete(memberId);
      // RE-THROW AS needs_reauth, do not rethrow the raw 400. Google answers a
      // revoked/expired refresh token with `400 invalid_grant`, and `classify`
      // would map a bare 400 to `google_400` — so the write-back path would
      // report a generic upstream error while the CONNECTION row says
      // needs_reauth. The two must agree, or the UI shows no reconnect prompt.
      if (needsReauth) {
        throw new GoogleApiError('Google refresh token was rejected', 401, 'needs_reauth');
      }
      throw e;
    }

    // No rotated token to persist: Google keeps issuing against the same one.
    await this.store.recordRefreshSuccess(memberId);
    this.cache.set(memberId, { token: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 });
    return tok.access_token;
  }

  /** Test/maintenance hook: drop the in-memory access-token cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
