import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Account, Envelope } from '@/lib/types';
import type { TransactionInput } from '@/api/feoh';
import { format } from 'date-fns';

interface Props {
  accounts: Account[];
  envelopes: Envelope[];
  onSubmit: (input: TransactionInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

/** A spend: debit the envelope, credit the account — always balanced. */
export default function TransactionForm({ accounts, envelopes, onSubmit, onCancel, isLoading }: Props) {
  const { t } = useTranslation();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [payee, setPayee] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [envelopeId, setEnvelopeId] = useState(envelopes[0]?.id ?? '');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError(t('feoh.form.amountError')); return; }
    if (!envelopeId || !accountId) { setError(t('feoh.form.pickError')); return; }
    setError('');
    await onSubmit({
      date, payee, memo: memo || null, amount: amt,
      postings: [
        { envelopeId, accountId: null, debit: amt, credit: 0 },
        { accountId, envelopeId: null, debit: 0, credit: amt },
      ],
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="date">{t('feoh.form.date')}</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="amount">{t('feoh.form.amount')}</Label>
          <Input id="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('feoh.form.amountPlaceholder')} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="payee">{t('feoh.form.payee')}</Label>
        <Input id="payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={t('feoh.form.payeePlaceholder')} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="envelope">{t('feoh.form.envelope')}</Label>
          <select id="envelope" value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)}
            className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm">
            {envelopes.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="account">{t('feoh.form.paidFrom')}</Label>
          <select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="memo">{t('feoh.form.memo')}</Label>
        <Input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t('feoh.form.memoPlaceholder')} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('feoh.form.cancel')}</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? t('feoh.form.saving') : t('feoh.form.record')}</Button>
      </div>
    </form>
  );
}
