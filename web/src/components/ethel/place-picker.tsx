import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { buildPlaceTree, flattenPlaceTree } from '@/lib/place-tree';
import type { EthelPlace } from '@/lib/types';

interface Props {
  places: EthelPlace[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  /** Ids to leave out — the place manager passes a node's own subtree so a
   *  reparent cannot offer a move the server would answer with PLACE_CYCLE. */
  excludeIds?: Set<string>;
  disabled?: boolean;
  id?: string;
}

/** A native <select> over the place tree, indented by depth.
 *
 *  Native rather than a custom tree widget: it is keyboard- and
 *  touch-accessible for free, it works on the Hearth View touchscreen, and a
 *  household has tens of places, not thousands. Indentation is leading spaces
 *  in the option text, which every browser renders inside <option> where
 *  padding would not apply. */
export default function PlacePicker({ places, value, onChange, label, excludeIds, disabled, id }: Props) {
  const { t } = useTranslation();
  const rows = excludeIds ? places.filter((p) => !excludeIds.has(p.id)) : places;
  const options = flattenPlaceTree(buildPlaceTree(rows));
  const selectId = id ?? 'place-picker';

  return (
    <div className="space-y-1">
      {label !== undefined && <Label htmlFor={selectId}>{label}</Label>}
      <select
        id={selectId}
        aria-label={label ?? t('ethel.places.place')}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm disabled:opacity-50"
      >
        <option value="">{t('ethel.places.none')}</option>
        {options.map(({ place, depth }) => (
          <option key={place.id} value={place.id}>
            {`${' '.repeat(depth * 2)}${place.name}`}
          </option>
        ))}
      </select>
    </div>
  );
}
