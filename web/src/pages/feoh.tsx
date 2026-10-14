import { useState } from 'react';
import { ArrowLeftRight, CalendarClock, Inbox, Plus } from 'lucide-react';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SectionCard, SectionTitle, toneCard } from '@/components/ui/section-tone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import SummaryHeader from '@/components/feoh/summary-header';
import EnvelopeCard from '@/components/feoh/envelope-card';
import BillsList from '@/components/feoh/bills-list';
import AccountsPanel from '@/components/feoh/accounts-panel';
import TransactionForm from '@/components/feoh/transaction-form';
import CsvPanel from '@/components/feoh/csv-panel';
import ImportInbox from '@/components/feoh/import-inbox';
import ImportRules from '@/components/feoh/import-rules';
import ImportAccounts from '@/components/feoh/import-accounts';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useSummary, useEnvelopes, useAccounts, useBills, useRecordTransaction, useDeleteBill } from '@/hooks/use-feoh';
import { useImportStatus, useTriggerSync } from '@/hooks/use-feoh-import';
import { ApiError } from '@/api/client';

export default function FeohPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  // The budget month is the HOUSEHOLD's; not fetched until its zone is known.
  const { zone, ready } = useHouseholdZone();
  const month = useHouseholdToday(zone).slice(0, 7);
  const summaryQuery = useSummary(month, { enabled: ready });
  const envQuery = useEnvelopes();
  const acctQuery = useAccounts();
  const billsQuery = useBills();
  const record = useRecordTransaction();
  const deleteBill = useDeleteBill();
  const importStatus = useImportStatus();
  const sync = useTriggerSync();
  const status = importStatus.data?.data;
  const pullNow = async () => {
    try {
      const r = await sync.mutateAsync();
      toast(t('feoh.import.syncDone', { inserted: r.data.inserted, booked: r.data.booked }), 'success');
    } catch (e) {
      toast(t('feoh.import.syncFailed', { reason: e instanceof ApiError ? e.code : (e as Error).message }), 'error');
    }
  };
  const [txOpen, setTxOpen] = useState(false);

  const summary = summaryQuery.data?.data;
  const envelopes = envQuery.data?.data ?? [];
  const accounts = acctQuery.data?.data ?? [];
  const bills = billsQuery.data?.data ?? [];
  const retry = retryOf(summaryQuery, envQuery, acctQuery, billsQuery);

  const submitTx = async (input: Parameters<typeof record.mutateAsync>[0]) => {
    try {
      await record.mutateAsync(input);
      setTxOpen(false);
      toast(t('feoh.transactionRecorded'), 'success');
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'UNBALANCED' ? t('feoh.unbalanced') : (e as Error).message;
      toast(msg || t('feoh.recordFailed'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-2xl text-ink">Feoh</h3>
        <Button onClick={() => setTxOpen(true)}><Plus className="h-4 w-4" /> {t('feoh.newTransaction')}</Button>
      </div>

      {retry ? (
        <ErrorState message={t('feoh.loadError')} onRetry={retry} />
      ) : (
        <>
          {summary && <SummaryHeader summary={summary} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(summary?.envelopes ?? []).map((e) => <EnvelopeCard key={e.envelopeId} envelope={e} />)}
          </div>

          <SectionCard title={t('feoh.recurringBills')} icon={CalendarClock} tone="amber" shade={1}>
            <BillsList bills={bills} onRemove={(id) => deleteBill.mutate(id)} />
          </SectionCard>

          <AccountsPanel />

          <SectionCard title={t('feoh.importExport')} icon={ArrowLeftRight} tone="amber" shade={1}>
            <CsvPanel />
          </SectionCard>

          <Card className={toneCard('amber', 2)}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
              <SectionTitle icon={Inbox} tone="amber">
                {t('feoh.import.title')}
                {status && status.pendingCount > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted">{t('feoh.import.pending', { count: status.pendingCount })}</span>
                )}
              </SectionTitle>
              {status?.enabled && (
                <Button size="sm" variant="outline" onClick={pullNow} disabled={sync.isPending}>
                  {sync.isPending ? t('feoh.import.syncing') : t('feoh.import.syncNow')}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted">{t('feoh.import.intro')}</p>
              {status && !status.enabled && <p className="text-sm text-muted">{t('feoh.import.disabled')}</p>}
              {status?.feed?.lastError && <p className="text-sm text-warning">{t('feoh.import.lastError', { reason: status.feed.lastError })}</p>}
              {status && <ImportInbox householdCurrency={status.currency} />}
              <ImportRules />
              <ImportAccounts />
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={txOpen} onOpenChange={setTxOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('feoh.newTransaction')}</DialogTitle>
            <DialogClose onClose={() => setTxOpen(false)} />
          </DialogHeader>
          <TransactionForm accounts={accounts} envelopes={envelopes} onSubmit={submitTx} onCancel={() => setTxOpen(false)} isLoading={record.isPending} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
