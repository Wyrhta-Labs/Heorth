import { WifiOff, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';

interface Props {
  isOffline: boolean;
  dataAsOf: string | null;
  pendingCount: number;
}

/** "offline / data from <time>" strip for the shopping list. Also used to
 * surface still-queued check-offs once the connection comes back but the
 * replay hasn't invalidated the list yet. */
export default function OfflineBanner({ isOffline, dataAsOf, pendingCount }: Props) {
  const { t } = useTranslation();
  const { formatTime } = useFormatters();
  if (!isOffline && pendingCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-ink">
      {isOffline ? (
        <>
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber" />
          <span>
            {t('shopping.offline')}{dataAsOf ? <> · {t('shopping.showingFrom')} <Clock className="inline h-3 w-3 -mt-0.5" /> {formatTime(dataAsOf)}</> : null}
          </span>
        </>
      ) : (
        <span className="text-amber">{t('shopping.syncing', { count: pendingCount })}</span>
      )}
      {isOffline && pendingCount > 0 && (
        <span className="ml-auto text-ash">{t('shopping.queued', { count: pendingCount })}</span>
      )}
    </div>
  );
}
