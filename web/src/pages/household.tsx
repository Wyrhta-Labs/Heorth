import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useWhoami } from '@/hooks/use-household';
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS } from '@/lib/settings-tabs';

/**
 * Layout for /household: the role-filtered tab strip plus the active tab's
 * route. The tab list comes from SETTINGS_TABS, so a contributed tab needs no
 * edit here (see `settings-tabs.ts`).
 */
export default function HouseholdPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab } = useParams({ strict: false });
  const whoamiQuery = useWhoami();
  const member = whoamiQuery.data?.data;
  const retry = retryOf(whoamiQuery);

  if (retry) return <ErrorState message={t('settings.loadError')} onRetry={retry} />;
  if (!member) return <div className="text-sm text-ash">{t('common.loading')}</div>;

  const visible = SETTINGS_TABS.filter((entry) => entry.access(member).visible);

  return (
    <Tabs
      value={typeof tab === 'string' ? tab : DEFAULT_SETTINGS_TAB}
      onValueChange={(next) => navigate({ to: '/household/$tab', params: { tab: next } })}
      className="space-y-4"
    >
      <TabsList>
        {visible.map((entry) => (
          <TabsTrigger key={entry.id} value={entry.id}>{t(entry.labelKey)}</TabsTrigger>
        ))}
      </TabsList>
      <div className="mt-2"><Outlet /></div>
    </Tabs>
  );
}
