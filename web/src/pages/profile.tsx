import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import ProviderCard from '@/components/profile/provider-card';
import { PROVIDERS } from '@/lib/providers';
import { useWhoami } from '@/hooks/use-household';
import { MAINTENANCE_ADMIN_HANDLE } from '@/lib/constants';

type KnownErrorCode =
  | 'M365_CONSENT_DENIED'
  | 'M365_CALLBACK_INVALID'
  | 'M365_STATE_INVALID'
  | 'M365_EXCHANGE_FAILED'
  | 'ADMIN_NOT_A_MEMBER';

const KNOWN_ERROR_CODES: readonly KnownErrorCode[] = [
  'M365_CONSENT_DENIED',
  'M365_CALLBACK_INVALID',
  'M365_STATE_INVALID',
  'M365_EXCHANGE_FAILED',
  'ADMIN_NOT_A_MEMBER',
];

function isKnownErrorCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const whoamiQuery = useWhoami();
  const isMaintenanceAdmin = whoamiQuery.data?.data.handle === MAINTENANCE_ADMIN_HANDLE;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const connectError = params.get('connectError');

    if (connected) {
      toast(t('connections.connected'), 'success');
    } else if (connectError) {
      toast(
        isKnownErrorCode(connectError)
          ? t(`connections.error.${connectError}`)
          : t('connections.error.unknown'),
        'error',
      );
    }

    if (connected || connectError) {
      params.delete('connected');
      params.delete('connectError');
      const search = params.toString();
      const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
      window.history.replaceState({}, '', url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="font-serif text-xl text-ink">{t('connections.pageTitle')}</h2>
      {isMaintenanceAdmin ? (
        <Card>
          <CardHeader className="flex flex-row items-start gap-3">
            <ShieldAlert className="h-6 w-6 text-gray-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <CardTitle className="text-base">{t('connections.maintenanceAdmin.title')}</CardTitle>
              <CardDescription>{t('connections.maintenanceAdmin.description')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700">{t('connections.maintenanceAdmin.hint')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {PROVIDERS.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      )}
    </div>
  );
}
