import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EventDetailsDialog from '@/components/calendar/event-details-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { useEvents } from '@/hooks/use-calendar';
import { useFormatters } from '@/hooks/use-formatters';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { addDaysIso, dayWindowInTimeZone } from '@/lib/format';
import type { EventOccurrence } from '@/lib/types';

/**
 * The events of one household day — `day` (default: today), or `offset` days
 * on from it (1 = the day after). The day, its fetch window and the times shown
 * are all read in the household's zone; nothing is fetched until that zone is
 * known. Tapping an event opens its details in a modal.
 */
export default function Agenda(
  { day: baseDay, offset = 0, emptyMessage, errorMessage }:
  { day?: string; offset?: number; emptyMessage?: string; errorMessage?: string } = {},
) {
  const { t } = useTranslation();
  const { formatTime } = useFormatters();
  const { zone, ready } = useHouseholdZone();
  const today = useHouseholdToday(zone);
  const day = addDaysIso(baseDay ?? today, offset);
  const { from, to } = dayWindowInTimeZone(day, day, zone);
  const { data, isLoading, isError, refetch } = useEvents({ from, to }, { enabled: ready });
  const events = data?.data ?? [];
  const [open, setOpen] = useState<EventOccurrence | null>(null);

  if (isError) return <ErrorState compact message={errorMessage ?? t('today.agendaLoadError')} onRetry={() => refetch()} />;
  if (!ready || isLoading) return <div className="text-sm text-ash py-4 text-center">{t('common.loading')}</div>;
  if (events.length === 0) return <div className="text-sm text-ash py-4 text-center">{emptyMessage ?? t('today.noEventsToday')}</div>;

  return (
    <>
      <ul className="zebra space-y-2">
        {events.map((e) => (
          <li key={`${e.id}-${e.occurrenceStart}`}>
            <button
              type="button"
              onClick={() => setOpen(e)}
              className="flex w-full items-center gap-3 rounded-lg border border-tan bg-card px-3 py-2 text-left hover:border-ember"
            >
              <span className="text-xs font-medium text-ember w-16 shrink-0">
                {e.allDay ? t('hearth.event.allDay') : formatTime(e.occurrenceStart, zone)}
              </span>
              <span className="text-sm text-ink truncate">{e.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <EventDetailsDialog occurrence={open} onClose={() => setOpen(null)} timeZone={zone} />
    </>
  );
}
