import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useCreateLink, useDocumentSearch } from '@/hooks/use-gewrit';
import { LINK_ROLES, parsePaperlessRef } from '@/lib/gewrit';
import type { GewritElement, GewritLinkRole, GewritSearchHit } from '@/lib/types';
import { useGewritError } from './use-gewrit-error';

interface Props {
  element: GewritElement;
  open: boolean;
  onClose: () => void;
}

export default function LinkDocumentDialog({ element, open, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const describe = useGewritError();
  const create = useCreateLink();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<GewritSearchHit | null>(null);
  const [paste, setPaste] = useState('');
  const [role, setRole] = useState<GewritLinkRole>('manual');
  const [note, setNote] = useState('');
  const search = useDocumentSearch(debounced);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  // A closed dialog starts empty next time.
  useEffect(() => {
    if (open) return;
    setQuery(''); setDebounced(''); setSelected(null); setPaste(''); setRole('manual'); setNote('');
  }, [open]);

  // A pasted reference wins over a picked hit: it is the more deliberate input.
  const pasted = paste.trim();
  const pastedId = pasted ? parsePaperlessRef(pasted) : null;
  const pasteInvalid = pasted !== '' && pastedId === null;
  const externalId = pasted ? pastedId : selected?.externalId ?? null;
  const hits = search.data?.data ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!externalId) return;
    try {
      await create.mutateAsync({ externalId, role, note: note.trim() || null, ...element });
      onClose();
    } catch (err) {
      toast(describe(err), 'error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('gewrit.dialog.title')}</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label htmlFor="gewrit-search">{t('gewrit.dialog.search')}</Label>
            <Input id="gewrit-search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            {query.trim().length > 0 && query.trim().length < 2 && (
              <p className="text-xs text-muted-foreground">{t('gewrit.dialog.searchHint')}</p>
            )}
            {search.isError && <p className="text-xs text-red-700">{describe(search.error)}</p>}
            {search.isSuccess && hits.length === 0 && <p className="text-xs text-muted-foreground">{t('gewrit.dialog.noHits')}</p>}
            {hits.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded border divide-y">
                {hits.map((h) => (
                  <li key={h.externalId}>
                    <button
                      type="button"
                      onClick={() => setSelected(h)}
                      aria-pressed={selected?.externalId === h.externalId}
                      className="w-full px-2 py-1 text-left hover:bg-muted aria-pressed:bg-muted"
                    >
                      <span className="font-medium">{h.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[h.documentType, h.correspondent, h.createdOn].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && !pasted && <p className="text-xs">{t('gewrit.dialog.selected', { title: selected.title })}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="gewrit-paste">{t('gewrit.dialog.paste')}</Label>
            <Input id="gewrit-paste" value={paste} onChange={(e) => setPaste(e.target.value)} autoComplete="off" />
            {pasteInvalid && <p className="text-xs text-red-700">{t('gewrit.dialog.pasteInvalid')}</p>}
          </div>
          <div className="flex gap-2">
            <div className="space-y-1">
              <Label htmlFor="gewrit-role">{t('gewrit.dialog.role')}</Label>
              <select
                id="gewrit-role"
                value={role}
                onChange={(e) => setRole(e.target.value as GewritLinkRole)}
                className="h-9 rounded-md border border-tan bg-card px-2 text-sm"
              >
                {LINK_ROLES.map((r) => <option key={r} value={r}>{t(`gewrit.roles.${r}`)}</option>)}
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="gewrit-note">{t('gewrit.dialog.note')}</Label>
              <Input id="gewrit-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!externalId || create.isPending}>{t('gewrit.dialog.submit')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
