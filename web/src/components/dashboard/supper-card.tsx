import { UtensilsCrossed } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useWeekPlan } from '@/hooks/use-meals';
import { useRecipes } from '@/hooks/use-meals';
import { dayLabel } from '@/lib/format';

export default function SupperCard() {
  const today = dayLabel(new Date()).iso;
  const { data: plan } = useWeekPlan(today, today);
  const { data: recipes } = useRecipes();
  const supper = plan?.data.find((e) => e.slot === 'supper');
  const recipe = supper?.recipeId ? recipes?.data.find((r) => r.id === supper.recipeId) : undefined;
  const title = recipe?.title ?? supper?.freeText ?? 'Nothing planned yet';

  return (
    <Card className="bg-ink text-parchment border-ink">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 text-ember-soft text-sm mb-2">
          <UtensilsCrossed className="h-4 w-4" /> Tonight&rsquo;s supper
        </div>
        <div className="font-serif text-2xl">{title}</div>
        {recipe && (
          <div className="mt-3 flex flex-wrap gap-2">
            {recipe.ingredients.slice(0, 6).map((ing, i) => (
              <span key={i} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">{ing.name}</span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
