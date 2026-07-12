import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client';
import type { SingleResponse, ListResponse, Event, EventOccurrence } from '@/lib/types';

export interface ListEventsParams { from?: string; to?: string; member_id?: string; limit?: number; offset?: number; }
export interface EventInput {
  title: string; startAt: string; endAt: string; allDay?: boolean;
  location?: string | null; notes?: string | null; category?: string | null;
  color?: string | null; recurrence?: string | null; attendeeIds?: string[];
}

export function listEvents(params: ListEventsParams = {}): Promise<ListResponse<EventOccurrence>> {
  return apiGet(`/events${qs(params as Record<string, unknown>)}`);
}
export function getEvent(id: string): Promise<SingleResponse<Event>> {
  return apiGet(`/events/${id}`);
}
export function createEvent(input: EventInput): Promise<SingleResponse<Event>> {
  return apiPost('/events', input);
}
export function updateEvent(id: string, input: Partial<EventInput>): Promise<SingleResponse<Event>> {
  return apiPatch(`/events/${id}`, input);
}
export function moveEvent(id: string, startAt: string, endAt?: string): Promise<SingleResponse<Event>> {
  return apiPost(`/events/${id}/move`, { startAt, endAt });
}
export function deleteEvent(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/events/${id}`);
}
