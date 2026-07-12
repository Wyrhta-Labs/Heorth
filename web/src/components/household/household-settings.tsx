import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useHousehold, useUpdateHousehold } from '@/hooks/use-household';

export default function HouseholdSettings({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { data } = useHousehold();
  const update = useUpdateHousehold();
  const h = data?.data;
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [locale, setLocale] = useState('');

  // Initialize local fields from the loaded household once.
  if (h && name === '' && timezone === '' && locale === '') {
    setName(h.name); setTimezone(h.timezone); setLocale(h.locale);
  }

  const save = async () => {
    await update.mutateAsync({ name, timezone, locale });
    toast('Household updated', 'success');
  };

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-1"><Label htmlFor="hhname">Name</Label>
        <Input id="hhname" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} /></div>
      <div className="space-y-1"><Label htmlFor="tz">Timezone</Label>
        <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canManage} placeholder="Europe/London" /></div>
      <div className="space-y-1"><Label htmlFor="locale">Locale</Label>
        <Input id="locale" value={locale} onChange={(e) => setLocale(e.target.value)} disabled={!canManage} placeholder="en-GB" /></div>
      {canManage && <Button onClick={save} disabled={update.isPending}>Save</Button>}
    </div>
  );
}
