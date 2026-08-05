import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ApiKeysPanel from '@/components/household/api-keys-panel';
import HouseholdSettings from '@/components/household/household-settings';
import ConnectionsPanel from '@/components/household/connections-panel';
import MembersPanel from '@/components/household/members-panel';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useWhoami } from '@/hooks/use-household';

export default function HouseholdPage() {
  const { t } = useTranslation();
  const whoamiQuery = useWhoami();
  const canManage = whoamiQuery.data?.data.role === 'admin';
  const retry = retryOf(whoamiQuery);

  if (retry) return <ErrorState message={t('settings.loadError')} onRetry={retry} />;

  return (
    <Tabs defaultValue="members" className="space-y-4">
      <TabsList>
        <TabsTrigger value="members">{t('settings.tabs.members')}</TabsTrigger>
        {canManage && <TabsTrigger value="keys">{t('settings.tabs.apiKeys')}</TabsTrigger>}
        {canManage && <TabsTrigger value="settings">{t('settings.tabs.settings')}</TabsTrigger>}
        {canManage && <TabsTrigger value="connections">{t('settings.tabs.connections')}</TabsTrigger>}
      </TabsList>

      <TabsContent value="members">
        <MembersPanel readOnly={!canManage} />
      </TabsContent>

      {canManage && (
        <TabsContent value="keys">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('settings.tabs.apiKeys')}</CardTitle></CardHeader>
            <CardContent><ApiKeysPanel /></CardContent>
          </Card>
        </TabsContent>
      )}

      {canManage && (
        <TabsContent value="settings">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('nav.household')}</CardTitle></CardHeader>
            <CardContent><HouseholdSettings /></CardContent>
          </Card>
        </TabsContent>
      )}

      {canManage && (
        <TabsContent value="connections">
          <ConnectionsPanel />
        </TabsContent>
      )}
    </Tabs>
  );
}
