import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/api/client';
import { useUpsertVehicle, useDeleteVehicle } from '@/hooks/use-ethel';
import type { EthelVehicle } from '@/lib/types';

interface Props {
  assetId: string;
  /** The inlined detail row, or null when the member is adding one. */
  vehicle: EthelVehicle | null;
  /** Called after a successful delete, so the panel that was only open
   *  because the member clicked "add" closes again. */
  onRemoved?: () => void;
}

/** The vehicle half of the asset detail (`PUT /ethel/assets/:id/vehicle`).
 *
 *  Rendered only when the asset has no FACILITY row — one asset carries at
 *  most one detail, and the server answers 409 ASSET_DETAIL_CONFLICT for the
 *  second. The mutual exclusion lives in `asset-detail.tsx`. */
export default function VehicleDetails({ assetId, vehicle, onRemoved }: Props) {
  const { t } = useTranslation();
  const upsert = useUpsertVehicle();
  const remove = useDeleteVehicle();
  const [registration, setRegistration] = useState(vehicle?.registration ?? '');
  const [vin, setVin] = useState(vehicle?.vin ?? '');
  const [firstRegisteredOn, setFirstRegisteredOn] = useState(vehicle?.firstRegisteredOn ?? '');
  const [odometer, setOdometer] = useState(vehicle?.odometer != null ? String(vehicle.odometer) : '');
  const [odometerReadAt, setOdometerReadAt] = useState(vehicle?.odometerReadAt ?? '');
  const [intervalMonths, setIntervalMonths] = useState(vehicle?.serviceIntervalMonths != null ? String(vehicle.serviceIntervalMonths) : '');
  const [error, setError] = useState('');

  // The odometer and its reading date are one fact, enforced by a CHECK on the
  // table and mirrored in the server's validator: a mileage with no reading
  // date says nothing. So the form makes the invalid pair unreachable in BOTH
  // directions rather than letting the member discover it as a 400 — the date
  // is disabled (and cleared) while the mileage is empty, and required once it
  // is filled.
  const hasOdometer = odometer !== '';

  const setMileage = (value: string) => {
    setOdometer(value);
    if (value === '') setOdometerReadAt('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await upsert.mutateAsync({
        id: assetId,
        input: {
          registration: registration || null,
          vin: vin || null,
          firstRegisteredOn: firstRegisteredOn || null,
          // Sent as a pair or not at all — see hasOdometer above.
          odometer: hasOdometer ? Number(odometer) : null,
          odometerReadAt: hasOdometer ? odometerReadAt : null,
          serviceIntervalMonths: intervalMonths ? Number(intervalMonths) : null,
        },
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'VEHICLE_REGISTRATION_TAKEN') setError(t('ethel.vehicle.registrationTaken'));
      else if (code === 'VEHICLE_VIN_TAKEN') setError(t('ethel.vehicle.vinTaken'));
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
      <CardHeader className="pb-2"><CardTitle className="text-base">{t('ethel.vehicle.title')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="vehicle-registration">{t('ethel.vehicle.registration')}</Label>
              <Input id="vehicle-registration" value={registration} onChange={(e) => setRegistration(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vehicle-vin">{t('ethel.vehicle.vin')}</Label>
              <Input id="vehicle-vin" value={vin} onChange={(e) => setVin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vehicle-first-registered">{t('ethel.vehicle.firstRegisteredOn')}</Label>
              <Input id="vehicle-first-registered" type="date" value={firstRegisteredOn} onChange={(e) => setFirstRegisteredOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vehicle-odometer">{t('ethel.vehicle.odometer')}</Label>
              <Input id="vehicle-odometer" type="number" min={0} step={1} value={odometer} onChange={(e) => setMileage(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vehicle-odometer-read-at">{t('ethel.vehicle.odometerReadAt')}</Label>
              <Input
                id="vehicle-odometer-read-at"
                type="date"
                value={odometerReadAt}
                disabled={!hasOdometer}
                required={hasOdometer}
                onChange={(e) => setOdometerReadAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vehicle-interval">{t('ethel.details.interval')}</Label>
              <Input id="vehicle-interval" type="number" min={1} step={1} value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} />
            </div>
          </div>
          {/* The field is documentation, not a reminder: nothing schedules from
              it. Saying so in the UI is the point — a member who reads it as a
              reminder will be wrong. */}
          <p className="text-xs text-muted-foreground">{t('ethel.details.intervalHelp')}</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-between">
            <Button type="button" variant="outline" size="sm" onClick={handleRemove} disabled={!vehicle || remove.isPending}>
              {t('ethel.details.remove')}
            </Button>
            <Button type="submit" size="sm" disabled={upsert.isPending}>{t('common.save')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
