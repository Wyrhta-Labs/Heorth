import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney, formatDate } from '@/lib/format';
import type { RecurringBill } from '@/lib/types';

interface Props { bills: RecurringBill[]; onRemove: (id: string) => void; }

export default function BillsList({ bills, onRemove }: Props) {
  if (bills.length === 0) return <div className="text-sm text-ash py-4 text-center">No recurring bills.</div>;
  return (
    <ul className="space-y-2">
      {bills.map((b) => (
        <li key={b.id} className="flex items-center justify-between rounded-lg border border-tan bg-card px-3 py-2">
          <div>
            <div className="text-sm font-medium text-ink">{b.payee}</div>
            <div className="text-xs text-ash">Next due {formatDate(b.nextDue)} · {b.cadence}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm">{formatMoney(b.amount)}</span>
            <Button variant="ghost" size="icon" onClick={() => onRemove(b.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
