import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/api/client';
import { useUpsertFacility, useDeleteFacility } from '@/hooks/use-ethel';
import { buildPlaceTree, flattenPlaceTree } from '@/lib/place-tree';
import type { EthelFacility, EthelPlace, FacilityKind } from '@/lib/types';

export const FACILITY_KINDS: FacilityKind[] = ['heating', 'water', 'electrical', 'solar', 'sewage', 'ventilation', 'network', 'other'];

interface Props {
  assetId: string;
  /** The inlined detail row, or null when the member is adding one. */
  facility: EthelFacility | null;
  /** The same flat place set the picker uses — the served-places control is a
   *  multi-select over it, not a second fetch. */
  places?: EthelPlace[];
  onRemoved?: () => void;
}

/** The facility half of the asset detail (`PUT /ethel/assets/:id/facility`).
 *
 *  Rendered only when the asset has no VEHICLE row — see the mutual exclusion
 *  in `asset-detail.tsx`, which is 409 ASSET_DETAIL_CONFLICT expressed as UI. */
export default function FacilityDetails({ assetId, facility, places = [], onRemoved }: Props) {
  const { t } = useTranslation();
  const upsert = useUpsertFacility();
  const remove = useDeleteFacility();
  const [kind, setKind] = useState<FacilityKind>(facility?.kind ?? 'heating');
  const [commissionedOn, setCommissionedOn] = useState(facility?.commissionedOn ?? '');
  const [intervalMonths, setIntervalMonths] = useState(facility?.serviceIntervalMonths != null ? String(facility.serviceIntervalMonths) : '');
  const [serves, setServes] = useState<string[]>(facility?.servesPlaceIds ?? []);
  const [error, setError] = useState('');

  const options = flattenPlaceTree(buildPlaceTree(places));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await upsert.mutateAsync({
        id: assetId,
        input: {
          kind,
          commissionedOn: commissionedOn || null,
          serviceIntervalMonths: intervalMonths ? Number(intervalMonths) : null,
          // The full set, every time: the server REPLACES it rather than
          // merging, so anything left out here is a removal. Sending a diff
          // would silently drop the places the member did not touch.
          servesPlaceIds: serves,
        },
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'PLACE_NOT_FOUND') setError(t('ethel.facility.placeNotFound'));
      else setError((err as Error)?.message || t('common.loadFailed'));
    }
  };

  const handleRemove = async () => {
    if (!confirm(t('ethel.details.removeConfirm'))) return;
    setError('');
    try {
      await remove.mutateAsync(assetId);
      onRemoved?.();
    } catch (err) {
      setError((err as Error)?.message || t('common.loadFailed'));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t('ethel.facility.title')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="facility-kind">{t('ethel.facility.kind')}</Label>
              <select
                id="facility-kind"
                aria-label={t('ethel.facility.kind')}
                value={kind}
                onChange={(e) => setKind(e.target.value as FacilityKind)}
                className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
              >
                {FACILITY_KINDS.map((k) => <option key={k} value={k}>{t(`ethel.facility.kinds.${k}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="facility-commissioned">{t('ethel.facility.commissionedOn')}</Label>
              <Input id="facility-commissioned" type="date" value={commissionedOn} onChange={(e) => setCommissionedOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="facility-interval">{t('ethel.details.interval')}</Label>
              <Input id="facility-interval" type="number" min={1} step={1} value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} />
            </div>
          </div>
          {/* Documentation, not a reminder: nothing schedules from it. */}
          <p className="text-xs text-muted-foreground">{t('ethel.details.intervalHelp')}</p>

          <div className="space-y-1">
            <Label htmlFor="facility-serves">{t('ethel.facility.serves')}</Label>
            {/* A native multi-select over the same flat place set the picker
                uses: keyboard- and touch-accessible for free, and a household
                has tens of places. Indentation is leading spaces, which every
                browser renders inside <option>. */}
            <select
              id="facility-serves"
              aria-label={t('ethel.facility.serves')}
              multiple
              value={serves}
              onChange={(e) => setServes(Array.from(e.target.selectedOptions, (o) => o.value))}
              className="w-full rounded-md border border-tan bg-card px-3 py-1 text-sm"
              size={Math.min(Math.max(options.length, 3), 8)}
            >
              {options.map(({ place, depth }) => (
                <option key={place.id} value={place.id}>
                  {`${' '.repeat(depth * 2)}${place.name}`}
                </option>
              ))}
            </select>
          </div>

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-between">
            <Button type="button" variant="outline" size="sm" onClick={handleRemove} disabled={!facility || remove.isPending}>
              {t('ethel.details.remove')}
            </Button>
            <Button type="submit" size="sm" disabled={upsert.isPending}>{t('common.save')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
