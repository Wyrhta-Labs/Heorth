import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useFormatters } from '@/hooks/use-formatters';
import { useEnvelopes, useAccounts } from '@/hooks/use-feoh';
import { useImportInbox, useImportAccounts, useConfirmInboxRow, useDismissInboxRow } from '@/hooks/use-feoh-import';
import type { ImportedTransaction } from '@/lib/types';
import { ApiError } from '@/api/client';

const selectClass = 'h-9 w-full rounded-md border border-tan bg-card px-3 text-sm';

/**
 * The shared `formatMoney` is fixed to the household's display currency; an
 * imported line carries ITS OWN currency (that is the whole point of the
 * foreign-currency rule), so format with the row's code and fall back to a
 * plain decimal + code for codes Intl does not know.
 */
export function formatAmount(amount: string | number, currency: string, localeCode: string): string {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(localeCode, { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

interface Props { householdCurrency: string }

function InboxRow({ row, householdCurrency, mappedAccountId }: { row: ImportedTransaction; householdCurrency: string; mappedAccountId: string | undefined }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate, locale } = useFormatters();
  const localeCode = locale.code ?? 'en-US';
  const envelopes = useEnvelopes().data?.data ?? [];
  const accounts = useAccounts().data?.data ?? [];
  const confirm = useConfirmInboxRow();
  const dismiss = useDismissInboxRow();
  const [envelopeId, setEnvelopeId] = useState('');
  const [accountId, setAccountId] = useState('');

  const foreign = row.currency !== householdCurrency;
  const unmapped = !mappedAccountId;
  const canBook = !foreign && envelopeId !== '' && (!unmapped || accountId !== '');

  const book = async () => {
    try {
      await confirm.mutateAsync({ id: row.id, input: unmapped ? { envelopeId, accountId } : { envelopeId } });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : (e as Error).message, 'error');
    }
  };

  return (
    <li className="rounded-md border border-tan p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{row.payee}</div>
          <div className="text-xs text-gray-500">{formatDate(row.date)}{row.memo ? ` · ${row.memo}` : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{t(`feoh.import.inbox.${row.direction}`)}</Badge>
          <span className="font-mono">{row.direction === 'out' ? '−' : '+'}{formatAmount(row.amount, row.currency, localeCode)}</span>
        </div>
      </div>
      {foreign && (
        <p className="text-sm text-amber-700">{t('feoh.import.inbox.foreignCurrency', { currency: row.currency, household: householdCurrency })}</p>
      )}
      {!foreign && unmapped && (
        <p className="text-sm text-amber-700">{t('feoh.import.inbox.unmapped', { source: row.sourceAccountId })}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div className="space-y-1">
          <Label htmlFor={`env-${row.id}`}>{t('feoh.import.inbox.envelope')}</Label>
          <select id={`env-${row.id}`} className={selectClass} value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)} disabled={foreign}>
            <option value="">{t('feoh.import.inbox.pickEnvelope')}</option>
            {envelopes.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
          </select>
        </div>
        {unmapped && !foreign && (
          <div className="space-y-1">
            <Label htmlFor={`acc-${row.id}`}>{t('feoh.import.inbox.account')}</Label>
            <select id={`acc-${row.id}`} className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{t('feoh.import.inbox.pickAccount')}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={book} disabled={!canBook || confirm.isPending}>{t('feoh.import.inbox.book')}</Button>
          <Button size="sm" variant="outline" onClick={() => dismiss.mutateAsync(row.id)} disabled={dismiss.isPending}>{t('feoh.import.inbox.dismiss')}</Button>
        </div>
      </div>
    </li>
  );
}

export default function ImportInbox({ householdCurrency }: Props) {
  const { t } = useTranslation();
  const inbox = useImportInbox({ status: 'pending', limit: 50 });
  const mappings = useImportAccounts().data?.data ?? [];
  const accountFor = new Map(mappings.map((m) => [m.sourceAccountId, m.accountId]));
  const rows = inbox.data?.data ?? [];

  return (
    <div className="space-y-3">
      <h4 className="font-medium">{t('feoh.import.inbox.title')}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('feoh.import.inbox.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <InboxRow key={row.id} row={row} householdCurrency={householdCurrency} mappedAccountId={accountFor.get(row.sourceAccountId)} />
          ))}
        </ul>
      )}
    </div>
  );
}
