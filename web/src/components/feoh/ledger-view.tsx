import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useLedger } from '@/hooks/use-feoh';
import { useFormatters } from '@/hooks/use-formatters';
import { LEDGER_PAGE_SIZE } from '@/lib/constants';
import type { LedgerEntry } from '@/lib/types';

interface Props { accountId: string; }

/**
 * Paginated ledger table: `limit` stays fixed at LEDGER_PAGE_SIZE, "load more"
 * requests the NEXT page via offset += LEDGER_PAGE_SIZE and appends its rows
 * to the accumulated list (no re-fetch of already-loaded rows). Running
 * balances stay correct across pages because the backend computes `balance`
 * over full account history, not per-page.
 */
export default function LedgerView({ accountId }: Props) {
  const { t } = useTranslation();
  const { formatMoney, formatDate } = useFormatters();
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  // Offsets already folded into `entries` — guards against re-appending the
  // same page if this query re-renders with unchanged data (e.g. a sibling
  // state update), since we accumulate rather than replace on each fetch.
  const appendedOffsets = useRef<Set<number>>(new Set());

  const ledgerQuery = useLedger(accountId, { limit: LEDGER_PAGE_SIZE, offset });
  const meta = ledgerQuery.data?.meta;

  // Reset accumulated state when switching accounts.
  useEffect(() => {
    setEntries([]);
    appendedOffsets.current = new Set();
    setOffset(0);
  }, [accountId]);

  useEffect(() => {
    const data = ledgerQuery.data;
    if (!data) return;
    const pageOffset = data.meta.offset;
    if (appendedOffsets.current.has(pageOffset)) return;
    appendedOffsets.current.add(pageOffset);
    setEntries((prev) => (pageOffset === 0 ? data.data : [...prev, ...data.data]));
  }, [ledgerQuery.data]);

  return (
    <div className="space-y-2">
      {meta && (
        <div className="text-xs text-ash">{t('feoh.accounts.openingBalance')}: {formatMoney(meta.openingBalance)}</div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('feoh.form.date')}</TableHead>
            <TableHead>{t('feoh.form.payee')}</TableHead>
            <TableHead className="text-right">{t('feoh.accounts.ledger')}</TableHead>
            <TableHead className="text-right">{t('feoh.accounts.balance')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.transactionId}>
              <TableCell>{formatDate(e.date)}</TableCell>
              <TableCell>{e.payee}</TableCell>
              <TableCell className="text-right">{formatMoney(e.delta)}</TableCell>
              <TableCell className="text-right">{formatMoney(e.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {meta && meta.total > entries.length && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + LEDGER_PAGE_SIZE)}>
            {t('feoh.accounts.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
