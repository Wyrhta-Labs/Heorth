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
  // The `dataUpdatedAt` we last folded in. A later timestamp for an offset
  // that's already in `appendedOffsets` means react-query delivered a FRESH
  // page for it — e.g. reconciling the account invalidates the ledger key
  // and the currently-mounted page refetches. That must overwrite the stale
  // accumulated rows, not be discarded as "already seen".
  const lastDataUpdatedAt = useRef(0);

  const ledgerQuery = useLedger(accountId, { limit: LEDGER_PAGE_SIZE, offset });
  const meta = ledgerQuery.data?.meta;

  // Reset accumulated state when switching accounts.
  useEffect(() => {
    setEntries([]);
    appendedOffsets.current = new Set();
    lastDataUpdatedAt.current = 0;
    setOffset(0);
  }, [accountId]);

  useEffect(() => {
    const data = ledgerQuery.data;
    if (!data) return;
    const pageOffset = data.meta.offset;
    const updatedAt = ledgerQuery.dataUpdatedAt;
    const isRefetch = updatedAt > lastDataUpdatedAt.current;

    if (appendedOffsets.current.has(pageOffset)) {
      if (!isRefetch) return; // Unchanged re-render of already-appended data — no-op.
      // Invalidation refetch of a page we already rendered (e.g. after
      // reconciling): collapse back to this fresh page instead of keeping
      // rows from before the invalidation, so `entries`/`meta.total` and
      // subsequent offset math stay in sync with the server.
      appendedOffsets.current = new Set([pageOffset]);
      setEntries(data.data);
      lastDataUpdatedAt.current = updatedAt;
      return;
    }

    appendedOffsets.current.add(pageOffset);
    setEntries((prev) => (pageOffset === 0 ? data.data : [...prev, ...data.data]));
    lastDataUpdatedAt.current = updatedAt;
  }, [ledgerQuery.data, ledgerQuery.dataUpdatedAt]);

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
