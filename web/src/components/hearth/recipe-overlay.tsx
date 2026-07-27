import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Recipe } from '@/lib/types';

interface Props {
  recipe: Recipe;
  onClose: () => void;
}

/**
 * A large-type reading overlay for cooking at the wall — ingredients and steps
 * at a size legible across a kitchen. Read-only; the one action is Close (a big
 * tap target). Not the small-format Dialog used elsewhere: this is full-bleed
 * and sized for arm's-length reading.
 */
export default function RecipeOverlay({ recipe, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-parchment" role="dialog" aria-modal="true" aria-label={recipe.title}>
      <div className="flex items-start justify-between gap-4 border-b border-tan px-10 py-6">
        <div>
          <h2 className="font-serif text-5xl text-ink">{recipe.title}</h2>
          <p className="mt-1 text-xl text-ash">{t('hearth.recipe.serves', { count: recipe.servings })}</p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('hearth.recipe.close')}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ember text-white"
        >
          <X className="h-8 w-8" />
        </button>
      </div>
      <div className="grid flex-1 grid-cols-[1fr_1.6fr] gap-10 overflow-y-auto px-10 py-8">
        <div>
          <h3 className="mb-4 font-serif text-2xl text-ember">{t('hearth.recipe.ingredients')}</h3>
          <ul className="space-y-3">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="flex items-baseline gap-3 text-xl text-ink">
                <span className="font-medium tabular-nums text-ash">
                  {ing.qty ? `${ing.qty}${ing.unit ? ` ${ing.unit}` : ''}` : ''}
                </span>
                <span>{ing.name}</span>
              </li>
            ))}
            {recipe.ingredients.length === 0 && <li className="text-lg text-ash">{t('hearth.recipe.noIngredients')}</li>}
          </ul>
        </div>
        <div>
          <h3 className="mb-4 font-serif text-2xl text-ember">{t('hearth.recipe.method')}</h3>
          <ol className="space-y-5">
            {recipe.steps.map((step, i) => (
              <li key={i} className="flex gap-4 text-xl leading-relaxed text-ink">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ember/15 font-serif text-lg text-ember">
                  {i + 1}
                </span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
            {recipe.steps.length === 0 && <li className="text-lg text-ash">{t('hearth.recipe.noMethod')}</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}
