import { useState } from 'react';
import { Plus } from 'lucide-react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import WeekView from '@/components/calendar/week-view';
import MonthView from '@/components/calendar/month-view';
import EventForm, { type EventFormValues } from '@/components/calendar/event-form';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useEvents, useCreateEvent, useUpdateEvent, useDeleteEvent } from '@/hooks/use-calendar';
import type { Event, EventOccurrence } from '@/lib/types';

export default function CalendarPage() {
  const [view, setView] = useState<'week' | 'month'>('week');
  const [ref] = useState(new Date());
  const [editing, setEditing] = useState<Event | null>(null);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const from = (view === 'week' ? startOfWeek(ref, { weekStartsOn: 1 }) : startOfMonth(ref)).toISOString();
  const to = (view === 'week' ? endOfWeek(ref, { weekStartsOn: 1 }) : endOfMonth(ref)).toISOString();
  const eventsQuery = useEvents({ from, to });
  const occurrences = (eventsQuery.data?.data ?? []) as EventOccurrence[];
  const retry = retryOf(eventsQuery);

  const createMut = useCreateEvent();
  const updateMut = useUpdateEvent();
  const deleteMut = useDeleteEvent();

  const openNew = () => { setEditing(null); setOpen(true); };
  const openEdit = (o: EventOccurrence) => { setEditing(o); setOpen(true); };

  const handleSubmit = async (v: EventFormValues) => {
    try {
      if (editing) await updateMut.mutateAsync({ id: editing.id, input: v });
      else await createMut.mutateAsync(v);
      setOpen(false);
      toast(editing ? 'Event updated' : 'Event created', 'success');
    } catch (e) {
      toast((e as Error).message ?? 'Failed to save event', 'error');
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    await deleteMut.mutateAsync(editing.id);
    setOpen(false);
    toast('Event deleted', 'success');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-tan bg-card p-0.5">
          {(['week', 'month'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? 'bg-ember text-white' : 'text-ash'}`}>{v}</button>
          ))}
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> New event</Button>
      </div>

      {retry ? (
        <ErrorState message="We couldn’t load your calendar." onRetry={retry} />
      ) : (
        <Card>
          <CardContent className="p-4">
            {view === 'week'
              ? <WeekView occurrences={occurrences} onSelect={openEdit} />
              : <MonthView year={ref.getFullYear()} month0={ref.getMonth()} occurrences={occurrences} onSelect={openEdit} />}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
            <DialogClose onClose={() => setOpen(false)} />
          </DialogHeader>
          <EventForm
            event={editing ?? undefined}
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
          {editing && (
            <div className="pt-2">
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteMut.isPending}>Delete event</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
