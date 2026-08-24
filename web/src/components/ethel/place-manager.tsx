import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/api/client';
import { usePlaces, useCreatePlace, useUpdatePlace, useDeletePlace } from '@/hooks/use-ethel';
import { buildPlaceTree, flattenPlaceTree, subtreeIds } from '@/lib/place-tree';
import PlacePicker from './place-picker';
import type { EthelPlace, PlaceKind } from '@/lib/types';

export const PLACE_KINDS: PlaceKind[] = ['building', 'floor', 'room', 'outdoor', 'storage'];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Filter the asset list to the facilities SERVING this place
   *  (`?servesPlaceId=`). Optional: the manager is useful without it, and a
   *  caller with nowhere to send the member should not render the link. */
  onShowServing?: (placeId: string) => void;
}

/** Maps the module's place error codes to plain language. A raw
 *  `PLACE_HAS_CHILDREN` in a toast is a leak, not a message. */
function usePlaceError(): (e: unknown) => string {
  const { t } = useTranslation();
  return (e: unknown) => {
    const code = e instanceof ApiError ? e.code : '';
    switch (code) {
      case 'PLACE_HAS_CHILDREN': return t('ethel.places.hasChildren');
      case 'PLACE_CYCLE': return t('ethel.places.cycle');
      case 'PLACE_TOO_DEEP': return t('ethel.places.tooDeep');
      case 'PLACE_NAME_TAKEN': return t('ethel.places.nameTaken');
      case 'PLACE_NOT_FOUND': return t('ethel.places.notFound');
      default: return (e as Error)?.message || t('common.loadFailed');
    }
  };
}

/** Manage the place tree: rename, re-kind, reparent, delete, add. */
export default function PlaceManager({ open, onClose, onShowServing }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const describeError = usePlaceError();
  const placesQuery = usePlaces();
  const createPlace = useCreatePlace();
  const updatePlace = useUpdatePlace();
  const deletePlace = useDeletePlace();
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<PlaceKind>('room');
  const [newParentId, setNewParentId] = useState<string | null>(null);

  const places = placesQuery.data?.data ?? [];
  const rows = flattenPlaceTree(buildPlaceTree(places));

  const kindLabel = (k: PlaceKind) => t(`ethel.places.kinds.${k}`);

  const rename = async (place: EthelPlace, name: string) => {
    if (!name || name === place.name) return;
    try {
      await updatePlace.mutateAsync({ id: place.id, input: { name } });
    } catch (e) {
      toast(describeError(e), 'error');
    }
  };

  const patch = async (place: EthelPlace, input: { kind?: PlaceKind; parentId?: string | null }) => {
    try {
      await updatePlace.mutateAsync({ id: place.id, input });
    } catch (e) {
      toast(describeError(e), 'error');
    }
  };

  const remove = async (place: EthelPlace) => {
    // The confirm names the consequence the server actually has: child places
    // block the delete, but ASSETS in the place are silently unassigned by
    // ON DELETE SET NULL, which the member cannot see from the tree.
    if (!confirm(`${t('ethel.places.deleteConfirm', { name: place.name })}\n\n${t('ethel.places.deleteUnassigns')}`)) return;
    try {
      await deletePlace.mutateAsync(place.id);
    } catch (e) {
      toast(describeError(e), 'error');
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    try {
      await createPlace.mutateAsync({ name: newName, kind: newKind, parentId: newParentId });
      setNewName('');
    } catch (err) {
      toast(describeError(err), 'error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ethel.places.title')}</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {rows.length === 0 ? (
            <p className="text-muted-foreground">{t('ethel.places.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map(({ place, depth }) => (
                <li key={place.id} className="space-y-1" style={{ paddingLeft: `${depth * 16}px` }}>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t('ethel.fields.name')}
                      defaultValue={place.name}
                      onBlur={(e) => void rename(place, e.target.value.trim())}
                      className="flex-1"
                    />
                    <select
                      aria-label={t('ethel.places.kind')}
                      value={place.kind}
                      onChange={(e) => void patch(place, { kind: e.target.value as PlaceKind })}
                      className="h-9 rounded-md border border-tan bg-card px-2 text-sm"
                    >
                      {PLACE_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                    </select>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={t('ethel.delete')}
                      onClick={() => void remove(place)}
                      disabled={deletePlace.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {onShowServing && (
                    // "What serves this place", which is NOT "what lives in
                    // this place": a boiler in the cellar serves the whole
                    // house, so servesPlaceId is a different question from
                    // placeId and gets its own entry point.
                    <button
                      type="button"
                      onClick={() => onShowServing(place.id)}
                      className="text-xs text-ember underline"
                    >
                      {t('ethel.places.servingThis')}
                    </button>
                  )}
                  <PlacePicker
                    id={`place-parent-${place.id}`}
                    places={places}
                    value={place.parentId}
                    // Its own subtree is excluded rather than merely rejected:
                    // the server answers PLACE_CYCLE, but an option that can
                    // only fail should not be offered.
                    excludeIds={subtreeIds(places, place.id)}
                    onChange={(id) => void patch(place, { parentId: id })}
                    label={t('ethel.places.parent')}
                  />
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={add} className="space-y-2 border-t border-tan pt-3">
            <p className="font-medium">{t('ethel.places.add')}</p>
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('ethel.places.add')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('ethel.fields.name')}
                className="flex-1"
              />
              <select
                aria-label={t('ethel.places.kind')}
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as PlaceKind)}
                className="h-9 rounded-md border border-tan bg-card px-2 text-sm"
              >
                {PLACE_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
              </select>
            </div>
            <PlacePicker
              id="place-new-parent"
              places={places}
              value={newParentId}
              onChange={setNewParentId}
              label={t('ethel.places.parent')}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={createPlace.isPending || !newName}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
