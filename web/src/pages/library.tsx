import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useConnections, useLibraryItems } from '@/hooks/use-library';
import ConnectionsPanel from '@/components/library/connections-panel';
import ConnectDialog from '@/components/library/connect-dialog';
import Shelf from '@/components/library/shelf';
import ItemDetail from '@/components/library/item-detail';
import type { LibraryItem, LibraryMediaType, LibraryItemStatus, LibraryList } from '@/lib/types';

const TYPES: LibraryMediaType[] = ['book', 'ebook', 'movie', 'series'];
const STATUSES: LibraryItemStatus[] = ['unread', 'reading', 'read', 'watching', 'watched'];
const LISTS: LibraryList[] = ['later', 'favorites'];

export default function LibraryPage() {
  const { t } = useTranslation();
  const [connectOpen, setConnectOpen] = useState(false);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [mediaType, setMediaType] = useState('');
  const [status, setStatus] = useState('');
  const [list, setList] = useState('');
  const [q, setQ] = useState('');

  const connectionsQuery = useConnections();
  const itemsQuery = useLibraryItems({
    mediaType: mediaType || undefined, status: status || undefined, list: list || undefined,
    tag: undefined, limit: 200,
  });
  const retry = retryOf(connectionsQuery, itemsQuery);

  if (retry) return <ErrorState message={t('library.loadError')} onRetry={retry} />;

  const connections = connectionsQuery.data?.data ?? [];
  const allItems = itemsQuery.data?.data ?? [];
  const items = q ? allItems.filter((i) =>
    i.title.toLowerCase().includes(q.toLowerCase()) ||
    i.creators.some((cr) => cr.toLowerCase().includes(q.toLowerCase()))) : allItems;

  function dropdown<T extends LibraryMediaType | LibraryItemStatus | LibraryList>(
    value: string,
    set: (v: string) => void,
    opts: readonly T[],
    allLabel: string,
    labelOf: (o: T) => string,
  ) {
    return (
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
      >
        <option value="">{allLabel}</option>
        {opts.map((o) => <option key={o} value={o}>{labelOf(o)}</option>)}
      </select>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('library.pageTitle')}</h1>
        <Button onClick={() => setConnectOpen(true)}><Plus className="h-4 w-4 mr-1" /> {t('library.connect')}</Button>
      </div>

      <ConnectionsPanel connections={connections} />

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder={t('library.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        {dropdown(mediaType, setMediaType, TYPES, t('library.filters.allTypes'), (o) => t(`library.mediaType.${o}`))}
        {dropdown(status, setStatus, STATUSES, t('library.filters.allStatuses'), (o) => t(`library.status.${o}`))}
        {dropdown(list, setList, LISTS, t('library.filters.allLists'), (o) => t(`library.list.${o}`))}
      </div>

      <Shelf items={items} onOpen={setSelected} />

      <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      <ItemDetail item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
