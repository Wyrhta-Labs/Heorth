import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import type { LibraryItem } from '@/lib/types';

export default function ItemDetail({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
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
              <p className="text-muted-foreground">{item.mediaType} · {item.status ?? '—'}{item.lists.length ? ` · ${item.lists.join(', ')}` : ''}</p>
              {item.rating && <p>Rating: {item.rating}</p>}
              {item.tags.length > 0 && <p className="text-muted-foreground">{item.tags.join(', ')}</p>}
              {item.sourceUrl && <a className="underline" href={item.sourceUrl} target="_blank" rel="noreferrer">View on source</a>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
