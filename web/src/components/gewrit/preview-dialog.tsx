import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { fetchPreview } from '@/api/gewrit';
import { useDeleteLink, useUpdateLink } from '@/hooks/use-gewrit';
import { LINK_ROLES, previewKind, type PreviewKind } from '@/lib/gewrit';
import type { GewritLink, GewritLinkRole } from '@/lib/types';
import { useGewritError } from './use-gewrit-error';

interface Props {
  link: GewritLink | null;
  onClose: () => void;
}

type PreviewState = { status: 'idle' } | { status: 'loading' } | { status: 'failed' } | { status: 'ready'; url: string; kind: PreviewKind };

export default function PreviewDialog({ link, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const describe = useGewritError();
  const update = useUpdateLink();
  const remove = useDeleteLink();
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [role, setRole] = useState<GewritLinkRole>('manual');
  const [note, setNote] = useState('');

  const documentId = link?.document.id;
  const missing = link?.document.status === 'missing';

  useEffect(() => {
    setRole(link?.role ?? 'manual');
    setNote(link?.note ?? '');
  }, [link?.id, link?.role, link?.note]);

  useEffect(() => {
    if (!documentId || missing) {
      setPreview({ status: 'idle' });
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    // Closing the dialog aborts the download — in the browser and, through
    // Heorth, at Paperless.
    const abort = new AbortController();
    setPreview({ status: 'loading' });
    fetchPreview(documentId, abort.signal)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview({ status: 'ready', url, kind: previewKind(blob.type) });
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: 'failed' });
      });
    return () => {
      cancelled = true;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId, missing]);

  if (!link) return null;

  const save = async () => {
    try {
      await update.mutateAsync({ id: link.id, input: { role, note: note.trim() || null } });
      onClose();
    } catch (e) {
      toast(describe(e), 'error');
    }
  };

  const unlink = async () => {
    if (!confirm(t('gewrit.preview.removeConfirm', { title: link.document.title }))) return;
    try {
      await remove.mutateAsync(link.id);
      onClose();
    } catch (e) {
      toast(describe(e), 'error');
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{link.document.title}</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {missing && <p className="text-muted-foreground">{t('gewrit.missing')}</p>}
          {preview.status === 'loading' && <p className="text-muted-foreground">{t('gewrit.preview.loading')}</p>}
          {preview.status === 'failed' && <p className="text-red-700">{t('gewrit.preview.failed')}</p>}
          {preview.status === 'ready' && preview.kind === 'pdf' && (
            // No sandbox attribute: Chrome's and Firefox's built-in PDF viewers
            // refuse to render in a sandboxed frame, and a PDF is not HTML in
            // Heorth's origin. The type allowlist is the protection.
            <iframe title={link.document.title} src={preview.url} className="h-[60vh] w-full rounded border" />
          )}
          {preview.status === 'ready' && preview.kind === 'image' && (
            <img alt={link.document.title} src={preview.url} className="mx-auto max-h-[60vh]" />
          )}
          {preview.status === 'ready' && preview.kind === 'download' && (
            <p>
              {t('gewrit.preview.download')}{' '}
              <a href={preview.url} download={link.document.title} className="text-ember underline">{t('gewrit.preview.downloadAction')}</a>
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <select
              aria-label={t('gewrit.dialog.role')}
              value={role}
              onChange={(e) => setRole(e.target.value as GewritLinkRole)}
              className="h-9 rounded-md border border-tan bg-card px-2 text-sm"
            >
              {LINK_ROLES.map((r) => <option key={r} value={r}>{t(`gewrit.roles.${r}`)}</option>)}
            </select>
            <Input aria-label={t('gewrit.dialog.note')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="flex-1" />
            <Button type="button" size="sm" onClick={() => void save()} disabled={update.isPending}>{t('gewrit.preview.save')}</Button>
          </div>
          <div className="flex justify-between">
            {link.document.externalUrl
              ? <a href={link.document.externalUrl} target="_blank" rel="noopener noreferrer" className="text-ember underline">{t('gewrit.preview.open')}</a>
              : <span />}
            <Button type="button" variant="destructive" size="sm" onClick={() => void unlink()} disabled={remove.isPending}>
              {t('gewrit.preview.remove')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
