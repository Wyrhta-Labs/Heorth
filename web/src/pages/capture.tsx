import { useState } from 'react';
import { ListChecks, UtensilsCrossed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useCreateTask } from '@/hooks/use-tasks';
import { useUpsertPlanEntry } from '@/hooks/use-meals';
import { useFormatters } from '@/hooks/use-formatters';
import { MEAL_SLOTS } from '@/lib/constants';
import type { MealSlot } from '@/lib/types';

type Mode = 'task' | 'meal' | null;

/**
 * Quick capture: two big tap targets, minimal taps to done. "Add task" goes
 * straight to the shared household To Do list (tasks module write-through);
 * "Meal note" is a free-text plan entry for today (no recipe) — e.g.
 * "leftovers" or "eating out" so the week plan stays honest without opening
 * the full meals planner.
 */
export default function CapturePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { dayLabel } = useFormatters();
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState('');
  const [slot, setSlot] = useState<MealSlot>('supper');
  const createTask = useCreateTask();
  const upsertEntry = useUpsertPlanEntry();

  const reset = () => { setText(''); setMode(null); };

  const submitTask = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      await createTask.mutateAsync({ title: value });
      toast(t('capture.taskAdded'), 'success');
      reset();
    } catch (e) {
      toast((e as Error).message || t('capture.couldNotAddTask'), 'error');
    }
  };

  const submitMeal = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      await upsertEntry.mutateAsync({ date: dayLabel(new Date()).iso, slot, recipeId: null, freeText: value });
      toast(t('capture.mealNoteSaved'), 'success');
      reset();
    } catch (e) {
      toast((e as Error).message || t('capture.couldNotSaveNote'), 'error');
    }
  };

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <h3 className="font-serif text-2xl text-ink">{t('capture.title')}</h3>

      {mode === null && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode('task')}
            className="flex flex-col items-center gap-2 rounded-xl border border-tan bg-card py-8 text-ink hover:border-ember"
          >
            <ListChecks className="h-7 w-7 text-ember" />
            <span className="text-sm font-medium">{t('capture.addTask')}</span>
          </button>
          <button
            onClick={() => setMode('meal')}
            className="flex flex-col items-center gap-2 rounded-xl border border-tan bg-card py-8 text-ink hover:border-ember"
          >
            <UtensilsCrossed className="h-7 w-7 text-ember" />
            <span className="text-sm font-medium">{t('capture.mealNote')}</span>
          </button>
        </div>
      )}

      {mode === 'task' && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-ash">{t('capture.taskHint')}</p>
            <Input
              autoFocus value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitTask()} placeholder={t('capture.taskPlaceholder')}
            />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void submitTask()} disabled={createTask.isPending || !text.trim()}>
                {t('capture.addTask')}
              </Button>
              <Button variant="outline" onClick={reset}>{t('common.cancel')}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === 'meal' && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-2">
              {MEAL_SLOTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSlot(s.value)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${
                    slot === s.value ? 'border-ember bg-ember/10 text-ember' : 'border-tan text-ash'
                  }`}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </div>
            <Input
              autoFocus value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitMeal()} placeholder={t('capture.mealPlaceholder')}
            />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void submitMeal()} disabled={upsertEntry.isPending || !text.trim()}>
                {t('capture.saveNote')}
              </Button>
              <Button variant="outline" onClick={reset}>{t('common.cancel')}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
