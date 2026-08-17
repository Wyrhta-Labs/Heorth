import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useLedger } from '@/hooks/use-feoh';
import { useFormatters } from '@/hooks/use-formatters';

const PAGE_SIZE = 50;

interface Props { accountId: string; }

/** Paginated ledger table: fetches `limit` rows from offset 0, "load more" grows the limit. */
export default function LedgerView({ accountId }: Props) {
  const { t } = useTranslation();
  const { formatMoney, formatDate } = useFormatters();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const ledgerQuery = useLedger(accountId, { limit, offset: 0 });
  const entries = ledgerQuery.data?.data ?? [];
  const meta = ledgerQuery.data?.meta;

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
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            {t('feoh.accounts.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
