import type { M365Runtime } from './runtime.js';
import { GraphError } from './graph.js';
import { feedKeys } from './feed-keys.js';
import type {
  CalendarProvider, CalendarFeed, MirroredEvent, PullResult,
} from '../modules/calendar/providers/types.js';

/**
 * The Microsoft Graph read-only calendar mirror provider — the ONLY place Graph
 * calendar types/URLs live. It implements the provider-agnostic
 * {@link CalendarProvider} contract (defined in the calendar module) on top of
 * the Task 2.1 foundation (`src/m365/`): delegated auth for a member's default
 * calendar, app-only auth for the shared family mailbox.
 *
 * Uses `calendarView/delta` over a rolling window so Graph expands recurring
 * events into individual occurrences for us; we mirror occurrences as-is and
 * never reconstruct recurrence rules. Delta tokens are opaque `@odata.deltaLink`
 * URLs, persisted by the sync runner in `m365_sync_state`.
 */

// --- rolling window --------------------------------------------------------
// Past horizon keeps recently-finished events briefly visible; the long future
// horizon covers school terms / annual bookings without a per-tick widening.
const WINDOW_PAST_DAYS = 60;
const WINDOW_FUTURE_DAYS = 400;

// Cap pages followed in a single pull so a runaway nextLink chain can't wedge a
// feed's sync forever (defensive; a household calendar is far smaller).
const MAX_PAGES = 50;

const PREFER_UTC = 'outlook.timezone="UTC"';

interface GraphDateTime {
  dateTime: string;
  timeZone?: string;
}

interface GraphEvent {
  id: string;
  subject?: string | null;
  isAllDay?: boolean;
  start?: GraphDateTime;
  end?: GraphDateTime;
  location?: { displayName?: string | null } | null;
  organizer?: { emailAddress?: { name?: string | null; address?: string | null } | null } | null;
  originalStartTimeZone?: string | null;
  '@removed'?: { reason?: string };
}

interface DeltaResponse {
  value: GraphEvent[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/** Treat a Graph dateTime (UTC via the Prefer header) as an absolute instant. */
function toUtcIso(dt: string): string {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(dt);
  return new Date(hasZone ? dt : `${dt}Z`).toISOString();
}

function windowParams(now = new Date()): string {
  const start = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000);
  const end = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000);
  return `startDateTime=${encodeURIComponent(start.toISOString())}&endDateTime=${encodeURIComponent(end.toISOString())}`;
}

export class GraphCalendarProvider implements CalendarProvider {
  readonly source = 'm365';

  constructor(private readonly rt: M365Runtime) {}

  async listFeeds(): Promise<CalendarFeed[]> {
    const connections = await this.rt.store.listConnections();
    const feeds: CalendarFeed[] = connections.map((c) => ({
      feedKey: feedKeys.calendarMember(c.memberId),
      memberId: c.memberId,
      kind: 'member',
    }));
    // The shared family mailbox (app-only) is always a feed when enabled.
    feeds.push({ feedKey: feedKeys.calendarFamily(), memberId: null, kind: 'family' });
    return feeds;
  }

  async pullChanges(
    feedKey: string, syncToken: string | null, forceFullResync = false,
  ): Promise<PullResult> {
    const feed = this.parseFeed(feedKey);
    const isFamily = feed.kind === 'family';

    // Resolve auth for this feed. Delegated for a member, app-only for family.
    const accessToken = isFamily
      ? await this.rt.appOnly.getAccessToken()
      : await this.rt.delegated.getAccessToken(feed.memberId!);

    const basePath = isFamily
      ? `/users/${encodeURIComponent(this.rt.config.familyMailbox)}/calendarView/delta`
      : `/me/calendarView/delta`;

    let fullResync = false;
    let path: string;
    if (syncToken && !forceFullResync) {
      path = syncToken; // opaque absolute deltaLink URL
    } else {
      // No prior token, OR the caller determined this feed is due for its
      // periodic re-window (`forceFullResync`) — either way this is a fresh
      // full snapshot over a freshly-computed window, not a delta replay.
      path = `${basePath}?${windowParams()}`;
      fullResync = true;
    }

    const upserts: MirroredEvent[] = [];
    const deletions: string[] = [];
    let nextToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let res: DeltaResponse;
      try {
        res = await this.rt.graphFetch<DeltaResponse>(accessToken, path, {
          headers: { Prefer: PREFER_UTC },
        });
      } catch (e) {
        // Expired/invalid delta token → Graph 410 Gone. Drop the token and do a
        // fresh full re-sync of the whole window (deletions can't be trusted).
        if (e instanceof GraphError && e.status === 410 && syncToken) {
          return this.pullChanges(feedKey, null);
        }
        throw e;
      }

      for (const ev of res.value ?? []) {
        if (ev['@removed']) {
          deletions.push(ev.id);
        } else {
          upserts.push(this.toMirrored(ev, feed.memberId));
        }
      }

      const next = res['@odata.nextLink'];
      const delta = res['@odata.deltaLink'];
      if (next) {
        path = next;
        continue;
      }
      nextToken = delta ?? null;
      break;
    }

    return { upserts, deletions, nextToken, fullResync };
  }

  private toMirrored(ev: GraphEvent, memberId: string | null): MirroredEvent {
    const startDt = ev.start?.dateTime ?? new Date().toISOString();
    const endDt = ev.end?.dateTime ?? startDt;
    const zone = ev.originalStartTimeZone ?? ev.start?.timeZone ?? null;
    const organizer =
      ev.organizer?.emailAddress?.name ?? ev.organizer?.emailAddress?.address ?? null;
    return {
      externalId: ev.id,
      title: ev.subject?.trim() || '(untitled)',
      start: { utc: toUtcIso(startDt), timeZone: zone },
      end: { utc: toUtcIso(endDt), timeZone: ev.originalStartTimeZone ?? ev.end?.timeZone ?? zone },
      allDay: ev.isAllDay ?? false,
      location: ev.location?.displayName?.trim() || null,
      organizer,
      memberId,
    };
  }

  private parseFeed(feedKey: string): CalendarFeed {
    if (feedKey === feedKeys.calendarFamily()) {
      return { feedKey, memberId: null, kind: 'family' };
    }
    const m = /^calendar:member:(.+)$/.exec(feedKey);
    if (!m) throw new Error(`Unsupported calendar feed key: ${feedKey}`);
    return { feedKey, memberId: m[1]!, kind: 'member' };
  }
}
