import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useRecipePages } from '@/hooks/use-meals';

const DEBOUNCE_MS = 250;

interface Props {
  /** A recipe id, or `null` plus the free text for a recipe-less entry. */
  onPick: (recipeId: string | null, freeText?: string) => void;
}

/** The "plan a meal" list: searches recipes on the server, so no recipe is out of reach. */
export default function RecipePicker({ onPick }: Props) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term]);

  const query = useRecipePages(debounced);
  const recipes = query.data?.recipes ?? [];

  return (
    <div className="space-y-2">
      <Input type="search" value={term} onChange={(e) => setTerm(e.target.value)}
        placeholder={t('meals.searchRecipes')} aria-label={t('meals.searchRecipes')} />
      {/* While a new search loads, the previous results stay (no flicker) but are dimmed and disabled. */}
      <div className="space-y-2 max-h-96 overflow-y-auto" aria-busy={query.isPlaceholderData}>
        {recipes.map((r) => (
          <button key={r.id} onClick={() => onPick(r.id)} disabled={query.isPlaceholderData}
            className="block w-full rounded-lg border border-tan px-3 py-2 text-left text-sm hover:border-ember disabled:opacity-50 disabled:hover:border-tan">{r.title}</button>
        ))}
        {query.data && recipes.length === 0 && (
          <div className="py-2 text-center text-sm text-ash">{debounced.trim() ? t('meals.noRecipeMatches') : t('meals.noRecipesYet')}</div>
        )}
        {query.hasNextPage && (
          <Button variant="outline" className="w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage || query.isPlaceholderData}>
            {t('meals.loadMore')}
          </Button>
        )}
        <button onClick={() => onPick(null, t('meals.leftovers'))}
          className="block w-full rounded-lg border border-dashed border-tan px-3 py-2 text-left text-sm text-ash hover:border-ember">
          {t('meals.leftoversFreeText')}
        </button>
      </div>
    </div>
  );
}
