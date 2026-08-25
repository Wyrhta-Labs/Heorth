import { apiDelete, apiGet, apiPatch, apiPost, qs } from './client';
import type {
  IntervalUnit,
  ListResponse,
  RoutineMode,
  RoutineView,
  SingleResponse,
  WeorcOccurrence,
  WeorcOccurrenceStatus,
  WeorcRoutineDetail,
  WeorcTickResult,
  TerminateResult,
} from '@/lib/types';

export interface RoutineInput {
  name: string;
  notes?: string | null;
  mode: RoutineMode;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  anchorDate: string;
  leadDays?: number;
  ownerMemberId?: string | null;
  anchorAssetId?: string | null;
  anchorPlaceId?: string | null;
}

/** `active` is the STRING 'true'/'false', matching the server's
 *  `z.enum(['true','false'])` - a boolean would serialise the same way but
 *  invites a `z.coerce.boolean()` on the other side, where Boolean('false')
 *  is true. Query keys are snake_case on the wire. */
export function listRoutines(
  params: {
    active?: 'true' | 'false';
    anchor_asset_id?: string;
    anchor_place_id?: string;
    owner_member_id?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ListResponse<RoutineView>> {
  return apiGet(`/weorc/routines${qs(params)}`);
}

export function createRoutine(input: RoutineInput): Promise<SingleResponse<RoutineView>> {
  return apiPost('/weorc/routines', input);
}

export function getRoutine(id: string): Promise<SingleResponse<WeorcRoutineDetail>> {
  return apiGet(`/weorc/routines/${id}`);
}

export function updateRoutine(
  id: string,
  input: Partial<RoutineInput> & { active?: boolean },
): Promise<SingleResponse<RoutineView & { openOccurrenceUnchanged: boolean }>> {
  return apiPatch(`/weorc/routines/${id}`, input);
}

export function deleteRoutine(id: string): Promise<SingleResponse<{ deleted: boolean }>> {
  return apiDelete(`/weorc/routines/${id}`);
}

/** `due_to=<today>` is how the page asks for what is ACTUALLY due, as opposed
 *  to everything open - which, inside a lead window, includes work due later. */
export function listOccurrences(
  params: { status?: WeorcOccurrenceStatus; routine_id?: string; due_to?: string } = {},
): Promise<ListResponse<WeorcOccurrence>> {
  return apiGet(`/weorc/occurrences${qs(params)}`);
}

export function completeOccurrence(
  id: string,
  input: { completedAt?: string; note?: string | null } = {},
): Promise<SingleResponse<TerminateResult>> {
  return apiPost(`/weorc/occurrences/${id}/complete`, input);
}

export function skipOccurrence(
  id: string,
  input: { note?: string | null } = {},
): Promise<SingleResponse<TerminateResult>> {
  return apiPost(`/weorc/occurrences/${id}/skip`, input);
}

export function runWeorc(): Promise<SingleResponse<WeorcTickResult>> {
  return apiPost('/weorc/run', {});
}
