import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import { MEAL_SLOTS } from '@/lib/constants';
import type { MealPlanEntry, MealSlot } from '@/lib/types';

interface Props {
  entries: MealPlanEntry[];
  onAssign: (date: string, slot: MealSlot) => void;
}

export default function WeekPlanner({ entries, onAssign }: Props) {
  const { t } = useTranslation();
  const { weekDays, dayLabel } = useFormatters();
  const days = weekDays();
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
              <td className="text-xs uppercase text-ash pr-2 whitespace-nowrap">{t(s.labelKey)}</td>
              {days.map((d) => {
                const iso = dayLabel(d).iso;
                const entry = cell(iso, s.value);
                // The entry carries its recipe; the recipe list is paged and would miss it.
                const label = entry ? (entry.recipe?.title ?? entry.freeText ?? '—') : null;
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
