import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { startOfWeek, addDays, format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import WeekView from '@/components/calendar/week-view';
import MonthView from '@/components/calendar/month-view';
import EventForm, { type EventFormValues } from '@/components/calendar/event-form';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { monthGrid } from '@/lib/calendar-grid';
import { dayWindowInTimeZone } from '@/lib/format';
import { useEvents, useCreateEvent, useUpdateEvent, useDeleteEvent } from '@/hooks/use-calendar';
import type { Event, EventOccurrence } from '@/lib/types';

const CalendarView = z.enum(['week', 'month']);

export default function CalendarPage() {
  const { t } = useTranslation();
  const [view, setView] = usePersistedState('calendar:view', CalendarView, 'week');
  const [editing, setEditing] = useState<Event | null>(null);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  // Every date here is the HOUSEHOLD's, not the browser's: the week, the
  // month, today's mark, the day an event lands in and its time. Nothing is
  // fetched or shown until the household's zone is known; if /household
  // fails, the browser's zone stands in.
  const { zone: timeZone, ready } = useHouseholdZone();
  const todayIso = useHouseholdToday(timeZone);
  const today = parseISO(todayIso); // local-midnight carrier of the household date
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), 'yyyy-MM-dd'));
  const grid = monthGrid(today.getFullYear(), today.getMonth()).flat();
  // The whole visible range, leading/trailing month days included.
  const { from, to } = view === 'week'
    ? dayWindowInTimeZone(weekDays[0]!, weekDays[6]!, timeZone)
    : dayWindowInTimeZone(grid[0]!, grid[grid.length - 1]!, timeZone);
  const eventsQuery = useEvents({ from, to }, { enabled: ready });
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
      toast(editing ? t('calendar.eventUpdated') : t('calendar.eventCreated'), 'success');
    } catch (e) {
      toast((e as Error).message || t('calendar.saveFailed'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    await deleteMut.mutateAsync(editing.id);
    setOpen(false);
    toast(t('calendar.eventDeleted'), 'success');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-tan bg-card p-0.5">
          {(['week', 'month'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? 'bg-ember text-on-primary' : 'text-ash'}`}>
              {v === 'week' ? t('calendar.view.week') : t('calendar.view.month')}
            </button>
          ))}
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> {t('calendar.newEvent')}</Button>
      </div>

      {retry ? (
        <ErrorState message={t('calendar.loadError')} onRetry={retry} />
      ) : !ready ? (
        <Card><CardContent className="p-4 text-sm text-ash" aria-busy="true">{t('common.loading')}</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            {view === 'week'
              ? <WeekView days={weekDays} todayIso={todayIso} timeZone={timeZone} occurrences={occurrences} onSelect={openEdit} />
              : <MonthView year={today.getFullYear()} month0={today.getMonth()} todayIso={todayIso} timeZone={timeZone} occurrences={occurrences} onSelect={openEdit} />}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('calendar.editEvent') : t('calendar.newEvent')}</DialogTitle>
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
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteMut.isPending}>{t('calendar.deleteEvent')}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
