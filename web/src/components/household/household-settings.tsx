import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useHousehold, useHouseholdOptions, useUpdateHousehold } from '@/hooks/use-household';

const SELECT_CLASS = 'h-9 w-full rounded-md border border-tan bg-card px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50';

/** Group `Europe/Berlin` under an `Europe` optgroup; zones without a region (`UTC`) come first. */
function groupZones(zones: string[]): { region: string; zones: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const region = zone.includes('/') ? zone.slice(0, zone.indexOf('/')) : '';
    const bucket = groups.get(region);
    if (bucket) bucket.push(zone);
    else groups.set(region, [zone]);
  }
  return [...groups].map(([region, list]) => ({ region, zones: list }));
}

export default function HouseholdSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data } = useHousehold();
  const { data: optionsData } = useHouseholdOptions();
  const update = useUpdateHousehold();
  const h = data?.data;
  const options = optionsData?.data;
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [locale, setLocale] = useState('');

  // Resync local fields whenever the underlying household query data changes
  // (initial load, refetch after another admin's edit, etc). `Household` has
  // no updatedAt/version field, so the query object identity (which changes
  // on every successful fetch) is the most correct signal available.
  useEffect(() => {
    if (h) {
      setName(h.name);
      setTimezone(h.timezone);
      setLocale(h.locale);
    }
  }, [h]);

  // The stored value always stays selectable, even before the option lists have
  // loaded or when it predates validation (rows seeded while these were free
  // text). Without this the <select> would silently show — and then save — a
  // different zone than the household actually has.
  const zoneGroups = useMemo(() => {
    const zones = options?.timezones ?? [];
    return groupZones(timezone && !zones.includes(timezone) ? [timezone, ...zones] : zones);
  }, [options, timezone]);

  const localeOptions = useMemo(() => {
    const locales = options?.locales ?? [];
    return locale && !locales.some((l) => l.value === locale)
      ? [{ value: locale, label: locale }, ...locales]
      : locales;
  }, [options, locale]);

  const save = async () => {
    try {
      await update.mutateAsync({ name, timezone, locale });
      toast(t('settings.household.updated'), 'success');
    } catch (e) {
      // A rejected timezone/locale (an unvalidated legacy value left in place,
      // say) must not look like a successful save.
      toast((e instanceof Error && e.message) || t('settings.household.updateFailed'), 'error');
    }
  };

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-1"><Label htmlFor="hhname">{t('settings.household.name')}</Label>
        <Input id="hhname" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="tz">{t('settings.household.timezone')}</Label>
        <select id="tz" className={SELECT_CLASS} value={timezone}
          onChange={(e) => setTimezone(e.target.value)}>
          {zoneGroups.map((g) => (g.region
            ? <optgroup key={g.region} label={g.region}>{g.zones.map((z) => <option key={z} value={z}>{z}</option>)}</optgroup>
            : g.zones.map((z) => <option key={z} value={z}>{z}</option>)
          ))}
        </select></div>
      <div className="space-y-1"><Label htmlFor="locale">{t('settings.household.locale')}</Label>
        <select id="locale" className={SELECT_CLASS} value={locale}
          onChange={(e) => setLocale(e.target.value)}>
          {localeOptions.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select></div>
      <Button onClick={save} disabled={update.isPending}>{t('common.save')}</Button>
    </div>
  );
}
