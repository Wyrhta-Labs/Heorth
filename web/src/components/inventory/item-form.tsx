import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InventoryItem } from '@/lib/types';
import type { ItemInput } from '@/api/inventory';

interface Props {
  item?: InventoryItem | null;
  onSubmit: (input: ItemInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

/** Create/edit form over the inventory item fields (`createItemSchema`). */
export default function ItemForm({ item, onSubmit, onCancel, isLoading }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [manufacturer, setManufacturer] = useState(item?.manufacturer ?? '');
  const [model, setModel] = useState(item?.model ?? '');
  const [serialNumber, setSerialNumber] = useState(item?.serialNumber ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [warrantyUntil, setWarrantyUntil] = useState(item?.warrantyUntil ?? '');
  const [purchasePrice, setPurchasePrice] = useState(item?.purchasePrice ?? '');
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate ?? '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name,
      category: category || null,
      manufacturer: manufacturer || null,
      model: model || null,
      serialNumber: serialNumber || null,
      location: location || null,
      notes: notes || null,
      warrantyUntil: warrantyUntil || null,
      purchasePrice: purchasePrice ? Number(purchasePrice) : null,
      purchaseDate: purchaseDate || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="inv-name">{t('inventory.fields.name')}</Label>
        <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="inv-category">{t('inventory.fields.category')}</Label>
          <Input id="inv-category" value={category ?? ''} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-location">{t('inventory.fields.location')}</Label>
          <Input id="inv-location" value={location ?? ''} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="inv-manufacturer">{t('inventory.fields.manufacturer')}</Label>
          <Input id="inv-manufacturer" value={manufacturer ?? ''} onChange={(e) => setManufacturer(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-model">{t('inventory.fields.model')}</Label>
          <Input id="inv-model" value={model ?? ''} onChange={(e) => setModel(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="inv-serial">{t('inventory.fields.serialNumber')}</Label>
        <Input id="inv-serial" value={serialNumber ?? ''} onChange={(e) => setSerialNumber(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="inv-purchase-date">{t('inventory.fields.purchaseDate')}</Label>
          <Input id="inv-purchase-date" type="date" value={purchaseDate ?? ''} onChange={(e) => setPurchaseDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-purchase-price">{t('inventory.fields.purchasePrice')}</Label>
          <Input id="inv-purchase-price" type="number" step="0.01" min="0" value={purchasePrice ?? ''} onChange={(e) => setPurchasePrice(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="inv-warranty">{t('inventory.fields.warrantyUntil')}</Label>
        <Input id="inv-warranty" type="date" value={warrantyUntil ?? ''} onChange={(e) => setWarrantyUntil(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="inv-notes">{t('inventory.fields.notes')}</Label>
        <Input id="inv-notes" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? t('common.loading') : t('common.save')}</Button>
      </div>
    </form>
  );
}
