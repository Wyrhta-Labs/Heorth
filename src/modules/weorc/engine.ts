import { logError } from '@wyrhta/core/lib';
import * as tasks from '../tasks/service.js';
import { TaskProviderError } from '../tasks/providers/types.js';
import { getTaskProvider } from '../tasks/provider.js';
import { anchorName } from './anchors.js';
import * as store from './store.js';
import { householdToday, householdMidnightUtc } from './dates.js';
import { localDateOf } from '../../lib/local-date.js';
import { getHouseholdTimeZone } from '../../household/timezone.js';
import { nextDueOn, addDays } from './recurrence.js';
import type {
  IntervalUnit,
  RoutineMode,
  WeorcOccurrence,
  WeorcRoutine,
} from './schema.js';

/**
 * Weorc's projection engine. One tick, three passes, in this order: reconcile
 * first, then materialise, then project. That lets a completion detected in the
 * current tick produce its successor in the same tick.
 */

export interface WeorcTickResult {
  reconciled: number;
  materialised: number;
  projected: number;
  projectionFailures: number;
}

export interface ProjectionOutcome {
  ok: boolean;
  reason?: string;
}

export function occurrenceMarker(occurrenceId: string): string {
  return `weorc-occurrence:${occurrenceId}`;
}

export async function terminalDateOf(occ: WeorcOccurrence): Promise<string> {
  if (occ.status === 'completed' && occ.completedAt) {
    return localDateOf(occ.completedAt, await getHouseholdTimeZone());
  }
  return occ.dueOn;
}

export async function advanceRoutine(
  routineId: string,
  today: string,
  force = false,
): Promise<WeorcOccurrence | null> {
  const routine = await store.getRoutine(routineId);
  if (!routine || !routine.active) return null;

  const existing = await store.getOpenOccurrence(routineId);
  if (existing) return existing;

  const last = await store.lastTerminalOccurrence(routineId);
  const due = nextDueOn(
    {
      mode: routine.mode as RoutineMode,
      intervalUnit: routine.intervalUnit as IntervalUnit,
      intervalCount: routine.intervalCount,
      anchorDate: routine.anchorDate,
    },
    last ? await terminalDateOf(last) : null,
    today,
  );

  if (!force && due > addDays(today, routine.leadDays)) return null;
  const occ = await store.insertOccurrence(routineId, due);
  return occ.status === 'due' ? occ : null;
}

async function composeNotes(routine: WeorcRoutine, occurrenceId: string): Promise<string> {
  const parts: string[] = [];
  const anchor = await anchorName(routine);
  if (anchor) parts.push(anchor);
  if (routine.notes) parts.push(routine.notes);
  parts.push(occurrenceMarker(occurrenceId));
  return parts.join('\n\n');
}

export async function projectOccurrence(occ: WeorcOccurrence): Promise<ProjectionOutcome> {
  if (!getTaskProvider()) return { ok: false };

  const routine = await store.getRoutine(occ.routineId);
  if (!routine) return { ok: false };

  const existing = await tasks.findTaskByNotesMarker(occurrenceMarker(occ.id));
  if (existing) {
    await store.setProjection(occ.id, existing.feedKey, existing.externalId);
    return { ok: true };
  }

  try {
    const created = await tasks.createHouseholdTask({
      title: routine.name,
      notes: await composeNotes(routine, occ.id),
      dueAt: (await householdMidnightUtc(occ.dueOn)).toISOString(),
    }, routine.ownerMemberId);
    await store.setProjection(occ.id, created.feedKey, created.externalId);
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof TaskProviderError) {
      await store.setProjectionError(occ.id, e.reason);
      return { ok: false, reason: e.reason };
    }
    throw e;
  }
}

export async function runWeorcTick(): Promise<WeorcTickResult> {
  const today = await householdToday();
  const result: WeorcTickResult = {
    reconciled: 0,
    materialised: 0,
    projected: 0,
    projectionFailures: 0,
  };
  const reconciledRoutineIds = new Set<string>();

  for (const occ of await store.openOccurrencesWithLink()) {
    const mirrored = await tasks.findTaskByFeedRef(occ.taskFeedKey!, occ.taskExternalId!);
    if (!mirrored) continue;
    if (mirrored.status !== 'completed') continue;

    await store.terminateOccurrence(
      occ.id,
      'completed',
      mirrored.completedAt ?? new Date(),
      null,
      occ.note,
    );
    result.reconciled += 1;
    reconciledRoutineIds.add(occ.routineId);
  }

  for (const routine of await store.activeRoutinesWithoutOpenOccurrence()) {
    const created = await advanceRoutine(routine.id, today, reconciledRoutineIds.has(routine.id));
    if (created) result.materialised += 1;
  }

  if (getTaskProvider()) {
    for (const occ of await store.openOccurrencesWithoutLink()) {
      try {
        const outcome = await projectOccurrence(occ);
        if (outcome.ok) result.projected += 1;
        else if (outcome.reason) result.projectionFailures += 1;
      } catch (e: unknown) {
        logError('weorc projection failed', e);
        result.projectionFailures += 1;
      }
    }
  }

  return result;
}
