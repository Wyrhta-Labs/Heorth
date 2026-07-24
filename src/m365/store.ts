import { eq } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db/index.js';
import { encryptToken, decryptToken } from './crypto.js';
import {
  m365Connections, m365SyncState,
  type M365ConnectionRow, type M365SyncStateRow, type M365ConnectionStatus,
} from './schema.js';

/** A connection safe to return over the API — never carries token material. */
export type PublicM365Connection = Omit<M365ConnectionRow, 'refreshTokenEncrypted'>;

function toPublic(row: M365ConnectionRow): PublicM365Connection {
  const { refreshTokenEncrypted: _omit, ...pub } = row;
  return pub;
}

export interface UpsertConnectionInput {
  memberId: string;
  accountUpn: string;
  refreshToken: string;
  scopes: string;
}

/**
 * Persistence for M365 delegated connections and generic per-feed sync state.
 * Refresh tokens are encrypted on write and decrypted only inside this store
 * (see {@link getRefreshToken}); callers hold plaintext transiently for a token
 * exchange and never persist it themselves.
 */
export class M365Store {
  constructor(private readonly db: DB = defaultDb) {}

  // --- connections ----------------------------------------------------------

  /** Idempotent per-member upsert. Encrypts the refresh token at rest. */
  async upsertConnection(input: UpsertConnectionInput): Promise<PublicM365Connection> {
    const encrypted = encryptToken(input.refreshToken);
    const [row] = await this.db
      .insert(m365Connections)
      .values({
        memberId: input.memberId,
        accountUpn: input.accountUpn,
        refreshTokenEncrypted: encrypted,
        scopes: input.scopes,
        status: 'active',
        lastRefreshSuccessAt: new Date(),
        lastRefreshError: null,
      })
      .onConflictDoUpdate({
        target: m365Connections.memberId,
        set: {
          accountUpn: input.accountUpn,
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

  async getConnection(memberId: string): Promise<PublicM365Connection | null> {
    const [row] = await this.db.select().from(m365Connections)
      .where(eq(m365Connections.memberId, memberId)).limit(1);
    return row ? toPublic(row) : null;
  }

  async listConnections(): Promise<PublicM365Connection[]> {
    const rows = await this.db.select().from(m365Connections).orderBy(m365Connections.accountUpn);
    return rows.map(toPublic);
  }

  /** Decrypt the stored refresh token for a member (auth-client internal use). */
  async getRefreshToken(memberId: string): Promise<string | null> {
    const [row] = await this.db.select().from(m365Connections)
      .where(eq(m365Connections.memberId, memberId)).limit(1);
    return row ? decryptToken(row.refreshTokenEncrypted) : null;
  }

  /** Persist a rotated refresh token + record a successful refresh. */
  async recordRefreshSuccess(memberId: string, rotatedRefreshToken?: string): Promise<void> {
    await this.db.update(m365Connections).set({
      status: 'active',
      lastRefreshSuccessAt: new Date(),
      lastRefreshError: null,
      updatedAt: new Date(),
      ...(rotatedRefreshToken ? { refreshTokenEncrypted: encryptToken(rotatedRefreshToken) } : {}),
    }).where(eq(m365Connections.memberId, memberId));
  }

  async recordRefreshError(
    memberId: string, message: string, status: M365ConnectionStatus = 'error',
  ): Promise<void> {
    await this.db.update(m365Connections).set({
      status, lastRefreshError: message, updatedAt: new Date(),
    }).where(eq(m365Connections.memberId, memberId));
  }

  async deleteConnection(memberId: string): Promise<boolean> {
    const rows = await this.db.delete(m365Connections)
      .where(eq(m365Connections.memberId, memberId)).returning({ id: m365Connections.id });
    return rows.length > 0;
  }

  // --- sync state -----------------------------------------------------------

  async getSyncState(feedKey: string): Promise<M365SyncStateRow | null> {
    const [row] = await this.db.select().from(m365SyncState)
      .where(eq(m365SyncState.feedKey, feedKey)).limit(1);
    return row ?? null;
  }

  /** Record a successful sync tick: store the new delta token, clear errors. */
  async recordSyncSuccess(feedKey: string, deltaToken: string | null): Promise<M365SyncStateRow> {
    const [row] = await this.db.insert(m365SyncState).values({
      feedKey, deltaToken, lastSuccessAt: new Date(), lastError: null, consecutiveFailures: 0,
    }).onConflictDoUpdate({
      target: m365SyncState.feedKey,
      set: {
        deltaToken, lastSuccessAt: new Date(), lastError: null,
        consecutiveFailures: 0, updatedAt: new Date(),
      },
    }).returning();
    return row!;
  }

  /** Record a failed sync tick: increment the consecutive-failure counter. */
  async recordSyncFailure(feedKey: string, message: string): Promise<M365SyncStateRow> {
    const existing = await this.getSyncState(feedKey);
    const failures = (existing?.consecutiveFailures ?? 0) + 1;
    const [row] = await this.db.insert(m365SyncState).values({
      feedKey, lastError: message, consecutiveFailures: failures,
    }).onConflictDoUpdate({
      target: m365SyncState.feedKey,
      set: { lastError: message, consecutiveFailures: failures, updatedAt: new Date() },
    }).returning();
    return row!;
  }
}
