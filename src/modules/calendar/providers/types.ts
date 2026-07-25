/**
 * Provider-agnostic calendar mirror contract.
 *
 * This is the seam a read-only external calendar source implements so its events
 * become visible in Heorth alongside native events. It is deliberately free of
 * any Microsoft Graph (or Google/CalDAV) types or URLs — a future Google or
 * CalDAV provider slots in beside the Graph one (`src/m365/calendar-provider.ts`)
 * by implementing this same interface. The Graph implementation lives in
 * `src/m365/` (the only place Graph types are allowed) and depends on this
 * abstraction, never the reverse.
 */

/**
 * An instant as a source expressed it. We persist the absolute UTC instant so
 * native range/week queries (which reason in absolute time) work unchanged;
 * `timeZone` is the source's own zone, carried only as display metadata for a
 * later timezone-aware view (Task 2.5). We do NOT re-localize on write.
 */
export interface MirroredInstant {
  /** Absolute instant, ISO-8601 with offset/Z (e.g. `2026-01-02T09:00:00.000Z`). */
  utc: string;
  /** The source event's own timezone (IANA or Windows id), or null if unknown. */
  timeZone: string | null;
}

/**
 * One mirrored external event, already normalized. Provider-agnostic: no Graph
 * fields leak through. Recurring events arrive as individually expanded
 * occurrences (the provider does the expansion); we never reconstruct rules.
 */
export interface MirroredEvent {
  /** Stable id within the feed (Graph event/occurrence id). Unique per feed. */
  externalId: string;
  title: string;
  start: MirroredInstant;
  end: MirroredInstant;
  allDay: boolean;
  location: string | null;
  /** Organizer display name or address, for attribution in the UI. */
  organizer: string | null;
  /**
   * Household member this event is attributed to (member feeds), or null for a
   * shared/family feed that belongs to no single member.
   */
  memberId: string | null;
  /**
   * Set on occurrences/exceptions of a recurring series: the series master's
   * externalId within the same feed. Used to cascade a series deletion — when
   * the source tombstones only the master id, every mirrored row carrying it
   * here is removed too. Null for standalone events.
   */
  seriesMasterId: string | null;
}

/** A discrete incremental-sync stream the provider can pull. */
export interface CalendarFeed {
  /** Canonical `m365_sync_state` key (see `src/m365/feed-keys.ts`). */
  feedKey: string;
  /** Owning member (member feeds) or null (shared/family feed). */
  memberId: string | null;
  kind: 'member' | 'family';
}

/** The delta produced by one {@link CalendarProvider.pullChanges} call. */
export interface PullResult {
  /** Events to create-or-update in the mirror (keyed by feed + externalId). */
  upserts: MirroredEvent[];
  /**
   * externalIds removed at the source since the previous token (genuine
   * `@removed` tombstones). Deleting these CASCADES: a deleted series is
   * tombstoned by its master id only, so rows matching by `externalId` OR
   * `seriesMasterId` are removed.
   */
  deletions: string[];
  /**
   * External ids that must never exist as mirrored rows (series masters — their
   * start/end is the series' original first occurrence). Deleted by
   * `externalId` ONLY, no cascade: an ALIVE master re-delivered by a delta
   * (e.g. because one occurrence changed) must not take the series' other,
   * not-re-delivered occurrences with it. This purge only self-heals master
   * rows a pre-fix sync mirrored.
   */
  masterPurges: string[];
  /** Opaque token to persist and pass back next time, or null if none. */
  nextToken: string | null;
  /**
   * True when the previous token was invalid (e.g. Graph `410 Gone`) and this
   * result is a fresh full snapshot — the caller must REPLACE the feed's mirror
   * contents rather than merge, since `deletions` cannot be trusted after a gap.
   */
  fullResync: boolean;
}

/**
 * A read-only external calendar source. Implementations are constructed with
 * their own transport/auth; nothing here exposes it.
 */
export interface CalendarProvider {
  /** Discriminator persisted on mirrored rows (e.g. `'m365'`). */
  readonly source: string;
  /** Which feeds currently exist given connections/config. */
  listFeeds(): Promise<CalendarFeed[]>;
  /**
   * Pull changes for one feed since `syncToken` (null = initial full sync).
   * Providers handle their own token-invalidation internally and signal it via
   * {@link PullResult.fullResync}.
   *
   * `forceFullResync`, when true, tells the provider to ignore `syncToken` and
   * do a fresh full (re-windowed) snapshot even though a token is present. The
   * sync runner sets this on a deterministic schedule (tracked via
   * `m365_sync_state.lastFullSyncAt`) so a rolling time window actually rolls
   * forward instead of staying pinned to the window computed when the token
   * was first minted.
   */
  pullChanges(feedKey: string, syncToken: string | null, forceFullResync?: boolean): Promise<PullResult>;
}
