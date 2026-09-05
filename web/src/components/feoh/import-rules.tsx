import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useEnvelopes } from '@/hooks/use-feoh';
import { useImportRules, useCreateRule, useUpdateRule, useDeleteRule } from '@/hooks/use-feoh-import';

const selectClass = 'h-9 w-full rounded-md border border-tan bg-card px-3 text-sm';

export default function ImportRules() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const rules = useImportRules().data?.data ?? [];
  const envelopes = useEnvelopes().data?.data ?? [];
  const envelopeName = new Map(envelopes.map((e) => [e.id, e.name]));
  const create = useCreateRule();
  const update = useUpdateRule();
  const remove = useDeleteRule();
  const [pattern, setPattern] = useState('');
  const [envelopeId, setEnvelopeId] = useState('');
  const [priority, setPriority] = useState('0');

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim() || !envelopeId) return;
    try {
      await create.mutateAsync({ pattern: pattern.trim(), envelopeId, priority: Number(priority) || 0 });
      setPattern(''); setPriority('0');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="font-medium">{t('feoh.import.rules.title')}</h4>
      <p className="text-sm text-gray-500">{t('feoh.import.rules.intro')}</p>
      {rules.length === 0 ? (
        <p className="text-sm text-gray-500">{t('feoh.import.rules.empty')}</p>
      ) : (
        <ul className="divide-y divide-tan">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-sm">{r.pattern}</span>
                <span className="text-sm">→ {envelopeName.get(r.envelopeId) ?? r.envelopeId}</span>
                <span className="text-xs text-gray-500">{t('feoh.import.rules.priority')} {r.priority}</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => update.mutate({ id: r.id, input: { enabled: !r.enabled } })}>
                  {r.enabled ? t('feoh.import.rules.enabled') : t('feoh.import.rules.disabled')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => remove.mutate(r.id)}>{t('feoh.import.rules.remove')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div className="space-y-1">
          <Label htmlFor="rule-pattern">{t('feoh.import.rules.pattern')}</Label>
          <Input id="rule-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t('feoh.import.rules.patternPlaceholder')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rule-envelope">{t('feoh.import.rules.envelope')}</Label>
          <select id="rule-envelope" className={selectClass} value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)}>
            <option value="">{t('feoh.import.inbox.pickEnvelope')}</option>
            {envelopes.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rule-priority">{t('feoh.import.rules.priority')}</Label>
          <Input id="rule-priority" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={!pattern.trim() || !envelopeId || create.isPending}>{t('feoh.import.rules.add')}</Button>
      </form>
    </div>
  );
}
