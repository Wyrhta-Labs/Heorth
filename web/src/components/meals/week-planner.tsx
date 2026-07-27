import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import { MEAL_SLOTS } from '@/lib/constants';
import type { MealPlanEntry, Recipe, MealSlot } from '@/lib/types';

const SLOT_LABEL_KEYS: Record<MealSlot, 'slotBreakfast' | 'slotLunch' | 'slotSupper'> = {
  breakfast: 'slotBreakfast',
  lunch: 'slotLunch',
  supper: 'slotSupper',
};

interface Props {
  entries: MealPlanEntry[];
  recipes: Recipe[];
  onAssign: (date: string, slot: MealSlot) => void;
}

export default function WeekPlanner({ entries, recipes, onAssign }: Props) {
  const { t } = useTranslation();
  const { weekDays, dayLabel } = useFormatters();
  const days = weekDays();
  const recipeTitle = (id: string | null) => (id ? recipes.find((r) => r.id === id)?.title ?? '—' : null);
  const cell = (iso: string, slot: MealSlot) => entries.find((e) => e.date === iso && e.slot === slot);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-2">
        <thead>
          <tr>
            <th></th>
            {days.map((d) => {
              const { dow, dom, iso } = dayLabel(d);
              return <th key={iso} className="text-center text-xs text-ash font-medium">{dow} {dom}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {MEAL_SLOTS.map((s) => (
            <tr key={s.value}>
              <td className="text-xs uppercase text-ash pr-2 whitespace-nowrap">{t(`capture.${SLOT_LABEL_KEYS[s.value]}`)}</td>
              {days.map((d) => {
                const iso = dayLabel(d).iso;
                const entry = cell(iso, s.value);
                const label = entry ? (recipeTitle(entry.recipeId) ?? entry.freeText ?? '—') : null;
                return (
                  <td key={iso}>
                    <button onClick={() => onAssign(iso, s.value)}
                      className={`h-16 w-full rounded-lg border p-1.5 text-left text-xs ${label ? 'border-ember/40 bg-ember/5 text-ink' : 'border-dashed border-tan text-ash'}`}>
                      {label ?? '+'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
