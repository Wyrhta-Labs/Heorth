import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { useMembers } from '@/hooks/use-household';
import { useM365Status } from '@/hooks/use-m365';
import { triggerM365Sync } from '@/api/m365';
import { useFormatters } from '@/hooks/use-formatters';
import type { Member } from '@/lib/types';

interface Props {
  /** Presentation only — `POST /m365/sync` is admin-gated server-side. */
  readOnly?: boolean;
}

/**
 * Household-wide overview of Microsoft 365 connections and their feed health,
 * plus a manual "sync now" trigger. Who may mount this panel is the caller's
 * decision; `readOnly` hides the sync trigger for a viewer who may not trigger
 * a sync (`POST /m365/sync` is admin-gated server-side). Reads the raw
 * `connections` array from `GET /m365/status` (the M365-specific wire type),
 * joined against the raw member list for display names — the neutral
 * `ProviderConnection` shape used on /profile does not apply here. Members
 * without a connection are deliberately not listed.
 */
export default function ConnectionsPanel({ readOnly = false }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { formatDate, formatTime } = useFormatters();
  const membersQuery = useMembers();
  const statusQuery = useM365Status();
  const [syncing, setSyncing] = useState(false);

  const membersById = new Map<string, Member>((membersQuery.data?.data ?? []).map((m) => [m.id, m]));
  const connections = statusQuery.data?.data.connections ?? [];
  const feeds = statusQuery.data?.data.feeds ?? [];

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await triggerM365Sync();
      const count = res.data.results.length;
      toast(t('settings.connectionsPanel.syncSummary', { count }), 'success');
      qc.invalidateQueries({ queryKey: QUERY_KEYS.m365Status });
    } catch (e) {
      toast((e as Error).message || t('settings.connectionsPanel.syncFailed'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const lastSync = (iso: string | null) => (iso ? `${formatDate(iso)} ${formatTime(iso)}` : t('settings.connectionsPanel.none'));
  const statusLabel = (status: string) => t(`settings.connectionsPanel.status.${status}`, { defaultValue: status });

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex justify-end">
          <Button size="sm" onClick={syncNow} disabled={syncing}>
            <RefreshCw className="h-4 w-4 mr-1" /> {t('settings.connectionsPanel.syncNow')}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{t('settings.connectionsPanel.title')}</CardTitle></CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <p className="text-muted-foreground">{t('settings.connectionsPanel.noConnections')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.connectionsPanel.member')}</TableHead>
                  <TableHead>{t('settings.connectionsPanel.account')}</TableHead>
                  <TableHead>{t('settings.connectionsPanel.statusHeader')}</TableHead>
                  <TableHead>{t('settings.connectionsPanel.lastSync')}</TableHead>
                  <TableHead>{t('settings.connectionsPanel.lastError')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <TableRow key={c.memberId}>
                    <TableCell>{membersById.get(c.memberId)?.displayName ?? c.memberId}</TableCell>
                    <TableCell>{c.accountUpn}</TableCell>
                    <TableCell>{statusLabel(c.status)}</TableCell>
                    <TableCell>{lastSync(c.lastRefreshSuccessAt)}</TableCell>
                    <TableCell>{c.lastRefreshError ?? t('settings.connectionsPanel.none')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{t('settings.connectionsPanel.feedsTitle')}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.connectionsPanel.feed')}</TableHead>
                <TableHead>{t('settings.connectionsPanel.feedStatus')}</TableHead>
                <TableHead>{t('settings.connectionsPanel.lastSync')}</TableHead>
                <TableHead>{t('settings.connectionsPanel.lastError')}</TableHead>
                <TableHead>{t('settings.connectionsPanel.consecutiveFailures')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feeds.map((f) => {
                const failing = f.consecutiveFailures > 0;
                return (
                  <TableRow key={f.feedKey} className={failing ? 'bg-red-50' : undefined}>
                    <TableCell>{f.feedKey}</TableCell>
                    <TableCell>
                      <Badge variant={failing ? 'destructive' : 'success'}>
                        {failing ? t('settings.connectionsPanel.feedFailing') : t('settings.connectionsPanel.feedOk')}
                      </Badge>
                    </TableCell>
                    <TableCell>{lastSync(f.lastSuccessAt)}</TableCell>
                    <TableCell>{f.lastError ?? t('settings.connectionsPanel.none')}</TableCell>
                    <TableCell>{f.consecutiveFailures}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
