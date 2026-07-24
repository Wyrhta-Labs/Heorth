import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import DayStrip from '@/components/dashboard/day-strip';
import SupperCard from '@/components/dashboard/supper-card';
import Agenda from '@/components/dashboard/agenda';
import CompactTaskList from '@/components/tasks/compact-task-list';
import { useTasks, useCompleteTask } from '@/hooks/use-tasks';
import type { Task } from '@/lib/types';

/**
 * Phone-first "Today/This-week": a compact stack — this week's day strip,
 * tonight's supper, today's agenda (native + mirrored M365 events, via the
 * shared Agenda widget), and a capped due-tasks list. Not the wall layout
 * (that's Task 2.5's /hearth) — narrower, single column, thumb-scrollable.
 */
export default function TodayPage() {
  const { toast } = useToast();
  const tasksQuery = useTasks({ status: 'open' });
  const complete = useCompleteTask();
  const tasks = tasksQuery.data?.data ?? [];

  const onToggle = async (t: Task) => {
    try {
      await complete.mutateAsync({ id: t.id, completed: true });
    } catch (e) {
      toast((e as Error).message || 'Could not update the task', 'error');
    }
  };

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <DayStrip />
      <SupperCard />
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Today</CardTitle></CardHeader>
        <CardContent><Agenda /></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Due soon</CardTitle></CardHeader>
        <CardContent><CompactTaskList tasks={tasks} onToggle={(t) => void onToggle(t)} /></CardContent>
      </Card>
    </div>
  );
}
