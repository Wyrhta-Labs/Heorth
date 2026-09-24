import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import type { EthelPlace } from '@/lib/types';
import DocumentsPanel from './documents-panel';

/** Places have no detail page, so their panel opens from the place manager. */
export default function PlaceDocumentsDialog({ place, onClose }: { place: EthelPlace | null; onClose: () => void }) {
  const { t } = useTranslation();
  if (!place) return null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('gewrit.placeTitle', { name: place.name })}</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <DocumentsPanel element={{ placeId: place.id }} />
      </DialogContent>
    </Dialog>
  );
}
