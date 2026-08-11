import { X } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import EventForm, { type EventFormValues } from '@/components/calendar/event-form';
import { useCreateEvent } from '@/hooks/use-calendar';
import { useToast } from '@/components/ui/toast';
import { useFormatters } from '@/hooks/use-formatters';

interface Props {
  /** The tapped local day, yyyy-MM-dd. */
  date: string;
  onClose: () => void;
}

/**
 * Full-bleed "add an event" overlay for the wall, opened by tapping a day in
 * the week or month view. Same big-tap-target pattern as RecipeOverlay: the
 * ONLY way to dismiss it is the large (X) in the corner (or the form's Cancel)
 * — deliberately no backdrop-click and no Escape, so a stray brush against the
 * touch panel can't swallow a half-filled form.
 */
export default function AddEventOverlay({ date, onClose }: Props) {
  const { t } = useTranslation();
  const { locale } = useFormatters();
  const { toast } = useToast();
  const create = useCreateEvent();

  const submit = async (v: EventFormValues) => {
    try {
      await create.mutateAsync(v);
      toast(t('hearth.addEvent.created'), 'success');
      onClose();
    } catch {
      // Keep the overlay (and the typed values) open so nothing is lost.
      toast(t('hearth.addEvent.createFailed'), 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-parchment" role="dialog" aria-modal="true" aria-label={t('hearth.addEvent.title')}>
      <div className="flex items-start justify-between gap-4 border-b border-tan px-10 py-6">
        <div>
          <h2 className="font-serif text-5xl text-ink">{t('hearth.addEvent.title')}</h2>
          <p className="mt-1 text-xl text-ash">{format(new Date(date + 'T00:00:00'), t('hearth.header.datePattern'), { locale })}</p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('hearth.addEvent.close')}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ember text-white"
        >
          <X className="h-8 w-8" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto w-full max-w-3xl">
          <EventForm initialDate={date} onSubmit={submit} onCancel={onClose} isLoading={create.isPending} />
        </div>
      </div>
    </div>
  );
}
