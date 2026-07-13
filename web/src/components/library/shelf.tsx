import { Card, CardContent } from '@/components/ui/card';
import type { LibraryItem } from '@/lib/types';

export default function Shelf({ items, onOpen }: { items: LibraryItem[]; onOpen: (item: LibraryItem) => void }) {
  if (items.length === 0) return <p className="text-muted-foreground py-8 text-center">Nothing here yet. Connect an account and sync.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {items.map((item) => (
        <Card key={item.id} className="cursor-pointer" onClick={() => onOpen(item)}>
          <CardContent className="p-2">
            <div className="aspect-[2/3] bg-muted rounded flex items-center justify-center overflow-hidden">
              {item.coverUrl
                ? <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" />
                : <span className="text-xs text-muted-foreground text-center px-1">{item.title}</span>}
            </div>
            <p className="mt-1 text-sm font-medium truncate">{item.title}</p>
            <p className="text-xs text-muted-foreground truncate">{item.creators.join(', ')}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
