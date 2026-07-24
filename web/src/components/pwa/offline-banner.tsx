import { WifiOff, Clock } from 'lucide-react';
import { formatTime } from '@/lib/format';

interface Props {
  isOffline: boolean;
  dataAsOf: string | null;
  pendingCount: number;
}

/** "offline / data from <time>" strip for the shopping list. Also used to
 * surface still-queued check-offs once the connection comes back but the
 * replay hasn't invalidated the list yet. */
export default function OfflineBanner({ isOffline, dataAsOf, pendingCount }: Props) {
  if (!isOffline && pendingCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-ink">
      {isOffline ? (
        <>
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber" />
          <span>
            Offline{dataAsOf ? <> · showing your list from <Clock className="inline h-3 w-3 -mt-0.5" /> {formatTime(dataAsOf)}</> : null}
          </span>
        </>
      ) : (
        <span className="text-amber">Syncing {pendingCount} check-off{pendingCount === 1 ? '' : 's'}…</span>
      )}
      {isOffline && pendingCount > 0 && (
        <span className="ml-auto text-ash">{pendingCount} queued</span>
      )}
    </div>
  );
}
