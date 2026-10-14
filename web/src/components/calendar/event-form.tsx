import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { RECURRENCE_OPTIONS } from '@/lib/constants';
import { useHousehold, useHouseholdMembers } from '@/hooks/use-household';
import { instantFromWallClock, wallClockInput } from '@/lib/format';
import type { Event } from '@/lib/types';
import type { TFunction } from 'i18next';

function buildSchema(t: TFunction) {
  return z.object({
    title: z.string().min(1, t('calendar.form.titleRequired')),
    startAt: z.string().min(1, t('calendar.form.startRequired')),
    endAt: z.string().min(1, t('calendar.form.endRequired')),
    allDay: z.boolean().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    recurrence: z.string().optional(),
    attendeeIds: z.array(z.string()),
  });
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/** The shape handed to `onSubmit`: ISO timestamps and an API-ready recurrence. */
export interface EventFormValues extends Omit<FormValues, 'recurrence'> {
  recurrence: string | null;
}

// The datetime-local inputs hold the HOUSEHOLD's wall clock, whatever zone
// the browser runs in: the Hearth wall pre-picks household days, and a time
// typed here means that time where the household lives.

/** An instant as a datetime-local value on the household clock. */
function toZonedInput(iso: string | undefined, timeZone: string): string {
  return iso ? wallClockInput(new Date(iso), timeZone) : '';
}

/**
 * Default start/end (datetime-local strings) for a new event on a given
 * household day (yyyy-MM-dd): the next full household hour when the day is
 * the household's today, otherwise a morning slot; one hour long. Used by
 * callers that pre-pick a date (e.g. the Hearth wall's tap-a-day overlay).
 */
function dateDefaults(date: string | undefined, timeZone: string): { start: string; end: string } {
  if (!date) return { start: '', end: '' };
  const [today, time] = wallClockInput(new Date(), timeZone).split('T');
  const pad = (n: number) => String(n).padStart(2, '0');
  const startHour = date === today ? Math.min(Number(time!.slice(0, 2)) + 1, 22) : 9;
  return { start: `${date}T${pad(startHour)}:00`, end: `${date}T${pad(startHour + 1)}:00` };
}

interface Props {
  event?: Event;
  /** Pre-fill start/end on this local day (yyyy-MM-dd) when creating. Ignored if `event` is set. */
  initialDate?: string;
  onSubmit: (values: EventFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function EventForm({ event, initialDate, onSubmit, onCancel, isLoading }: Props) {
  const { t } = useTranslation();
  const schema = useMemo(() => buildSchema(t), [t]);
  const { data: membersData } = useHouseholdMembers();
  const members = membersData?.data ?? [];
  const householdZone = useHousehold().data?.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Pinned at mount: the inputs were filled in this zone, so they must be read
  // back in it too, even if the household loads (or changes) while it is open.
  const [timeZone] = useState(householdZone);
  const defaults = dateDefaults(initialDate, timeZone);
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: event?.title ?? '',
      startAt: event ? toZonedInput(event.startAt, timeZone) : defaults.start,
      endAt: event ? toZonedInput(event.endAt, timeZone) : defaults.end,
      allDay: event?.allDay ?? false,
      location: event?.location ?? '',
      notes: event?.notes ?? '',
      recurrence: event?.recurrence ?? '',
      attendeeIds: event?.attendeeIds ?? [],
    },
  });
  const selected = watch('attendeeIds') ?? [];

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setValue('attendeeIds', next);
  };

  const submit = handleSubmit(async (v) => {
    await onSubmit({
      ...v,
      startAt: instantFromWallClock(v.startAt, timeZone).toISOString(),
      endAt: instantFromWallClock(v.endAt, timeZone).toISOString(),
      recurrence: v.recurrence ? v.recurrence : null,
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="title">{t('calendar.form.title')}</Label>
        <Input id="title" {...register('title')} placeholder={t('calendar.form.titlePlaceholder')} />
        {errors.title && <p className="text-xs text-danger">{errors.title.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="startAt">{t('calendar.form.start')}</Label>
          <Input id="startAt" type="datetime-local" {...register('startAt')} />
          {errors.startAt && <p className="text-xs text-danger">{errors.startAt.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="endAt">{t('calendar.form.end')}</Label>
          <Input id="endAt" type="datetime-local" {...register('endAt')} />
          {errors.endAt && <p className="text-xs text-danger">{errors.endAt.message}</p>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('allDay')} /> {t('calendar.form.allDay')}
      </label>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="location">{t('calendar.form.location')}</Label>
          <Input id="location" {...register('location')} placeholder={t('calendar.form.locationPlaceholder')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="recurrence">{t('calendar.form.repeats')}</Label>
          <select id="recurrence" {...register('recurrence')} className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm">
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">{t('calendar.form.notes')}</Label>
        <Textarea id="notes" {...register('notes')} rows={2} />
      </div>
      <div className="space-y-1">
        <Label>{t('calendar.form.attendees')}</Label>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => {
            const on = selected.includes(m.id);
            return (
              <button key={m.id} type="button" onClick={() => toggle(m.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${on ? 'border-ember bg-ember/10' : 'border-tan'}`}>
                <MemberAvatar name={m.displayName} color={m.avatarColor} size="sm" />
                {m.displayName}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('calendar.form.cancel')}</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? t('calendar.form.saving') : event ? t('calendar.form.update') : t('calendar.form.create')}</Button>
      </div>
    </form>
  );
}
