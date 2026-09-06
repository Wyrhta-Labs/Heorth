import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useAccounts } from '@/hooks/use-feoh';
import { useImportAccounts, useUpsertAccountMapping, useDeleteAccountMapping } from '@/hooks/use-feoh-import';
import { ApiError } from '@/api/client';

const selectClass = 'h-9 w-full rounded-md border border-tan bg-card px-3 text-sm';

export default function ImportAccounts() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const mappings = useImportAccounts().data?.data ?? [];
  const accounts = useAccounts().data?.data ?? [];
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const upsert = useUpsertAccountMapping();
  const remove = useDeleteAccountMapping();
  const [source, setSource] = useState('');
  const [accountId, setAccountId] = useState('');

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim() || !accountId) return;
    try {
      await upsert.mutateAsync({ sourceAccountId: source.trim(), accountId });
      setSource('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : (err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="font-medium">{t('feoh.import.accounts.title')}</h4>
      <p className="text-sm text-gray-500">{t('feoh.import.accounts.intro')}</p>
      {mappings.length === 0 ? (
        <p className="text-sm text-gray-500">{t('feoh.import.accounts.empty')}</p>
      ) : (
        <ul className="divide-y divide-tan">
          {mappings.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-sm"><span className="font-mono">{m.sourceAccountId}</span> → {accountName.get(m.accountId) ?? m.accountId}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => remove.mutate(m.id, { onError: (e) => toast((e as Error).message, 'error') })}
              >
                {t('feoh.import.accounts.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div className="space-y-1">
          <Label htmlFor="map-source">{t('feoh.import.accounts.source')}</Label>
          <Input id="map-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder={t('feoh.import.accounts.sourcePlaceholder')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="map-account">{t('feoh.import.accounts.account')}</Label>
          <select id="map-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t('feoh.import.inbox.pickAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={!source.trim() || !accountId || upsert.isPending}>{t('feoh.import.accounts.add')}</Button>
      </form>
    </div>
  );
}
