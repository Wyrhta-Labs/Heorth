import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ListChecks, Plus, UtensilsCrossed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useCreateTask } from '@/hooks/use-tasks';
import { useUpsertPlanEntry } from '@/hooks/use-meals';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { MEAL_SLOTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { MealSlot } from '@/lib/types';

type CaptureKind = 'task' | 'meal';

const KINDS = [
  { kind: 'task', labelKey: 'capture.addTask', icon: ListChecks },
  { kind: 'meal', labelKey: 'capture.mealNote', icon: UtensilsCrossed },
] as const;

/**
 * Quick capture: a "+" in the top bar opens a menu of the things that can be
 * captured, and each opens its form in a modal over whatever page is showing.
 * "Add task" goes straight to the shared household To Do list (tasks module
 * write-through); "Meal note" is a free-text plan entry for today (no recipe) —
 * e.g. "leftovers" or "eating out" so the week plan stays honest without
 * opening the full meals planner.
 */
export default function QuickCapture() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [kind, setKind] = useState<CaptureKind | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!menuOpen) return;
    menuItems()[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = menuItems();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const choose = (next: CaptureKind) => {
    setMenuOpen(false);
    // The menu item unmounts; hand focus to the trigger first so the dialog
    // returns it there when it closes.
    triggerRef.current?.focus();
    setKind(next);
  };

  const close = () => setKind(null);
  const active = KINDS.find((k) => k.kind === kind);

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label={t('capture.title')}
        title={t('capture.title')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Plus />
      </Button>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('capture.title')}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1.5 min-w-48 rounded-[10px] border border-line bg-surface p-1 shadow-pop"
        >
          {KINDS.map(({ kind: k, labelKey, icon: Icon }) => (
            <button
              key={k}
              role="menuitem"
              onClick={() => choose(k)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13.5px] font-medium text-fg outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted" />
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* Portalled: the top bar is its own stacking context, and the modal must
          sit above the mobile bottom nav like every other dialog. */}
      {createPortal(
        <Dialog open={active !== undefined} onOpenChange={(open) => !open && close()} className="max-w-md">
          {active && (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t(active.labelKey)}</DialogTitle>
                <DialogClose onClose={close} />
              </DialogHeader>
              {active.kind === 'task' ? <TaskForm onDone={close} /> : <MealForm onDone={close} />}
            </DialogContent>
          )}
        </Dialog>,
        document.body,
      )}
    </div>
  );
}

function TaskForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const createTask = useCreateTask();

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      await createTask.mutateAsync({ title: value });
      toast(t('capture.taskAdded'), 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message || t('capture.couldNotAddTask'), 'error');
    }
  };

  return (
    <div className="space-y-3">
      <DialogDescription>{t('capture.taskHint')}</DialogDescription>
      <Input
        autoFocus value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()} placeholder={t('capture.taskPlaceholder')}
      />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => void submit()} disabled={createTask.isPending || !text.trim()}>
          {t('capture.addTask')}
        </Button>
        <Button variant="outline" onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

function MealForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  // A meal note is filed under the HOUSEHOLD's today, so it cannot be saved
  // until the household's zone is known (browser zone only on a /household error).
  const { zone, ready } = useHouseholdZone();
  const today = useHouseholdToday(zone);
  const [text, setText] = useState('');
  const [slot, setSlot] = useState<MealSlot>('supper');
  const upsertEntry = useUpsertPlanEntry();

  const submit = async () => {
    const value = text.trim();
    if (!value || !ready) return;
    try {
      await upsertEntry.mutateAsync({ date: today, slot, recipeId: null, freeText: value });
      toast(t('capture.mealNoteSaved'), 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message || t('capture.couldNotSaveNote'), 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {MEAL_SLOTS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSlot(s.value)}
            aria-pressed={slot === s.value}
            className={cn(
              'flex-1 rounded-control border-[1.5px] px-2 py-1.5 text-xs font-semibold',
              slot === s.value ? 'border-primary bg-primary/10 text-primary' : 'border-line-strong text-muted hover:text-fg',
            )}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>
      <Input
        autoFocus value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()} placeholder={t('capture.mealPlaceholder')}
      />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => void submit()} disabled={upsertEntry.isPending || !text.trim() || !ready}>
          {t('capture.saveNote')}
        </Button>
        <Button variant="outline" onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}
