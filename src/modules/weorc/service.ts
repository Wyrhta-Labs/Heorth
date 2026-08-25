import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { ethelAssets, ethelPlaces } from '../ethel/schema.js';
import * as tasks from '../tasks/service.js';
import { getTaskProvider } from '../tasks/provider.js';
import { TaskProviderError } from '../tasks/providers/types.js';
import { advanceRoutine, projectOccurrence, terminalDateOf, type ProjectionOutcome } from './engine.js';
import { householdToday } from './dates.js';
import { nextDueOn } from './recurrence.js';
import * as store from './store.js';
import type { IntervalUnit, RoutineMode, WeorcOccurrence, WeorcRoutine } from './schema.js';
import type { CreateRoutineInput, UpdateRoutineInput } from './validators.js';

export class AnchorConflictError extends Error {}

export class AnchorNotFoundError extends Error {
  constructor(public readonly kind: 'asset' | 'place') {
    super(`${kind} not found`);
  }
}

export class RoutineHasHistoryError extends Error {}
export class AlreadyTerminalError extends Error {}

export interface RoutineView extends WeorcRoutine {
  nextDueOn: string;
  openOccurrence: WeorcOccurrence | null;
}

async function assertAnchor(input: {
  anchorAssetId?: string | null;
  anchorPlaceId?: string | null;
}): Promise<void> {
  if (input.anchorAssetId && input.anchorPlaceId) throw new AnchorConflictError();
  if (input.anchorAssetId) {
    const [row] = await db.select({ id: ethelAssets.id }).from(ethelAssets)
      .where(eq(ethelAssets.id, input.anchorAssetId));
    if (!row) throw new AnchorNotFoundError('asset');
  }
  if (input.anchorPlaceId) {
    const [row] = await db.select({ id: ethelPlaces.id }).from(ethelPlaces)
      .where(eq(ethelPlaces.id, input.anchorPlaceId));
    if (!row) throw new AnchorNotFoundError('place');
  }
}

async function view(routine: WeorcRoutine, today: string): Promise<RoutineView> {
  const open = await store.getOpenOccurrence(routine.id);
  if (open) return { ...routine, nextDueOn: open.dueOn, openOccurrence: open };

  const last = await store.lastTerminalOccurrence(routine.id);
  const due = nextDueOn({
    mode: routine.mode as RoutineMode,
    intervalUnit: routine.intervalUnit as IntervalUnit,
    intervalCount: routine.intervalCount,
    anchorDate: routine.anchorDate,
  }, last ? await terminalDateOf(last, routine.mode as RoutineMode) : null, today);

  return { ...routine, nextDueOn: due, openOccurrence: null };
}

export async function listRoutines(q: store.ListRoutinesQuery): Promise<{
  rows: RoutineView[];
  total: number;
  limit: number;
  offset: number;
}> {
  const { rows, total, limit, offset } = await store.listRoutines(q);
  const today = await householdToday();
  return { rows: await Promise.all(rows.map((r) => view(r, today))), total, limit, offset };
}

export interface RoutineDetail extends RoutineView {
  history: WeorcOccurrence[];
}

export async function getRoutineDetail(id: string): Promise<RoutineDetail | null> {
  const routine = await store.getRoutine(id);
  if (!routine) return null;

  const today = await householdToday();
  const base = await view(routine, today);
  const history = await store.listTerminalOccurrences(id);
  return { ...base, history };
}

export async function createRoutine(input: CreateRoutineInput): Promise<RoutineView> {
  await assertAnchor(input);
  const routine = await store.createRoutine(input);
  const today = await householdToday();
  await advanceRoutine(routine.id, today);
  return view((await store.getRoutine(routine.id))!, today);
}

export interface UpdateResult extends RoutineView {
  openOccurrenceUnchanged: boolean;
}

export async function updateRoutine(id: string, patch: UpdateRoutineInput): Promise<UpdateResult | null> {
  const before = await store.getRoutine(id);
  if (!before) return null;

  await assertAnchor({ ...before, ...patch });
  const routine = await store.updateRoutine(id, patch);
  if (!routine) return null;

  const today = await householdToday();
  const open = await store.getOpenOccurrence(id);
  let openOccurrenceUnchanged = false;
  if (open) {
    if (open.taskExternalId) {
      openOccurrenceUnchanged = true;
    } else {
      const last = await store.lastTerminalOccurrence(id);
      const due = nextDueOn({
        mode: routine.mode as RoutineMode,
        intervalUnit: routine.intervalUnit as IntervalUnit,
        intervalCount: routine.intervalCount,
        anchorDate: routine.anchorDate,
      }, last ? await terminalDateOf(last, routine.mode as RoutineMode) : null, today);
      if (due !== open.dueOn) await store.moveOccurrence(open.id, due);
    }
  }

  return { ...(await view((await store.getRoutine(id))!, today)), openOccurrenceUnchanged };
}

export async function deleteRoutine(id: string): Promise<boolean> {
  const routine = await store.getRoutine(id);
  if (!routine) return false;
  if (await store.hasTerminalOccurrence(id)) throw new RoutineHasHistoryError();
  return store.deleteRoutine(id);
}

export interface TerminateResult {
  occurrence: WeorcOccurrence;
  next: WeorcOccurrence | null;
  projection: ProjectionOutcome;
}

export async function completeOccurrence(
  id: string,
  input: { completedAt?: string; note?: string | null },
  actingMemberId: string,
): Promise<TerminateResult | null> {
  return terminate(
    id,
    'completed',
    input.completedAt ? new Date(input.completedAt) : new Date(),
    actingMemberId,
    input.note ?? null,
  );
}

export async function skipOccurrence(
  id: string,
  input: { note?: string | null },
  actingMemberId: string,
): Promise<TerminateResult | null> {
  return terminate(id, 'skipped', null, actingMemberId, input.note ?? null);
}

async function terminate(
  id: string,
  status: 'completed' | 'skipped',
  at: Date | null,
  memberId: string,
  note: string | null,
): Promise<TerminateResult | null> {
  const occ = await store.getOccurrence(id);
  if (!occ) return null;
  if (occ.status !== 'due') throw new AlreadyTerminalError();

  const terminated = (await store.terminateOccurrence(id, status, at, memberId, note))!;

  let projection: ProjectionOutcome = { ok: false };
  if (status === 'completed' && occ.taskFeedKey && occ.taskExternalId && getTaskProvider()) {
    try {
      await tasks.completeProjectedTask(occ.taskFeedKey, occ.taskExternalId, true);
      projection = { ok: true };
    } catch (e: unknown) {
      if (e instanceof TaskProviderError) projection = { ok: false, reason: e.reason };
      else throw e;
    }
  }

  const today = await householdToday();
  const next = await advanceRoutine(occ.routineId, today);
  let projectedNext = next;
  if (next && getTaskProvider()) {
    await projectOccurrence(next);
    projectedNext = await store.getOccurrence(next.id);
  }

  return { occurrence: terminated, next: projectedNext, projection };
}
