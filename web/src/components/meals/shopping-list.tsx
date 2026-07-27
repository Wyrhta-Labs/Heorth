import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ShoppingListItem } from '@/lib/types';

/** Sort: unchecked first, then by name. Exported for unit testing. */
export function sortItems(items: ShoppingListItem[]): ShoppingListItem[] {
  return [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name));
}

interface Props {
  items: ShoppingListItem[];
  onToggle: (id: string, checked: boolean) => void;
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
  onGenerate: () => void;
}

export default function ShoppingList({ items, onToggle, onAdd, onRemove, onGenerate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const sorted = sortItems(items);
  const add = () => { if (name.trim()) { onAdd(name.trim()); setName(''); } };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ash">{t('shopping.toBuy', { count: items.filter((i) => !i.checked).length })}</span>
        <Button variant="outline" size="sm" onClick={onGenerate}>{t('shopping.generateFromWeek')}</Button>
      </div>
      <ul className="space-y-1.5">
        {sorted.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-lg border border-tan bg-card px-3 py-2">
            <label className="flex flex-1 items-center gap-3 min-w-0 py-1 cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-ember"
                checked={item.checked}
                onChange={(e) => onToggle(item.id, e.target.checked)}
              />
              <span className={`flex-1 text-sm truncate ${item.checked ? 'line-through text-ash' : 'text-ink'}`}>
                {item.name}{item.qty ? ` · ${item.qty}${item.unit ? ' ' + item.unit : ''}` : ''}
              </span>
            </label>
            <Button variant="ghost" size="icon" onClick={() => onRemove(item.id)}>
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={t('shopping.addItemPlaceholder')} />
        <Button onClick={add}><Plus className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
