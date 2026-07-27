import { useRef } from 'react';
import { RefreshCw, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useSyncConnection, useDeleteConnection, useImportFile } from '@/hooks/use-library';
import type { LibraryConnection } from '@/lib/types';

const STATUS_KEYS: Record<LibraryConnection['status'], 'active' | 'needsReauth' | 'error'> = {
  active: 'active',
  needs_reauth: 'needsReauth',
  error: 'error',
};

export default function ConnectionsPanel({ connections }: { connections: LibraryConnection[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const sync = useSyncConnection();
  const remove = useDeleteConnection();
  const importFile = useImportFile();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const onSync = async (id: string) => {
    try { await sync.mutateAsync(id); toast(t('library.connections.synced'), 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  const onFile = async (id: string, file: File) => {
    const text = await file.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { toast(t('library.connections.invalidJson'), 'error'); return; }
    try {
      await importFile.mutateAsync({ id, json });
      toast(t('library.connections.imported'), 'success');
    } catch (e) {
      toast((e as Error).message || t('library.connections.importFailed'), 'error');
    }
  };

  if (connections.length === 0) return <p className="text-muted-foreground">{t('library.connections.noneYet')}</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {connections.map((c) => (
        <Card key={c.id}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{c.label}</CardTitle>
            <span className={`text-xs rounded px-2 py-0.5 ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{t(`library.connectionStatus.${STATUS_KEYS[c.status]}`)}</span>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t('library.connections.summary', {
                count: c.itemCount,
                lastSync: c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString() : t('library.connections.neverSynced'),
              })}
            </p>
            {c.lastSyncError && <p className="text-sm text-red-600">{c.lastSyncError}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => onSync(c.id)} disabled={sync.isPending}>
                <RefreshCw className="h-4 w-4 mr-1" /> {t('library.connections.syncNow')}
              </Button>
              {c.provider === 'librarything' && (
                <>
                  <input type="file" accept=".json,application/json" hidden
                    ref={(el) => { fileRefs.current[c.id] = el; }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(c.id, f); e.target.value = ''; }} />
                  <Button size="sm" variant="secondary" onClick={() => fileRefs.current[c.id]?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> {t('library.connections.uploadExport')}
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
