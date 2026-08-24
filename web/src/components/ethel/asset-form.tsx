import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PlacePicker from './place-picker';
import type { EthelAsset, EthelPlace } from '@/lib/types';
import type { AssetInput } from '@/api/ethel';

interface Props {
  asset?: EthelAsset | null;
  /** The whole place set, loaded once by the page — the picker assembles the
   *  tree from it client-side. */
  places?: EthelPlace[];
  onSubmit: (input: AssetInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

/** Create/edit form over the Ethel asset fields (`createAssetSchema`). */
export default function AssetForm({ asset, places = [], onSubmit, onCancel, isLoading }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(asset?.name ?? '');
  const [category, setCategory] = useState(asset?.category ?? '');
  const [manufacturer, setManufacturer] = useState(asset?.manufacturer ?? '');
  const [model, setModel] = useState(asset?.model ?? '');
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? '');
  const [placeId, setPlaceId] = useState<string | null>(asset?.placeId ?? null);
  const [locationNote, setLocationNote] = useState(asset?.locationNote ?? '');
  const [notes, setNotes] = useState(asset?.notes ?? '');
  const [warrantyUntil, setWarrantyUntil] = useState(asset?.warrantyUntil ?? '');
  const [purchasePrice, setPurchasePrice] = useState(asset?.purchasePrice ?? '');
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate ?? '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name,
      category: category || null,
      manufacturer: manufacturer || null,
      model: model || null,
      serialNumber: serialNumber || null,
      placeId,
      locationNote: locationNote || null,
      notes: notes || null,
      warrantyUntil: warrantyUntil || null,
      purchasePrice: purchasePrice ? Number(purchasePrice) : null,
      purchaseDate: purchaseDate || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="asset-name">{t('ethel.fields.name')}</Label>
        <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="asset-category">{t('ethel.fields.category')}</Label>
          <Input id="asset-category" value={category ?? ''} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="space-y-1">
          <PlacePicker
            id="asset-place"
            places={places}
            value={placeId}
            onChange={setPlaceId}
            label={t('ethel.places.place')}
          />
        </div>
      </div>
      <div className="space-y-1">
        {/* Kept alongside the picker: the note says WHERE IN the place
            ("top shelf"), which the tree deliberately does not model. */}
        <Label htmlFor="asset-location-note">{t('ethel.fields.locationNote')}</Label>
        <Input id="asset-location-note" value={locationNote ?? ''} onChange={(e) => setLocationNote(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="asset-manufacturer">{t('ethel.fields.manufacturer')}</Label>
          <Input id="asset-manufacturer" value={manufacturer ?? ''} onChange={(e) => setManufacturer(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asset-model">{t('ethel.fields.model')}</Label>
          <Input id="asset-model" value={model ?? ''} onChange={(e) => setModel(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="asset-serial">{t('ethel.fields.serialNumber')}</Label>
        <Input id="asset-serial" value={serialNumber ?? ''} onChange={(e) => setSerialNumber(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="asset-purchase-date">{t('ethel.fields.purchaseDate')}</Label>
          <Input id="asset-purchase-date" type="date" value={purchaseDate ?? ''} onChange={(e) => setPurchaseDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asset-purchase-price">{t('ethel.fields.purchasePrice')}</Label>
          <Input id="asset-purchase-price" type="number" step="0.01" min="0" value={purchasePrice ?? ''} onChange={(e) => setPurchasePrice(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="asset-warranty">{t('ethel.fields.warrantyUntil')}</Label>
        <Input id="asset-warranty" type="date" value={warrantyUntil ?? ''} onChange={(e) => setWarrantyUntil(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="asset-notes">{t('ethel.fields.notes')}</Label>
        <Input id="asset-notes" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? t('common.loading') : t('common.save')}</Button>
      </div>
    </form>
  );
}
