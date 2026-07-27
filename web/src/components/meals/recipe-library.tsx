import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Recipe } from '@/lib/types';

interface Props { recipes: Recipe[]; onSelect: (r: Recipe) => void; }

export default function RecipeLibrary({ recipes, onSelect }: Props) {
  const { t } = useTranslation();
  if (recipes.length === 0) return <div className="text-sm text-ash py-8 text-center">{t('meals.noRecipesYet')}</div>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {recipes.map((r) => (
        <button key={r.id} onClick={() => onSelect(r)} className="text-left">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <h3 className="font-serif text-lg text-ink">{r.title}</h3>
              <div className="text-xs text-ash mt-0.5">{t('meals.recipeMeta', { servings: r.servings, count: r.ingredients.length })}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
              </div>
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  );
}
