import type { GoogleRuntime } from './runtime.js';
import { GoogleApiError, GOOGLE_CALENDAR_BASE } from './api.js';
import { zonedMidnightUtc } from '../lib/local-date.js';
import { getHouseholdTimeZone } from '../household/timezone.js';
import {
  getCalendarFeedByKey, listAllowlistedCalendarFeeds,
} from '../modules/calendar/allowlist-store.js';
import type {
  AvailableCalendar, CalendarFeed, CalendarProvider, MirroredEvent, PullResult,
} from '../modules/calendar/providers/types.js';

/**
 * The Google Calendar read-only mirror provider — one of the two places Google
 * Calendar types and URLs live (the other is the transport in `api.ts`).
 *
 * `events.list` with `singleEvents=true` makes Google expand recurrences
 * server-side, which is exactly what the contract asks for: we mirror expanded
 * occurrences and never reconstruct rules. Because a series master is therefore
 * never delivered, {@link PullResult.masterPurges} is ALWAYS empty here — the
 * Graph hazard that field exists for cannot arise.
 *
 * Feeds come from `calendar_allowlist`, never from Google: a disconnected or
 * de-selected member's feeds disappear naturally, matching how To Do feeds
 * already work. The row is also how a feed key is resolved back to its member
 * and calendar — this provider NEVER parses a feed key, because a Google
 * calendar id is email-shaped and a positional parse would split it.
 */

// Rolling window for a full pull. Same horizons as the Graph provider, so the
// two mirrors show the same span of household history and future.
const WINDOW_PAST_DAYS = 60;
const WINDOW_FUTURE_DAYS = 400;

// Defensive cap on a runaway pageToken chain.
const MAX_PAGES = 50;

const PAGE_SIZE = 250;

interface GoogleEventDateTime {
  /** All-day events carry `date` (YYYY-MM-DD) instead of `dateTime`. */
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string | null;
  location?: string | null;
  organizer?: { displayName?: string | null; email?: string | null } | null;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurringEventId?: string | null;
}

interface EventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface CalendarListResponse {
  items?: Array<{ id: string; summary?: string | null; summaryOverride?: string | null }>;
  nextPageToken?: string;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly source = 'google';

  /**
   * `resolveTimeZone` supplies the household IANA zone used to anchor all-day
   * dates; defaults to the live household row, tests inject a fixed zone.
   */
  constructor(
    private readonly rt: GoogleRuntime,
    private readonly resolveTimeZone: () => Promise<string> = getHouseholdTimeZone,
  ) {}

  async listAvailableCalendars(memberId: string): Promise<AvailableCalendar[]> {
    const token = await this.rt.oauth.getAccessToken(memberId);
    const out: AvailableCalendar[] = [];
    let url = `${GOOGLE_CALENDAR_BASE}/users/me/calendarList?maxResults=250`;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.rt.googleFetch<CalendarListResponse>(token, url);
      for (const cal of res.items ?? []) {
        out.push({ id: cal.id, name: (cal.summaryOverride ?? cal.summary ?? '').trim() || '(untitled calendar)' });
      }
      if (!res.nextPageToken) break;
      url = `${GOOGLE_CALENDAR_BASE}/users/me/calendarList?maxResults=250&pageToken=${encodeURIComponent(res.nextPageToken)}`;
    }
    return out;
  }

  /**
   * Feeds are the allowlisted calendars. `kind` is `'family'` for the
   * designated household calendar — but `memberId` STAYS SET even then: the
   * pull runs on that member's delegated token, and the sync runner uses this
   * field for its connection health short-circuit. Only the mirrored ROWS drop
   * their member attribution (see {@link toMirrored}).
   */
  async listFeeds(): Promise<CalendarFeed[]> {
    const feeds = await listAllowlistedCalendarFeeds('google');
    return feeds.map((f) => ({
      feedKey: f.feedKey,
      memberId: f.memberId,
      kind: f.isHousehold ? 'family' : 'member',
    }));
  }

  async pullChanges(
    feedKey: string, syncToken: string | null, forceFullResync = false,
  ): Promise<PullResult> {
    const feed = await getCalendarFeedByKey(feedKey);
    if (!feed) throw new Error(`Unknown Google calendar feed: ${feedKey}`);

    const zone = await this.resolveTimeZone();
    const accessToken = await this.rt.oauth.getAccessToken(feed.memberId);
    const attributedMemberId = feed.isHousehold ? null : feed.memberId;
    const base = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(feed.calendarId)}/events`;

    const fullResync = !syncToken || forceFullResync;
    // Computed ONCE, outside the paging loop. Google requires every follow-up
    // page to repeat the first request's query and add only `pageToken`; a
    // `windowParams()` recomputed per page would shift timeMin/timeMax by the
    // elapsed time and can invalidate the paging chain and the returned
    // nextSyncToken.
    const query = fullResync ? this.windowParams() : this.incrementalParams(syncToken!);
    let url = `${base}?${query}`;

    const upserts: MirroredEvent[] = [];
    const deletions: string[] = [];
    let nextToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let res: EventsListResponse;
      try {
        res = await this.rt.googleFetch<EventsListResponse>(accessToken, url);
      } catch (e) {
        // An expired/invalid syncToken is 410 GONE. Drop it and re-pull over a
        // freshly computed window; `deletions` cannot be trusted across the gap,
        // which is exactly what fullResync tells the store.
        if (e instanceof GoogleApiError && e.status === 410 && syncToken && !forceFullResync) {
          return this.pullChanges(feedKey, null);
        }
        throw e;
      }

      for (const ev of res.items ?? []) {
        // `cancelled` is Google's tombstone. With singleEvents=true it names a
        // single occurrence, so no cascade is needed or wanted.
        if (ev.status === 'cancelled') {
          deletions.push(ev.id);
          continue;
        }
        upserts.push(this.toMirrored(ev, attributedMemberId, zone));
      }

      if (res.nextPageToken) {
        url = `${base}?${query}&pageToken=${encodeURIComponent(res.nextPageToken)}`;
        continue;
      }
      nextToken = res.nextSyncToken ?? null;
      break;
    }

    return { upserts, deletions, masterPurges: [], nextToken, fullResync };
  }

  /** Query for a fresh full pull over the rolling window. */
  private windowParams(now = new Date()): string {
    const timeMin = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000).toISOString();
    return new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: String(PAGE_SIZE),
      timeMin,
      timeMax,
    }).toString();
  }

  /**
   * Query for an incremental pull. Deliberately WITHOUT timeMin/timeMax:
   * Google rejects a syncToken sent alongside them with a 400, because the
   * token already encodes the window the first request established.
   */
  private incrementalParams(syncToken: string): string {
    return new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: String(PAGE_SIZE),
      syncToken,
    }).toString();
  }

  private toMirrored(ev: GoogleEvent, memberId: string | null, zone: string): MirroredEvent {
    const allDay = ev.start?.date !== undefined;
    return {
      externalId: ev.id,
      title: ev.summary?.trim() || '(untitled)',
      start: this.toInstant(ev.start, zone),
      // Google's all-day `end.date` is EXCLUSIVE (the day after the last day),
      // which is the same convention Graph uses — carried across unchanged.
      end: this.toInstant(ev.end, zone),
      allDay,
      location: ev.location?.trim() || null,
      organizer: ev.organizer?.displayName?.trim() || ev.organizer?.email?.trim() || null,
      memberId,
      seriesMasterId: ev.recurringEventId ?? null,
    };
  }

  /**
   * A `dateTime` is already an absolute instant. A `date` is a CALENDAR DATE,
   * so it is anchored to household-local midnight — the same rule the task
   * providers apply to date-only due dates, and what makes the wall's local-day
   * bucketing land on the intended day.
   */
  private toInstant(dt: GoogleEventDateTime | undefined, zone: string): { utc: string; timeZone: string | null } {
    if (dt?.dateTime) {
      return { utc: new Date(dt.dateTime).toISOString(), timeZone: dt.timeZone ?? null };
    }
    if (dt?.date) {
      return { utc: zonedMidnightUtc(dt.date, zone).toISOString(), timeZone: dt.timeZone ?? zone };
    }
    // Google always sends one or the other for a non-cancelled event; a missing
    // value would be a malformed payload, so fail loudly rather than mirror a
    // wrong instant.
    throw new Error('Google event carried neither start/end dateTime nor date');
  }
}
