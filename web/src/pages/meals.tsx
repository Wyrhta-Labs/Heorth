import { useState } from 'react';
import { Plus, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SectionCard } from '@/components/ui/section-tone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import RecipeLibrary from '@/components/meals/recipe-library';
import RecipeForm from '@/components/meals/recipe-form';
import WeekPlanner from '@/components/meals/week-planner';
import ShoppingList from '@/components/meals/shopping-list';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { weekOfIso } from '@/lib/format';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import {
  useRecipes, useCreateRecipe, useUpdateRecipe, useWeekPlan, useUpsertPlanEntry,
  useShoppingList, useGenerateShoppingList, useAddShoppingItem, useUpdateShoppingItem, useRemoveShoppingItem,
} from '@/hooks/use-meals';
import type { Recipe, MealSlot } from '@/lib/types';

export default function MealsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  // The planner's week is the HOUSEHOLD's (its dates are what the server
  // stores), not the browser's. Nothing is fetched or planned until the
  // household's zone is known; if /household fails, the browser's stands in.
  const { zone, ready } = useHouseholdZone();
  const week = weekOfIso(useHouseholdToday(zone));
  const from = week[0]!;
  const to = week[6]!;

  const recipesQuery = useRecipes();
  const recipes = recipesQuery.data?.data ?? [];
  const planQuery = useWeekPlan(from, to, { enabled: ready });
  const entries = planQuery.data?.data ?? [];
  const listQuery = useShoppingList();
  const items = listQuery.data?.data ?? [];
  const retry = retryOf(recipesQuery, planQuery, listQuery);

  const createRecipe = useCreateRecipe();
  const updateRecipe = useUpdateRecipe();
  const upsertEntry = useUpsertPlanEntry();
  const generate = useGenerateShoppingList();
  const addItem = useAddShoppingItem();
  const updateItem = useUpdateShoppingItem();
  const removeItem = useRemoveShoppingItem();

  const [editing, setEditing] = useState<Recipe | null>(null);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [assign, setAssign] = useState<{ date: string; slot: MealSlot } | null>(null);

  const saveRecipe = async (input: Parameters<typeof createRecipe.mutateAsync>[0]) => {
    if (editing) await updateRecipe.mutateAsync({ id: editing.id, input });
    else await createRecipe.mutateAsync(input);
    setRecipeOpen(false);
    toast(t('meals.recipeSaved'), 'success');
  };

  const assignRecipe = async (recipeId: string | null, freeText?: string) => {
    if (!assign) return;
    await upsertEntry.mutateAsync({ date: assign.date, slot: assign.slot, recipeId, freeText: freeText ?? null });
    setAssign(null);
    toast(t('meals.mealPlanned'), 'success');
  };

  if (retry) return <ErrorState message={t('meals.loadError')} onRetry={retry} />;

  return (
    <Tabs defaultValue="planner" className="space-y-4">
      <TabsList>
        <TabsTrigger value="planner">{t('meals.tabs.planner')}</TabsTrigger>
        <TabsTrigger value="library">{t('meals.tabs.recipes')}</TabsTrigger>
        <TabsTrigger value="shopping">{t('shopping.title')}</TabsTrigger>
      </TabsList>

      <TabsContent value="planner">
        <Card><CardContent className="p-4">
          {ready
            ? <WeekPlanner days={week} entries={entries} onAssign={(date, slot) => setAssign({ date, slot })} />
            : <div className="text-sm text-ash" aria-busy="true">{t('common.loading')}</div>}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="library">
        <div className="flex justify-end mb-4">
          <Button onClick={() => { setEditing(null); setRecipeOpen(true); }}><Plus className="h-4 w-4" /> {t('meals.newRecipe')}</Button>
        </div>
        <RecipeLibrary recipes={recipes} onSelect={(r) => { setEditing(r); setRecipeOpen(true); }} />
      </TabsContent>

      <TabsContent value="shopping">
        <SectionCard title={t('shopping.title')} icon={ShoppingCart} tone="sage" shade={2}>
          <ShoppingList
            items={items}
            onToggle={(id, checked) => updateItem.mutate({ id, input: { checked } })}
            onAdd={(name) => addItem.mutate({ name })}
            onRemove={(id) => removeItem.mutate(id)}
            onGenerate={() => generate.mutate({ from, to }, { onSuccess: () => toast(t('meals.listGenerated'), 'success') })}
            generateDisabled={!ready}
          />
        </SectionCard>
      </TabsContent>

      <Dialog open={recipeOpen} onOpenChange={setRecipeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('meals.editRecipe') : t('meals.newRecipe')}</DialogTitle>
            <DialogClose onClose={() => setRecipeOpen(false)} />
          </DialogHeader>
          <RecipeForm recipe={editing ?? undefined} onSubmit={saveRecipe} onCancel={() => setRecipeOpen(false)}
            isLoading={createRecipe.isPending || updateRecipe.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('meals.planMeal')}</DialogTitle>
            <DialogClose onClose={() => setAssign(null)} />
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recipes.map((r) => (
              <button key={r.id} onClick={() => assignRecipe(r.id)}
                className="block w-full rounded-lg border border-tan px-3 py-2 text-left text-sm hover:border-ember">{r.title}</button>
            ))}
            <button onClick={() => assignRecipe(null, t('meals.leftovers'))}
              className="block w-full rounded-lg border border-dashed border-tan px-3 py-2 text-left text-sm text-ash hover:border-ember">
              {t('meals.leftoversFreeText')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
