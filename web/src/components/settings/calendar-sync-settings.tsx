import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { PROVIDERS } from '@/lib/providers';
import {
  useAvailableCalendars, useSetCalendarAllowlist, useSetHouseholdCalendar,
} from '@/hooks/use-calendar-allowlist';
import type { AvailableCalendar } from '@/lib/types';

interface CalendarSyncSettingsProps {
  /** Whether the acting member may designate the household calendar (admin/adult). */
  canDesignate: boolean;
}

function providerName(provider: string): string {
  return PROVIDERS.find((p) => p.id === provider)?.nameKey ?? provider;
}

export function CalendarSyncSettings({ canDesignate }: CalendarSyncSettingsProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const calendarsQuery = useAvailableCalendars(true);
  const setAllowlist = useSetCalendarAllowlist();
  const setHouseholdCalendar = useSetHouseholdCalendar();

  const calendars = calendarsQuery.data?.data ?? [];

  const byProvider = calendars.reduce<Record<string, AvailableCalendar[]>>((acc, c) => {
    (acc[c.provider] ??= []).push(c);
    return acc;
  }, {});

  const toggle = async (provider: string, calendarId: string, enabled: boolean) => {
    const next = calendars
      .filter((c) => (c.provider === provider && c.id === calendarId ? enabled : c.enabled))
      .map((c) => ({ provider: c.provider, calendarId: c.id }));
    try {
      await setAllowlist.mutateAsync(next);
      toast(t('calendarSync.updated'), 'success');
    } catch (e) {
      toast((e as Error).message || t('calendarSync.couldNotUpdate'), 'error');
    }
  };

  const designate = async (provider: string, calendarId: string) => {
    try {
      await setHouseholdCalendar.mutateAsync({ provider, calendarId });
      toast(t('calendarSync.householdUpdated'), 'success');
    } catch (e) {
      toast((e as Error).message || t('calendarSync.couldNotUpdateHousehold'), 'error');
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{t('calendarSync.title')}</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => calendarsQuery.refetch()} disabled={calendarsQuery.isFetching}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {calendarsQuery.isError && (
          <p className="text-sm text-red-600">{t('calendarSync.loadError')}</p>
        )}
        {!calendarsQuery.isError && calendars.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('calendarSync.noneFound')}</p>
        )}
        {Object.entries(byProvider).map(([provider, providerCalendars]) => (
          <div key={provider} className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">{t(providerName(provider), { defaultValue: provider })}</h3>
            {providerCalendars.map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-sm">
                <label className="flex flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 accent-ember"
                    checked={c.enabled}
                    aria-label={c.name}
                    onChange={(e) => void toggle(c.provider, c.id, e.target.checked)}
                  />
                  {c.name}
                </label>
                {canDesignate && c.enabled && (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name={`household-calendar-${provider}`}
                      className="h-4 w-4 accent-ember"
                      checked={c.isHousehold}
                      onChange={() => void designate(c.provider, c.id)}
                    />
                    {t('calendarSync.householdLabel')}
                  </label>
                )}
              </div>
            ))}
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          {t('calendarSync.hint')}
        </p>
      </CardContent>
    </Card>
  );
}
