import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import type { LibraryItem } from '@/lib/types';

export default function ItemDetail({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{item.title}</DialogTitle>
              <DialogClose onClose={onClose} />
            </DialogHeader>
            <div className="space-y-1 text-sm">
              <p>{item.creators.join(', ')}{item.year ? ` · ${item.year}` : ''}</p>
              <p className="text-muted-foreground">
                {t(`library.mediaType.${item.mediaType}`)} · {item.status ? t(`library.status.${item.status}`) : '—'}
                {item.lists.length ? ` · ${item.lists.map((l) => t(`library.list.${l}`)).join(', ')}` : ''}
              </p>
              {item.rating && <p>{t('library.item.rating', { rating: item.rating })}</p>}
              {item.tags.length > 0 && <p className="text-muted-foreground">{item.tags.join(', ')}</p>}
              {item.sourceUrl && <a className="underline" href={item.sourceUrl} target="_blank" rel="noreferrer">{t('library.item.viewSource')}</a>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
