import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { RoutineView, WeorcOccurrence } from '@/lib/types';

const ROW_CLASS = 'flex items-center justify-between gap-3 rounded-md border border-tan bg-card px-3 py-2';
const HIGHLIGHT_ROW_CLASS = 'flex items-center justify-between gap-3 rounded-md border border-ember bg-ember/10 px-3 py-2';

export interface OccurrenceEntry {
  routine: RoutineView;
  occurrence: WeorcOccurrence;
}

interface Props {
  entries: OccurrenceEntry[];
  emptyMessage: string;
  formatDate: (d: string | null | undefined) => string;
  /** Present only on the "Due now" list — "Coming up" rows render plainly,
   *  with no action to complete work that is not due yet. */
  onComplete?: (occurrenceId: string) => void;
  onSkip?: (occurrenceId: string) => void;
  /** Off where space is tight (the start page) — the Weorc page keeps it. */
  showProjectionProblem?: boolean;
  /** Highlight the occurrences due on this day (the start page's focused day). */
  highlightDueOn?: string;
  /** "Done" asks to be pressed a second time before it completes (the start page). */
  confirmComplete?: boolean;
}

/** Rows for one occurrence bucket ("Due now" / "Coming up"). A `projectionError`
 *  is surfaced as a quiet note next to the row, never as an alert — in the demo
 *  stack every occurrence is unprojected, permanently, and that is not a fault. */
export default function OccurrenceList(
  { entries, emptyMessage, formatDate, onComplete, onSkip, showProjectionProblem = true, highlightDueOn, confirmComplete = false }: Props,
) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return <p className="py-2 text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="zebra space-y-2">
      {entries.map(({ routine, occurrence }) => (
        <li
          key={occurrence.id}
          // A stable, positively-asserted hook for "this row is rendering
          // plainly" — the row's classes never change when `projectionError`
          // is set, so a test needs something other than "no error class
          // present" to pin that the plain state is actually what shipped.
          data-projection={occurrence.projectionError ? 'error' : 'ok'}
          data-highlight={highlightDueOn && occurrence.dueOn === highlightDueOn ? 'true' : undefined}
          // The plain row's class list stays exactly as it was: the Weorc tests
          // pin it to prove a projectionError adds no visual alarm.
          className={highlightDueOn && occurrence.dueOn === highlightDueOn ? HIGHLIGHT_ROW_CLASS : ROW_CLASS}
        >
          <div>
            <p className="text-sm font-medium">{routine.name}</p>
            <p className="text-xs text-muted">{formatDate(occurrence.dueOn)}</p>
            {showProjectionProblem && occurrence.projectionError && (
              <p className="text-xs text-ash">{t('weorc.projectionProblem')}</p>
            )}
          </div>
          {(onComplete || onSkip) && (
            <div className="flex shrink-0 gap-2">
              {onComplete && (confirmComplete
                ? <ConfirmDoneButton onConfirm={() => onComplete(occurrence.id)} />
                : <Button size="sm" onClick={() => onComplete(occurrence.id)}>{t('weorc.complete')}</Button>
              )}
              {onSkip && (
                <Button size="sm" variant="outline" onClick={() => onSkip(occurrence.id)}>{t('weorc.skip')}</Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const CONFIRM_WINDOW_MS = 4000;

/**
 * "Done" that needs a second press: the first arms it ("Sure?"), the second
 * completes. It disarms by itself after a few seconds, and stays disabled once
 * sent so a third tap cannot complete the same occurrence twice before the
 * list refreshes.
 */
function ConfirmDoneButton({ onConfirm }: { onConfirm: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'armed' | 'sent'>('idle');

  useEffect(() => {
    if (state !== 'armed') return;
    const timer = setTimeout(() => setState('idle'), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <Button
      size="sm"
      variant={state === 'idle' ? 'default' : 'warning'}
      disabled={state === 'sent'}
      onBlur={() => state === 'armed' && setState('idle')}
      onClick={() => {
        if (state === 'idle') return setState('armed');
        setState('sent');
        onConfirm();
      }}
    >
      {state === 'idle' ? t('weorc.complete') : t('weorc.confirmComplete')}
    </Button>
  );
}
