import { useCallback, useRef, useState } from 'react';
import DayColumn from './day-column';
import type { DayComposition, StalenessInfo } from '@/lib/hearth';
import type { Member, Recipe, Task } from '@/lib/types';

interface Props {
  days: DayComposition[];
  todayIso: string;
  membersById: Record<string, Member>;
  recipesById: Record<string, Recipe>;
  staleByOwner: Record<string, StalenessInfo>;
  completingIds: ReadonlySet<string>;
  onCompleteTask: (t: Task) => void;
  onOpenRecipe: (recipeId: string) => void;
  /** Persist a supper swap/move between two days. */
  onSwapMeal: (fromIso: string, toIso: string) => void;
}

interface Ghost { label: string; x: number; y: number }

/**
 * The default wall composition: seven day columns, each merging that day's
 * events, planned supper, and due/done tasks. Owns the one edit gesture —
 * dragging a supper between days — via pointer events (works for touch + mouse),
 * with a floating pickup ghost and drop-target highlight. The swap arithmetic
 * itself lives in lib/hearth.ts (computeMealSwap) and is unit-tested.
 */
export default function HearthWeek(props: Props) {
  const { days, todayIso, membersById, recipesById, staleByOwner, completingIds, onCompleteTask, onOpenRecipe, onSwapMeal } = props;
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const dragFromRef = useRef<string | null>(null);
  const dropRef = useRef<string | null>(null);

  const dayUnderPoint = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-hearth-day]');
    return el?.getAttribute('data-hearth-day') ?? null;
  };

  const onSupperPickup = useCallback((iso: string, e: React.PointerEvent) => {
    const comp = days.find((d) => d.iso === iso);
    const supper = comp?.supper;
    if (!supper) return; // nothing to pick up
    e.preventDefault();
    const label = supper.recipeId ? (recipesById[supper.recipeId]?.title ?? supper.freeText ?? 'Meal') : (supper.freeText ?? 'Meal');
    dragFromRef.current = iso;
    dropRef.current = null;
    setDragFrom(iso);
    setDropTarget(null);
    setGhost({ label, x: e.clientX, y: e.clientY });

    const move = (ev: PointerEvent) => {
      const over = dayUnderPoint(ev.clientX, ev.clientY);
      dropRef.current = over;
      setDropTarget(over);
      setGhost({ label, x: ev.clientX, y: ev.clientY });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const from = dragFromRef.current;
      const to = dropRef.current;
      if (from && to && from !== to) onSwapMeal(from, to);
      dragFromRef.current = null;
      dropRef.current = null;
      setDragFrom(null);
      setDropTarget(null);
      setGhost(null);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
  }, [days, recipesById, onSwapMeal]);

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-3">
        {days.map((comp) => (
          <DayColumn
            key={comp.iso}
            comp={comp}
            isToday={comp.iso === todayIso}
            membersById={membersById}
            recipesById={recipesById}
            staleByOwner={staleByOwner}
            completingIds={completingIds}
            onCompleteTask={onCompleteTask}
            onOpenRecipe={onOpenRecipe}
            onSupperPickup={onSupperPickup}
            isDragSource={dragFrom === comp.iso}
            isDropTarget={Boolean(dragFrom) && dropTarget === comp.iso && dropTarget !== dragFrom}
            dragActive={Boolean(dragFrom)}
          />
        ))}
      </div>
      {ghost && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ember bg-card px-4 py-2 text-lg text-ink shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}
        >
          {ghost.label}
        </div>
      )}
    </>
  );
}
