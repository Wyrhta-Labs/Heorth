import type { M365Config } from '../config/env.js';
import { authorityBase, GraphError, graphFetch } from './graph.js';
import type { M365Store } from './store.js';

/** Delegated scopes Heorth requests (see the M365 plan's auth model). */
export const DELEGATED_SCOPES = 'Calendars.Read Tasks.ReadWrite offline_access User.Read';

/** Raw token-endpoint response (identity platform). Never logged. */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

/** The signed-in account, as `/me` returns it. */
export interface GraphMe {
  id: string;
  userPrincipalName: string;
  displayName?: string;
}

interface CachedAccess {
  token: string;
  expiresAt: number; // epoch ms
}

const EXPIRY_SKEW_MS = 60_000; // refresh a minute early

/**
 * Delegated (per-member) auth-code client. Builds the authorize URL, exchanges
 * the callback code, and hands out access tokens — refreshing on demand from the
 * stored refresh token and re-storing rotated refresh tokens. Access tokens are
 * cached in memory per member with expiry.
 */
export class DelegatedClient {
  private readonly cache = new Map<string, CachedAccess>();

  constructor(
    private readonly cfg: M365Config,
    private readonly store: M365Store,
    private readonly fetchImpl: typeof fetch,
  ) {}

  /** Microsoft authorize URL for the consent redirect. `state` binds the member. */
  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: this.cfg.redirectUri,
      response_mode: 'query',
      scope: DELEGATED_SCOPES,
      state,
    });
    return `${authorityBase(this.cfg.tenantId)}/authorize?${params.toString()}`;
  }

  private async postToken(body: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetchImpl(`${authorityBase(this.cfg.tenantId)}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) {
      let code: string | null = null;
      try {
        const j = (await res.json()) as { error?: string; error_description?: string };
        code = j.error ?? null;
      } catch { /* ignore */ }
      throw new GraphError(`Token request failed (${res.status})`, res.status, code);
    }
    return (await res.json()) as TokenResponse;
  }

  /** Exchange an auth-code for tokens (callback). Returns tokens + granted scopes. */
  async exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string; scopes: string }> {
    const tok = await this.postToken({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
      scope: DELEGATED_SCOPES,
    });
    if (!tok.refresh_token) {
      throw new GraphError('Token response had no refresh_token (offline_access missing?)', 400);
    }
    return { refreshToken: tok.refresh_token, accessToken: tok.access_token, scopes: tok.scope ?? DELEGATED_SCOPES };
  }

  /** Resolve `/me` for the freshly-issued access token (to record the account UPN). */
  async getMe(accessToken: string): Promise<GraphMe> {
    return graphFetch<GraphMe>({ fetch: this.fetchImpl }, accessToken, '/me');
  }

  /**
   * A valid access token for the member — from cache, or refreshed from the
   * stored refresh token. Rotated refresh tokens are persisted; a rejected
   * refresh marks the connection `needs_reauth`.
   */
  async getAccessToken(memberId: string): Promise<string> {
    const cached = this.cache.get(memberId);
    if (cached && cached.expiresAt > Date.now() + EXPIRY_SKEW_MS) return cached.token;

    const refreshToken = await this.store.getRefreshToken(memberId);
    if (!refreshToken) throw new GraphError('No M365 connection for member', 401, 'no_connection');

    let tok: TokenResponse;
    try {
      tok = await this.postToken({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        redirect_uri: this.cfg.redirectUri,
        scope: DELEGATED_SCOPES,
      });
    } catch (e) {
      const needsReauth = e instanceof GraphError && (e.status === 400 || e.status === 401);
      await this.store.recordRefreshError(
        memberId, (e as Error).message, needsReauth ? 'needs_reauth' : 'error',
      );
      this.cache.delete(memberId);
      throw e;
    }

    await this.store.recordRefreshSuccess(memberId, tok.refresh_token);
    this.cache.set(memberId, { token: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 });
    return tok.access_token;
  }

  /** Test/maintenance hook: drop the in-memory access-token cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
