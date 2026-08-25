import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAsset } from '@/api/ethel';
import type { RoutineInput } from '@/api/weorc';
import type { EthelAsset, EthelPlace, IntervalUnit, RoutineMode, RoutineView } from '@/lib/types';

type AnchorKind = 'none' | 'asset' | 'place';

interface Props {
  routine?: RoutineView | null;
  /** The whole asset/place sets, loaded by the page — offered here so the
   *  anchor can be tied to at most ONE of them (the server answers 400
   *  ANCHOR_CONFLICT for both). */
  assets?: EthelAsset[];
  places?: EthelPlace[];
  onSubmit: (input: RoutineInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

/** Create/edit form over the Weorc routine fields (`createRoutineSchema`). */
export default function RoutineForm({ routine, assets = [], places = [], onSubmit, onCancel, isLoading }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(routine?.name ?? '');
  const [notes, setNotes] = useState(routine?.notes ?? '');
  const [mode, setMode] = useState<RoutineMode>(routine?.mode ?? 'fixed');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(routine?.intervalUnit ?? 'week');
  const [intervalCount, setIntervalCount] = useState(routine?.intervalCount ?? 1);
  const [anchorDate, setAnchorDate] = useState(routine?.anchorDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [leadDays, setLeadDays] = useState(routine?.leadDays ?? 0);
  const [ownerMemberId, setOwnerMemberId] = useState(routine?.ownerMemberId ?? '');
  const [anchorKind, setAnchorKind] = useState<AnchorKind>(
    routine?.anchorAssetId ? 'asset' : routine?.anchorPlaceId ? 'place' : 'none',
  );
  const [anchorAssetId, setAnchorAssetId] = useState<string | null>(routine?.anchorAssetId ?? null);
  const [anchorPlaceId, setAnchorPlaceId] = useState<string | null>(routine?.anchorPlaceId ?? null);
  // Once the maker has touched mode/interval directly, the asset's
  // serviceIntervalMonths must never clobber their choice — it is a DEFAULT,
  // never a trigger (ADR 0013).
  const [intervalTouched, setIntervalTouched] = useState(false);

  const assetDetailQuery = useQuery({
    queryKey: ['weorc', 'routineFormAssetDetail', anchorAssetId],
    queryFn: () => getAsset(anchorAssetId as string),
    enabled: anchorKind === 'asset' && !!anchorAssetId,
  });

  useEffect(() => {
    if (intervalTouched) return;
    const detail = assetDetailQuery.data?.data;
    if (!detail) return;
    const serviceIntervalMonths = detail.vehicle?.serviceIntervalMonths ?? detail.facility?.serviceIntervalMonths ?? null;
    if (serviceIntervalMonths) {
      setMode('from_completion');
      setIntervalUnit('month');
      setIntervalCount(serviceIntervalMonths);
    }
  }, [assetDetailQuery.data, intervalTouched]);

  const chooseAnchor = (kind: AnchorKind) => {
    setAnchorKind(kind);
    // Mutually exclusive: choosing one clears the other so the two can never
    // both be set on the wire.
    if (kind !== 'asset') setAnchorAssetId(null);
    if (kind !== 'place') setAnchorPlaceId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name,
      notes: notes || null,
      mode,
      intervalUnit,
      intervalCount: Number(intervalCount),
      anchorDate,
      leadDays: Number(leadDays) || 0,
      ownerMemberId: ownerMemberId || null,
      anchorAssetId: anchorKind === 'asset' ? anchorAssetId : null,
      anchorPlaceId: anchorKind === 'place' ? anchorPlaceId : null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="routine-name">{t('weorc.name')}</Label>
        <Input id="routine-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="routine-notes">{t('weorc.notes')}</Label>
        <Input id="routine-notes" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('weorc.mode')}</p>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            aria-label="mode-from-completion"
            checked={mode === 'from_completion'}
            onChange={() => { setMode('from_completion'); setIntervalTouched(true); }}
          />
          <span>{t('weorc.modeFromCompletion', { count: intervalCount || 1, unit: t(`weorc.unit.${intervalUnit}`) })}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            aria-label="mode-fixed"
            checked={mode === 'fixed'}
            onChange={() => { setMode('fixed'); setIntervalTouched(true); }}
          />
          <span>{t('weorc.modeFixed', { count: intervalCount || 1, unit: t(`weorc.unit.${intervalUnit}`) })}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="routine-interval-count">{t('weorc.every')}</Label>
          <Input
            id="routine-interval-count"
            type="number"
            min="1"
            value={intervalCount}
            onChange={(e) => { setIntervalCount(Number(e.target.value) || 1); setIntervalTouched(true); }}
          />
        </div>
        <div className="space-y-1">
          <select
            id="routine-interval-unit"
            aria-label="interval-unit"
            value={intervalUnit}
            onChange={(e) => { setIntervalUnit(e.target.value as IntervalUnit); setIntervalTouched(true); }}
            className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
          >
            <option value="day">{t('weorc.unit.day')}</option>
            <option value="week">{t('weorc.unit.week')}</option>
            <option value="month">{t('weorc.unit.month')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="routine-anchor-date">{t('weorc.anchorDate')}</Label>
          <Input
            id="routine-anchor-date"
            type="date"
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="routine-lead-days">{t('weorc.leadDays')}</Label>
          <Input
            id="routine-lead-days"
            type="number"
            min="0"
            value={leadDays}
            onChange={(e) => setLeadDays(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="routine-owner">{t('weorc.owner')}</Label>
        <Input
          id="routine-owner"
          value={ownerMemberId ?? ''}
          onChange={(e) => setOwnerMemberId(e.target.value)}
          placeholder={t('weorc.ownerNone')}
        />
      </div>

      <fieldset className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <input type="radio" checked={anchorKind === 'none'} onChange={() => chooseAnchor('none')} />
          {t('weorc.anchorNone')}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="radio" checked={anchorKind === 'asset'} onChange={() => chooseAnchor('asset')} />
          {t('weorc.anchorAsset')}
        </div>
        {anchorKind === 'asset' && (
          <select
            aria-label={t('weorc.anchorAsset')}
            value={anchorAssetId ?? ''}
            onChange={(e) => { setAnchorAssetId(e.target.value || null); setIntervalTouched(false); }}
            className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
          >
            <option value="">—</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2 text-sm">
          <input type="radio" checked={anchorKind === 'place'} onChange={() => chooseAnchor('place')} />
          {t('weorc.anchorPlace')}
        </div>
        {anchorKind === 'place' && (
          <select
            aria-label={t('weorc.anchorPlace')}
            value={anchorPlaceId ?? ''}
            onChange={(e) => setAnchorPlaceId(e.target.value || null)}
            className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
          >
            <option value="">—</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </fieldset>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? t('common.loading') : t('common.save')}</Button>
      </div>
    </form>
  );
}
