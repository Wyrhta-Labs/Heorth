import type { FeohClient } from './client.js';

/** The subset of a household member Feoh's roster needs. */
export interface RosterMember {
  id: string;
  displayName: string | null;
  handle: string;
  email: string;
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
   * Idempotent: safe to call at startup and again on a mapping miss. Propagates
   * a `SatelliteUnreachableError` if Feoh is down so callers can decide (startup
   * logs and continues; a proxy request maps it to 503).
   */
  async sync(): Promise<void> {
    const members = await this.listMembers();
    for (const m of members) {
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
    if (!resolved) throw new Error(`No Feoh party mapped for Heorth member ${memberId}`);
    return resolved;
  }

  /** Reverse-map a party id back to a member id, or undefined if unknown. */
  memberIdFor(partyId: string): string | undefined {
    return this.partyToMember.get(partyId);
  }
}
