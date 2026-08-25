import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { RoutineView, WeorcOccurrence } from '@/lib/types';

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
}

/** Rows for one occurrence bucket ("Due now" / "Coming up"). A `projectionError`
 *  is surfaced as a quiet note next to the row, never as an alert — in the demo
 *  stack every occurrence is unprojected, permanently, and that is not a fault. */
export default function OccurrenceList({ entries, emptyMessage, formatDate, onComplete, onSkip }: Props) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map(({ routine, occurrence }) => (
        <li
          key={occurrence.id}
          // A stable, positively-asserted hook for "this row is rendering
          // plainly" — the row's classes never change when `projectionError`
          // is set, so a test needs something other than "no error class
          // present" to pin that the plain state is actually what shipped.
          data-projection={occurrence.projectionError ? 'error' : 'ok'}
          className="flex items-center justify-between gap-3 rounded-md border border-tan bg-card px-3 py-2"
        >
          <div>
            <p className="text-sm font-medium">{routine.name}</p>
            <p className="text-xs text-muted-foreground">{formatDate(occurrence.dueOn)}</p>
            {occurrence.projectionError && (
              <p className="text-xs text-ash">{t('weorc.projectionProblem')}</p>
            )}
          </div>
          {(onComplete || onSkip) && (
            <div className="flex shrink-0 gap-2">
              {onComplete && (
                <Button size="sm" onClick={() => onComplete(occurrence.id)}>{t('weorc.complete')}</Button>
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
