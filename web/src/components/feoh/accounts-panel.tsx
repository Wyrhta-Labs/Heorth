import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAccounts, useLedger } from '@/hooks/use-feoh';
import { useFormatters } from '@/hooks/use-formatters';
import LedgerView from '@/components/feoh/ledger-view';
import ReconcileDialog from '@/components/feoh/reconcile-dialog';
import type { Account } from '@/lib/types';

interface RowProps {
  account: Account;
  expanded: boolean;
  onToggle: () => void;
}

function AccountRow({ account, expanded, onToggle }: RowProps) {
  const { t } = useTranslation();
  const { formatMoney } = useFormatters();
  // Fetched at limit=1 purely to read the ledger meta's endBalance; the row's
  // own expand-to-ledger view fetches the full page separately.
  const ledgerQuery = useLedger(account.id, { limit: 1, offset: 0 });
  const endBalance = ledgerQuery.data?.meta.endBalance;
  const [reconcileOpen, setReconcileOpen] = useState(false);

  return (
    <div className="rounded-lg border border-tan bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={onToggle}>
          {expanded ? <ChevronUp className="h-4 w-4 text-ash" /> : <ChevronDown className="h-4 w-4 text-ash" />}
          <span className="text-sm font-medium text-ink">{account.name}</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink">{endBalance !== undefined ? formatMoney(endBalance) : '…'}</span>
          {account.kind === 'asset' && (
            <Button variant="outline" size="sm" onClick={() => setReconcileOpen(true)}>
              {t('feoh.accounts.reconcile')}
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-tan px-3 py-2">
          <LedgerView accountId={account.id} />
        </div>
      )}
      {account.kind === 'asset' && (
        <ReconcileDialog open={reconcileOpen} onOpenChange={setReconcileOpen} accountId={account.id} />
      )}
    </div>
  );
}

export default function AccountsPanel() {
  const { t } = useTranslation();
  const acctQuery = useAccounts();
  const accounts = acctQuery.data?.data ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('feoh.accounts.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            expanded={expandedId === a.id}
            onToggle={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
          />
        ))}
      </CardContent>
    </Card>
  );
}
