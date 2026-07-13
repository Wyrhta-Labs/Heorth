import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { RECURRENCE_OPTIONS } from '@/lib/constants';
import { useMembers } from '@/hooks/use-household';
import type { Event } from '@/lib/types';

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  startAt: z.string().min(1, 'Start is required'),
  endAt: z.string().min(1, 'End is required'),
  allDay: z.boolean().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  recurrence: z.string().optional(),
  attendeeIds: z.array(z.string()),
});
type FormValues = z.infer<typeof schema>;

/** The shape handed to `onSubmit`: ISO timestamps and an API-ready recurrence. */
export interface EventFormValues extends Omit<FormValues, 'recurrence'> {
  recurrence: string | null;
}

/** datetime-local strings <-> ISO. */
function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
export function localToIso(local: string): string {
  return new Date(local).toISOString();
}

interface Props {
  event?: Event;
  onSubmit: (values: EventFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function EventForm({ event, onSubmit, onCancel, isLoading }: Props) {
  const { data: membersData } = useMembers();
  const members = membersData?.data ?? [];
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: event?.title ?? '',
      startAt: toLocalInput(event?.startAt),
      endAt: toLocalInput(event?.endAt),
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
      startAt: localToIso(v.startAt),
      endAt: localToIso(v.endAt),
      recurrence: v.recurrence ? v.recurrence : null,
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="title">Title *</Label>
        <Input id="title" {...register('title')} placeholder="Dentist" />
        {errors.title && <p className="text-xs text-red-600">{errors.title.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="startAt">Start *</Label>
          <Input id="startAt" type="datetime-local" {...register('startAt')} />
          {errors.startAt && <p className="text-xs text-red-600">{errors.startAt.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="endAt">End *</Label>
          <Input id="endAt" type="datetime-local" {...register('endAt')} />
          {errors.endAt && <p className="text-xs text-red-600">{errors.endAt.message}</p>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('allDay')} /> All day
      </label>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="location">Location</Label>
          <Input id="location" {...register('location')} placeholder="Clinic" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="recurrence">Repeats</Label>
          <select id="recurrence" {...register('recurrence')} className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm">
            {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" {...register('notes')} rows={2} />
      </div>
      <div className="space-y-1">
        <Label>Attendees</Label>
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
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? 'Saving…' : event ? 'Update' : 'Create'}</Button>
      </div>
    </form>
  );
}
