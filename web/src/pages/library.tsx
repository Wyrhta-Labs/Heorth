import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useConnections, useLibraryItems } from '@/hooks/use-library';
import ConnectionsPanel from '@/components/library/connections-panel';
import ConnectDialog from '@/components/library/connect-dialog';
import Shelf from '@/components/library/shelf';
import ItemDetail from '@/components/library/item-detail';
import type { LibraryItem } from '@/lib/types';

const TYPES = ['book', 'ebook', 'movie', 'series'];
const STATUSES = ['unread', 'reading', 'read', 'watching', 'watched'];
const LISTS = ['later', 'favorites'];

export default function LibraryPage() {
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

  if (retry) return <ErrorState message="We couldn’t load your library." onRetry={retry} />;

  const connections = connectionsQuery.data?.data ?? [];
  const allItems = itemsQuery.data?.data ?? [];
  const items = q ? allItems.filter((i) =>
    i.title.toLowerCase().includes(q.toLowerCase()) ||
    i.creators.some((cr) => cr.toLowerCase().includes(q.toLowerCase()))) : allItems;

  const dropdown = (value: string, set: (v: string) => void, opts: string[], label: string) => (
    <select
      value={value}
      onChange={(e) => set(e.target.value)}
      className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
    >
      <option value="">All {label}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Library</h1>
        <Button onClick={() => setConnectOpen(true)}><Plus className="h-4 w-4 mr-1" /> Connect</Button>
      </div>

      <ConnectionsPanel connections={connections} />

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search title or author" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        {dropdown(mediaType, setMediaType, TYPES, 'types')}
        {dropdown(status, setStatus, STATUSES, 'statuses')}
        {dropdown(list, setList, LISTS, 'lists')}
      </div>

      <Shelf items={items} onOpen={setSelected} />

      <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      <ItemDetail item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
