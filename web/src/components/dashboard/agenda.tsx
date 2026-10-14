import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/ui/error-state';
import { useEvents } from '@/hooks/use-calendar';
import { useFormatters } from '@/hooks/use-formatters';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { addDaysIso, dayWindowInTimeZone } from '@/lib/format';

/**
 * The events of one household day — today, or `offset` days on (1 =
 * tomorrow). The day, its fetch window and the times shown are all read in
 * the household's zone; nothing is fetched until that zone is known.
 */
export default function Agenda(
  { offset = 0, emptyMessage, errorMessage }: { offset?: number; emptyMessage?: string; errorMessage?: string } = {},
) {
  const { t } = useTranslation();
  const { formatTime } = useFormatters();
  const { zone, ready } = useHouseholdZone();
  const day = addDaysIso(useHouseholdToday(zone), offset);
  const { from, to } = dayWindowInTimeZone(day, day, zone);
  const { data, isLoading, isError, refetch } = useEvents({ from, to }, { enabled: ready });
  const events = data?.data ?? [];

  if (isError) return <ErrorState compact message={errorMessage ?? t('today.agendaLoadError')} onRetry={() => refetch()} />;
  if (!ready || isLoading) return <div className="text-sm text-ash py-4 text-center">{t('common.loading')}</div>;
  if (events.length === 0) return <div className="text-sm text-ash py-4 text-center">{emptyMessage ?? t('today.noEventsToday')}</div>;

  return (
    <ul className="zebra space-y-2">
      {events.map((e) => (
        <li key={`${e.id}-${e.occurrenceStart}`} className="flex items-center gap-3 rounded-lg border border-tan bg-card px-3 py-2">
          <span className="text-xs font-medium text-ember w-16 shrink-0">
            {e.allDay ? t('hearth.event.allDay') : formatTime(e.occurrenceStart, zone)}
          </span>
          <span className="text-sm text-ink truncate">{e.title}</span>
        </li>
      ))}
    </ul>
  );
}
