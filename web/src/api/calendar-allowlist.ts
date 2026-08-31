import { apiGet, apiPut } from './client';
import type { SingleResponse, AvailableCalendar } from '@/lib/types';

/**
 * Calendar discovery and selection — the sibling of the To Do list picker's
 * API. Nothing mirrors until a member picks a calendar here.
 */
export function listCalendars(): Promise<SingleResponse<AvailableCalendar[]>> {
  return apiGet('/calendar/calendars');
}

export function setCalendarAllowlist(
  calendars: Array<{ provider: string; calendarId: string }>,
): Promise<SingleResponse<unknown[]>> {
  return apiPut('/calendar/allowlist', { calendars });
}

/** Designate the shared family calendar (admin/adult only, enforced server-side). */
export function setHouseholdCalendar(
  provider: string, calendarId: string,
): Promise<SingleResponse<unknown>> {
  return apiPut('/calendar/household-calendar', { provider, calendarId });
}
