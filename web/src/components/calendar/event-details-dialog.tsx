import type { ReactNode } from 'react';
import { CalendarDays, Clock, MapPin, Repeat, Users, Cloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useFormatters } from '@/hooks/use-formatters';
import { useHouseholdMembers } from '@/hooks/use-household';
import { RECURRENCE_OPTIONS } from '@/lib/constants';
import { isMirroredEvent, type EventOccurrence } from '@/lib/types';

interface Props {
  /** The occurrence to show; `null` closes the dialog. */
  occurrence: EventOccurrence | null;
  onClose: () => void;
  /** The household zone the times are read in. */
  timeZone: string;
}

/**
 * Read-only details of one event occurrence: when, where, how often, who and
 * the notes. Times are this occurrence's (a recurring event's `startAt` is the
 * series start), in the household's zone. Editing stays on the calendar page.
 */
export default function EventDetailsDialog({ occurrence, onClose, timeZone }: Props) {
  return (
    <Dialog open={occurrence !== null} onOpenChange={(open) => !open && onClose()} className="max-w-md">
      {occurrence && <Details occurrence={occurrence} onClose={onClose} timeZone={timeZone} />}
    </Dialog>
  );
}

function Details({ occurrence: o, onClose, timeZone }: { occurrence: EventOccurrence; onClose: () => void; timeZone: string }) {
  const { t } = useTranslation();
  const { formatDate, formatTime } = useFormatters();
  const members = useHouseholdMembers().data?.data ?? [];

  const start = o.occurrenceStart;
  const end = new Date(new Date(start).getTime() + (new Date(o.endAt).getTime() - new Date(o.startAt).getTime())).toISOString();
  const recurrence = RECURRENCE_OPTIONS.find((r) => r.value === (o.recurrence ?? ''));
  const attendees = o.attendeeIds
    .map((id) => members.find((m) => m.id === id)?.displayName)
    .filter((name): name is string => !!name);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="pr-6">{o.title}</DialogTitle>
        <DialogClose onClose={onClose} />
      </DialogHeader>
      <dl className="space-y-2.5 text-sm text-fg">
        <Row icon={CalendarDays} label={t('calendar.details.date')}>{formatDate(start, timeZone)}</Row>
        <Row icon={Clock} label={t('calendar.details.time')}>
          {o.allDay ? t('hearth.event.allDay') : `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`}
        </Row>
        {o.location && <Row icon={MapPin} label={t('calendar.form.location')}>{o.location}</Row>}
        {o.recurrence && recurrence && <Row icon={Repeat} label={t('calendar.form.repeats')}>{t(recurrence.labelKey)}</Row>}
        {attendees.length > 0 && <Row icon={Users} label={t('calendar.form.attendees')}>{attendees.join(', ')}</Row>}
        {isMirroredEvent(o) && (
          <Row icon={Cloud} label={t('calendar.details.source')}>
            {o.organizer ? t('calendar.mirroredTitleWithOrganizer', { organizer: o.organizer }) : t('calendar.mirroredTitle')}
          </Row>
        )}
      </dl>
      {o.notes && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('calendar.form.notes')}</p>
          <p className="whitespace-pre-wrap text-sm text-fg">{o.notes}</p>
        </div>
      )}
    </DialogContent>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
