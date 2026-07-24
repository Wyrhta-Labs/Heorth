import { GripVertical, UtensilsCrossed } from 'lucide-react';
import EventChip from './event-chip';
import { resolveAttribution, type DayComposition, type StalenessInfo } from '@/lib/hearth';
import type { Member, Recipe, Task } from '@/lib/types';

interface Props {
  comp: DayComposition;
  isToday: boolean;
  membersById: Record<string, Member>;
  recipesById: Record<string, Recipe>;
  staleByOwner: Record<string, StalenessInfo>;
  completingIds: ReadonlySet<string>;
  onCompleteTask: (t: Task) => void;
  onOpenRecipe: (recipeId: string) => void;
  onSupperPickup: (iso: string, e: React.PointerEvent) => void;
  isDragSource: boolean;
  isDropTarget: boolean;
  dragActive: boolean;
}

function ownerStale(owner: string | null | undefined, stale: Record<string, StalenessInfo>): boolean {
  return owner ? Boolean(stale[owner]?.stale) : false;
}

export default function DayColumn({
  comp, isToday, membersById, recipesById, staleByOwner, completingIds,
  onCompleteTask, onOpenRecipe, onSupperPickup, isDragSource, isDropTarget, dragActive,
}: Props) {
  const dow = new Date(comp.iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
  const dom = Number(comp.iso.slice(8, 10));
  const supper = comp.supper;
  const supperRecipe = supper?.recipeId ? recipesById[supper.recipeId] : undefined;
  const supperLabel = supperRecipe?.title ?? supper?.freeText ?? null;

  return (
    <div
      data-hearth-day={comp.iso}
      className={[
        'flex min-h-0 flex-col rounded-2xl border p-3 transition-colors',
        isToday ? 'border-ember bg-card' : 'border-tan bg-card/60',
        isDropTarget ? 'ring-2 ring-ember ring-offset-2 ring-offset-parchment' : '',
        isDragSource ? 'opacity-50' : '',
      ].join(' ')}
    >
      {/* Day header */}
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium uppercase tracking-wide text-ash">{dow}</span>
        <span className={`font-serif text-3xl leading-none ${isToday ? 'text-ember' : 'text-ink'}`}>{dom}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {/* Events */}
        <div className="space-y-1.5">
          {comp.events.length === 0 && (
            <p className="px-1 py-1 text-sm text-ash/70">—</p>
          )}
          {comp.events.map((o) => {
            const attr = resolveAttribution(o, membersById);
            const owner = attr.kind === 'family' ? 'family' : attr.memberId;
            return (
              <EventChip
                key={`${o.id}-${o.occurrenceStart}`}
                occurrence={o}
                membersById={membersById}
                dimmed={ownerStale(owner, staleByOwner)}
              />
            );
          })}
        </div>

        {/* Supper (the day's planned meal) — the one draggable element */}
        <div
          className={[
            'rounded-xl border p-2',
            supperLabel ? 'border-ember/40 bg-ember/5' : 'border-dashed border-tan',
            dragActive && !isDragSource ? 'border-ember/60' : '',
          ].join(' ')}
        >
          <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-ash">
            <UtensilsCrossed className="h-3.5 w-3.5" /> Supper
          </div>
          {supperLabel ? (
            <div className="flex items-center gap-1">
              <button
                aria-label="Move meal"
                onPointerDown={(e) => onSupperPickup(comp.iso, e)}
                className="shrink-0 cursor-grab touch-none rounded-md p-1 text-ash hover:bg-ember/10 active:cursor-grabbing"
              >
                <GripVertical className="h-5 w-5" />
              </button>
              {supperRecipe ? (
                <button
                  onClick={() => onOpenRecipe(supperRecipe.id)}
                  className="min-w-0 flex-1 truncate text-left text-lg text-ink underline-offset-4 hover:underline"
                >
                  {supperLabel}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-lg text-ink">{supperLabel}</span>
              )}
            </div>
          ) : (
            <p className="px-1 text-base text-ash/70">Nothing planned</p>
          )}
        </div>

        {/* Due / done tasks */}
        {(comp.tasks.open.length > 0 || comp.tasks.completed.length > 0) && (
          <div className="space-y-1.5">
            {comp.tasks.open.map((t) => (
              <button
                key={t.id}
                onClick={() => onCompleteTask(t)}
                disabled={completingIds.has(t.id)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-tan bg-card px-2.5 py-2 text-left"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-ember" aria-hidden />
                <span className={`min-w-0 flex-1 truncate text-base ${ownerStale(t.memberId, staleByOwner) ? 'text-ash/60' : 'text-ink'}`}>
                  {t.title}
                </span>
              </button>
            ))}
            {comp.tasks.completed.map((t) => (
              <div key={t.id} className="flex items-center gap-2.5 px-2.5 py-1.5 text-base text-ash line-through">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sage/30 text-sage" aria-hidden>✓</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
              </div>
            ))}
            {comp.tasks.hiddenCompleted > 0 && (
              <p className="px-2.5 text-sm text-ash/70">+{comp.tasks.hiddenCompleted} done</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
