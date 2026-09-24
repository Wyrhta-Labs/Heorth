import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFeatures } from '@/hooks/use-features';
import { useFormatters } from '@/hooks/use-formatters';
import { useElementDocuments } from '@/hooks/use-gewrit';
import { LINK_ROLES } from '@/lib/gewrit';
import { cn } from '@/lib/utils';
import type { GewritElement, GewritLink } from '@/lib/types';
import LinkDocumentDialog from './link-document-dialog';
import PreviewDialog from './preview-dialog';

/** Gewrit's panel on an asset or place (ADR 0017). Renders nothing unless the
 *  deployment has Gewrit on. Write actions are not hidden by role — the server
 *  answers 403 and the member reads why (Ethel's convention). */
export default function DocumentsPanel({ element }: { element: GewritElement }) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const features = useFeatures();
  const enabled = features.data?.data.gewrit === true;
  const list = useElementDocuments(element, enabled);
  const [linkOpen, setLinkOpen] = useState(false);
  const [previewing, setPreviewing] = useState<GewritLink | null>(null);

  if (!enabled) return null;

  const links = list.data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{t('gewrit.title')}</CardTitle>
        <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(true)}>{t('gewrit.link')}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.data?.meta.stale && <p role="status" className="text-xs text-amber-700">{t('gewrit.stale')}</p>}
        {list.isSuccess && links.length === 0 && <p className="text-muted-foreground">{t('gewrit.empty')}</p>}
        {LINK_ROLES.map((role) => {
          const group = links.filter((l) => l.role === role);
          if (group.length === 0) return null;
          return (
            <div key={role} className="space-y-1">
              <p className="text-xs font-medium uppercase text-muted-foreground">{t(`gewrit.roles.${role}`)}</p>
              <ul className="space-y-1">
                {group.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setPreviewing(l)}
                      className={cn('w-full text-left', l.document.status === 'missing' && 'opacity-50')}
                    >
                      <span className="font-medium">{l.document.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {l.document.status === 'missing'
                          ? t('gewrit.missing')
                          : [l.document.documentType, l.document.correspondent, l.document.createdOn && formatDate(l.document.createdOn)].filter(Boolean).join(' · ')}
                      </span>
                      {l.note && <span className="block text-xs">{l.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardContent>
      <LinkDocumentDialog element={element} open={linkOpen} onClose={() => setLinkOpen(false)} />
      <PreviewDialog link={previewing} onClose={() => setPreviewing(null)} />
    </Card>
  );
}
