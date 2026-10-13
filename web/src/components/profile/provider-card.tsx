import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/api/client';
import { QUERY_KEYS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useFormatters } from '@/hooks/use-formatters';
import type { ConnectionProvider } from '@/lib/providers';

interface ProviderCardProps {
  provider: ConnectionProvider;
}

const STATUS_DOT: Record<string, string> = {
  unavailable: 'bg-line-strong',
  disconnected: 'bg-faint',
  connected: 'bg-success',
  needs_reauth: 'bg-warning',
};

export default function ProviderCard({ provider }: ProviderCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { formatDate, formatTime } = useFormatters();
  const { state, connection, isLoading } = provider.api.useStatus();

  const Icon = provider.icon;

  const goToConsent = async () => {
    try {
      const url = await provider.api.getConnectUrl();
      window.location.href = url;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ADMIN_NOT_A_MEMBER') {
        toast(t('connections.error.ADMIN_NOT_A_MEMBER'), 'error');
      } else {
        toast(t('connections.connectFailed'), 'error');
      }
    }
  };

  const handleDisconnect = async () => {
    try {
      await provider.api.disconnect();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.integrationsStatus });
      toast(t('connections.disconnected'), 'success');
    } catch {
      toast(t('connections.disconnectFailed'), 'error');
    }
  };

  const isNeedsReauth = state === 'needs_reauth';

  return (
    <Card className={cn(isNeedsReauth && 'border-warning-border bg-warning-bg', state === 'unavailable' && 'opacity-60')}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="flex items-start gap-3">
          <Icon className="h-6 w-6 text-muted shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {t(provider.nameKey, { defaultValue: provider.nameKey })}
              <span
                className={cn('inline-block h-2 w-2 rounded-full', STATUS_DOT[state])}
                aria-hidden="true"
              />
            </CardTitle>
            <CardDescription>{t(provider.descriptionKey, { defaultValue: provider.descriptionKey })}</CardDescription>
          </div>
        </div>
        <Badge variant={isNeedsReauth ? 'warning' : state === 'connected' ? 'success' : 'outline'}>
          {t(`connections.state.${state}`)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {provider.capabilities.map((cap) => (
            <Badge key={cap} variant="secondary">{t(`connections.capability.${cap}`)}</Badge>
          ))}
        </div>

        {state === 'unavailable' && (
          <p className="text-sm text-muted">{t('connections.unavailableHint')}</p>
        )}

        {state === 'connected' && connection && (
          <div className="space-y-0.5">
            <p className="text-sm text-fg">{connection.accountLabel}</p>
            {connection.lastSuccessAt && (
              <p className="text-xs text-muted">
                {t('connections.lastRefreshed', {
                  date: formatDate(connection.lastSuccessAt),
                  time: formatTime(connection.lastSuccessAt),
                })}
              </p>
            )}
          </div>
        )}

        {isNeedsReauth && (
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{connection?.lastError}</span>
          </div>
        )}

        <div className="flex justify-end">
          {state === 'disconnected' && (
            <Button onClick={goToConsent} disabled={isLoading}>{t('connections.connect')}</Button>
          )}
          {state === 'connected' && (
            <Button variant="outline" onClick={handleDisconnect} disabled={isLoading}>
              {t('connections.disconnect')}
            </Button>
          )}
          {isNeedsReauth && (
            <Button onClick={goToConsent} disabled={isLoading}>{t('connections.reconnect')}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
