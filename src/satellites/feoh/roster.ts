import { isMaintenanceAdmin } from '../../household/maintenance-admin.js';
import type { FeohClient } from './client.js';

/** The subset of a household member Feoh's roster needs. */
export interface RosterMember {
  id: string;
  displayName: string | null;
  handle: string;
  email: string;
}

/**
 * Thrown by {@link FeohRoster.partyIdFor} when a member is still unmapped
 * after a successful re-sync (Feoh was reachable and the sync completed —
 * this is not a "Feoh is down" case, see proxy.ts's error mapping).
 */
export class RosterMappingMissingError extends Error {
  constructor(public readonly memberId: string) {
    super(`No Feoh party mapped for Heorth member ${memberId} after re-sync`);
    this.name = 'RosterMappingMissingError';
  }
}

/**
 * Maintains the Heorth-member ↔ Feoh-party mapping.
 *
 * Feoh knows *parties*, not household members. Every Heorth member is mirrored
 * into Feoh as a `kind: 'member'` party (idempotent upsert keyed by
 * `heorthMemberId`). This class runs that sync and caches both directions of
 * the mapping so the finance proxy can translate the member-boundary fields:
 *  - forward:  memberId → partyId  (transaction `createdBy`, split `partyId`)
 *  - reverse:  partyId → memberId  (translating responses back for the UI)
 */
export class FeohRoster {
  private memberToParty = new Map<string, string>();
  private partyToMember = new Map<string, string>();
  // Shares one in-flight sync across concurrent callers instead of each
  // triggering its own full roster sync (finding F).
  private syncPromise: Promise<void> | null = null;

  constructor(
    private readonly client: FeohClient,
    private readonly listMembers: () => Promise<RosterMember[]>,
  ) {}

  private record(memberId: string, partyId: string): void {
    this.memberToParty.set(memberId, partyId);
    this.partyToMember.set(partyId, memberId);
  }

  /**
   * Upsert every household member into Feoh's parties and refresh the cache.
   * Idempotent: safe to call at startup and again on a mapping miss.
   * Concurrent callers share one in-flight sync (see `syncPromise`) rather
   * than each kicking off a redundant round of upserts. Propagates a
   * `SatelliteUnreachableError` if Feoh is down so callers can decide
   * (startup logs and continues; a proxy request maps it to 503).
   */
  async sync(): Promise<void> {
    if (!this.syncPromise) {
      this.syncPromise = this.runSync().finally(() => {
        this.syncPromise = null;
      });
    }
    return this.syncPromise;
  }

  /**
   * Upsert a single member's Feoh party and refresh its cache entry —
   * cheaper than a full {@link sync} when only one member changed (used for
   * a best-effort re-upsert right after a `displayName` edit; see
   * `household/service.ts#updateMember`).
   */
  async upsertMember(member: RosterMember): Promise<void> {
    // The maintenance admin is not a finance actor — never mirror it into Feoh.
    if (isMaintenanceAdmin(member)) return;
    const displayName = member.displayName ?? member.handle ?? member.email;
    const party = await this.client.upsertPartyByMember(member.id, { displayName });
    this.record(member.id, party.id);
  }

  private async runSync(): Promise<void> {
    const members = await this.listMembers();
    for (const m of members) {
      // The maintenance admin is not a finance actor — never mirror it into Feoh.
      if (isMaintenanceAdmin(m)) continue;
      const displayName = m.displayName ?? m.handle ?? m.email;
      const party = await this.client.upsertPartyByMember(m.id, { displayName });
      this.record(m.id, party.id);
    }
  }

  /** Resolve a member's party id, lazily re-syncing once on a cache miss. */
  async partyIdFor(memberId: string): Promise<string> {
    const cached = this.memberToParty.get(memberId);
    if (cached) return cached;
    await this.sync();
    const resolved = this.memberToParty.get(memberId);
    if (!resolved) throw new RosterMappingMissingError(memberId);
    return resolved;
  }

  /** Reverse-map a party id back to a member id, or undefined if unknown. */
  memberIdFor(partyId: string): string | undefined {
    return this.partyToMember.get(partyId);
  }
}
