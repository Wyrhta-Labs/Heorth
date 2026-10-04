import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/ui/error-state';
import { useEvents } from '@/hooks/use-calendar';
import { useFormatters } from '@/hooks/use-formatters';
import { dayRangeIso } from '@/lib/format';

/** The events of one local day — today unless `day` says otherwise. */
export default function Agenda(
  { day, emptyMessage, errorMessage }: { day?: Date; emptyMessage?: string; errorMessage?: string } = {},
) {
  const { t } = useTranslation();
  const { formatTime } = useFormatters();
  const { from, to } = dayRangeIso(day);
  const { data, isLoading, isError, refetch } = useEvents({ from, to });
  const events = data?.data ?? [];

  if (isError) return <ErrorState compact message={errorMessage ?? t('today.agendaLoadError')} onRetry={() => refetch()} />;
  if (isLoading) return <div className="text-sm text-ash py-4 text-center">{t('common.loading')}</div>;
  if (events.length === 0) return <div className="text-sm text-ash py-4 text-center">{emptyMessage ?? t('today.noEventsToday')}</div>;

  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={`${e.id}-${e.occurrenceStart}`} className="flex items-center gap-3 rounded-lg border border-tan bg-card px-3 py-2">
          <span className="text-xs font-medium text-ember w-16 shrink-0">
            {e.allDay ? t('hearth.event.allDay') : formatTime(e.occurrenceStart)}
          </span>
          <span className="text-sm text-ink truncate">{e.title}</span>
        </li>
      ))}
    </ul>
  );
}
