import type { M365Config } from '../config/env.js';
import { authorityBase, GraphError } from './graph.js';

const GRAPH_DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';
const EXPIRY_SKEW_MS = 60_000;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
}

/**
 * App-only (client-credentials) token client, tenant-scoped with the `.default`
 * scope. Used later for the family shared mailbox (Task 2.2), which must not hang
 * off any one member's refresh token. The token is cached in memory with expiry.
 */
export class AppOnlyClient {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: M365Config,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + EXPIRY_SKEW_MS) return this.cached.token;

    const res = await this.fetchImpl(`${authorityBase(this.cfg.tenantId)}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: 'client_credentials',
        scope: GRAPH_DEFAULT_SCOPE,
      }).toString(),
    });
    if (!res.ok) {
      throw new GraphError(`App-only token request failed (${res.status})`, res.status);
    }
    const tok = (await res.json()) as TokenResponse;
    this.cached = { token: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 };
    return tok.access_token;
  }

  clearCache(): void {
    this.cached = null;
  }
}
