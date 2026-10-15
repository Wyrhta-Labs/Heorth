import { UtensilsCrossed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useWeekPlan } from '@/hooks/use-meals';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';

/** The supper planned for `day` (default: tonight); `label` names that day. */
export default function SupperCard({ day, label }: { day?: string; label?: string } = {}) {
  const { t } = useTranslation();
  // Tonight is the HOUSEHOLD's tonight; nothing is fetched until its zone is known.
  const { zone, ready } = useHouseholdZone();
  const today = useHouseholdToday(zone);
  const date = day ?? today;
  const planQuery = useWeekPlan(date, date, { enabled: ready });
  const plan = planQuery.data;
  const retry = retryOf(planQuery);
  if (retry) return <ErrorState compact message={t('today.supperLoadError')} onRetry={retry} />;
  const supper = plan?.data.find((e) => e.slot === 'supper');
  // The plan entry carries its recipe; the recipe list is paged and would miss it.
  const recipe = supper?.recipe ?? undefined;
  // Until the zone and tonight's plan are in, "nothing planned" would be a false empty state.
  const loaded = ready && plan !== undefined;
  const title = !loaded ? t('common.loading') : recipe?.title ?? supper?.freeText ?? t('today.nothingPlannedYet');

  return (
    <Card className="border-nav-active bg-nav text-nav-fg">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 text-nav-muted text-sm mb-2">
          <UtensilsCrossed className="h-4 w-4" /> {label ?? t('today.tonightsSupper')}
        </div>
        <div className="font-serif text-2xl">{title}</div>
        {recipe && (
          <div className="mt-3 flex flex-wrap gap-2">
            {recipe.ingredients.slice(0, 6).map((ing, i) => (
              <span key={i} className="rounded-full bg-nav-fg/10 px-2.5 py-1 text-xs">{ing.name}</span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
