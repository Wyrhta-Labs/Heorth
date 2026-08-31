import { and, eq } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db/index.js';
import { encryptToken, decryptToken } from './crypto.js';
import {
  integrationConnections, integrationSyncState,
  type IntegrationConnectionRow, type IntegrationSyncStateRow, type IntegrationConnectionStatus,
} from './schema.js';

/** A connection safe to return over the API — never carries token material. */
export type PublicIntegrationConnection = Omit<IntegrationConnectionRow, 'refreshTokenEncrypted'>;

function toPublic(row: IntegrationConnectionRow): PublicIntegrationConnection {
  const { refreshTokenEncrypted: _omit, ...pub } = row;
  return pub;
}

export interface UpsertConnectionInput {
  memberId: string;
  accountLabel: string;
  refreshToken: string;
  scopes: string;
}

/**
 * Persistence for delegated connections and per-feed sync state.
 *
 * An instance is bound to ONE provider at construction, and every connection
 * method is scoped to it — that scoping is what lets M365 and Google coexist
 * without either seeing the other's rows. Sync state is NOT provider-scoped on
 * read: feed keys already carry a provider segment, and the Hearth View needs
 * household-wide staleness across every provider from a single call.
 *
 * Refresh tokens are encrypted on write and decrypted only inside this store
 * (see {@link getRefreshToken}); callers hold plaintext transiently for a token
 * exchange and never persist it themselves.
 */
export class IntegrationStore {
  constructor(
    private readonly provider: string,
    private readonly db: DB = defaultDb,
  ) {}

  private mine() {
    return eq(integrationConnections.provider, this.provider);
  }

  private mineFor(memberId: string) {
    return and(this.mine(), eq(integrationConnections.memberId, memberId));
  }

  // --- connections ----------------------------------------------------------

  /** Idempotent per-(provider, member) upsert. Encrypts the refresh token at rest. */
  async upsertConnection(input: UpsertConnectionInput): Promise<PublicIntegrationConnection> {
    const encrypted = encryptToken(input.refreshToken);
    const [row] = await this.db
      .insert(integrationConnections)
      .values({
        provider: this.provider,
        memberId: input.memberId,
        accountLabel: input.accountLabel,
        refreshTokenEncrypted: encrypted,
        scopes: input.scopes,
        status: 'active',
        lastRefreshSuccessAt: new Date(),
        lastRefreshError: null,
      })
      .onConflictDoUpdate({
        target: [integrationConnections.provider, integrationConnections.memberId],
        set: {
          accountLabel: input.accountLabel,
          refreshTokenEncrypted: encrypted,
          scopes: input.scopes,
          status: 'active',
          lastRefreshSuccessAt: new Date(),
          lastRefreshError: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toPublic(row!);
  }

  async getConnection(memberId: string): Promise<PublicIntegrationConnection | null> {
    const [row] = await this.db.select().from(integrationConnections)
      .where(this.mineFor(memberId)).limit(1);
    return row ? toPublic(row) : null;
  }

  async listConnections(): Promise<PublicIntegrationConnection[]> {
    const rows = await this.db.select().from(integrationConnections)
      .where(this.mine()).orderBy(integrationConnections.accountLabel);
    return rows.map(toPublic);
  }

  /** Decrypt the stored refresh token for a member (auth-client internal use). */
  async getRefreshToken(memberId: string): Promise<string | null> {
    const [row] = await this.db.select().from(integrationConnections)
      .where(this.mineFor(memberId)).limit(1);
    return row ? decryptToken(row.refreshTokenEncrypted) : null;
  }

  /** Persist a rotated refresh token + record a successful refresh. */
  async recordRefreshSuccess(memberId: string, rotatedRefreshToken?: string): Promise<void> {
    await this.db.update(integrationConnections).set({
      status: 'active',
      lastRefreshSuccessAt: new Date(),
      lastRefreshError: null,
      updatedAt: new Date(),
      ...(rotatedRefreshToken ? { refreshTokenEncrypted: encryptToken(rotatedRefreshToken) } : {}),
    }).where(this.mineFor(memberId));
  }

  async recordRefreshError(
    memberId: string, message: string, status: IntegrationConnectionStatus = 'error',
  ): Promise<void> {
    await this.db.update(integrationConnections).set({
      status, lastRefreshError: message, updatedAt: new Date(),
    }).where(this.mineFor(memberId));
  }

  async deleteConnection(memberId: string): Promise<boolean> {
    const rows = await this.db.delete(integrationConnections)
      .where(this.mineFor(memberId)).returning({ id: integrationConnections.id });
    return rows.length > 0;
  }

  // --- sync state -----------------------------------------------------------
  // Keyed by feedKey, which already carries the provider segment.

  async getSyncState(feedKey: string): Promise<IntegrationSyncStateRow | null> {
    const [row] = await this.db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.feedKey, feedKey)).limit(1);
    return row ?? null;
  }

  /**
   * All per-feed sync state rows, ACROSS EVERY PROVIDER. Deliberately not
   * provider-scoped: the health surface and the Hearth View staleness badges
   * need every feed the household has, and a feed key already says which
   * provider it belongs to.
   */
  async listSyncState(): Promise<IntegrationSyncStateRow[]> {
    return this.db.select().from(integrationSyncState).orderBy(integrationSyncState.feedKey);
  }

  /**
   * Record a successful sync tick: store the new sync token, clear errors.
   * `fullResync` marks this tick as a fresh full (windowed / whole-feed) sync —
   * stamps `lastFullSyncAt` so the runner can decide when the feed is next due
   * for a deterministic re-window. Incremental ticks leave it untouched.
   */
  async recordSyncSuccess(
    feedKey: string, syncToken: string | null, fullResync = false,
  ): Promise<IntegrationSyncStateRow> {
    const now = new Date();
    const [row] = await this.db.insert(integrationSyncState).values({
      feedKey, syncToken, lastSuccessAt: now, lastError: null, consecutiveFailures: 0,
      lastFullSyncAt: fullResync ? now : null,
    }).onConflictDoUpdate({
      target: integrationSyncState.feedKey,
      set: {
        syncToken, lastSuccessAt: now, lastError: null,
        consecutiveFailures: 0, updatedAt: now,
        ...(fullResync ? { lastFullSyncAt: now } : {}),
      },
    }).returning();
    return row!;
  }

  /** Record a failed sync tick: increment the consecutive-failure counter. */
  async recordSyncFailure(feedKey: string, message: string): Promise<IntegrationSyncStateRow> {
    const existing = await this.getSyncState(feedKey);
    const failures = (existing?.consecutiveFailures ?? 0) + 1;
    const [row] = await this.db.insert(integrationSyncState).values({
      feedKey, lastError: message, consecutiveFailures: failures,
    }).onConflictDoUpdate({
      target: integrationSyncState.feedKey,
      set: { lastError: message, consecutiveFailures: failures, updatedAt: new Date() },
    }).returning();
    return row!;
  }
}
