import { useState } from 'react';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import SummaryHeader from '@/components/feoh/summary-header';
import EnvelopeCard from '@/components/feoh/envelope-card';
import BillsList from '@/components/feoh/bills-list';
import TransactionForm from '@/components/feoh/transaction-form';
import CsvPanel from '@/components/feoh/csv-panel';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useSummary, useEnvelopes, useAccounts, useBills, useRecordTransaction, useDeleteBill } from '@/hooks/use-feoh';
import { ApiError } from '@/api/client';

export default function FeohPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const month = format(new Date(), 'yyyy-MM');
  const summaryQuery = useSummary(month);
  const envQuery = useEnvelopes();
  const acctQuery = useAccounts();
  const billsQuery = useBills();
  const record = useRecordTransaction();
  const deleteBill = useDeleteBill();
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
      toast(msg ?? t('feoh.recordFailed'), 'error');
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

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('feoh.recurringBills')}</CardTitle></CardHeader>
            <CardContent><BillsList bills={bills} onRemove={(id) => deleteBill.mutate(id)} /></CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('feoh.importExport')}</CardTitle></CardHeader>
            <CardContent><CsvPanel /></CardContent>
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
