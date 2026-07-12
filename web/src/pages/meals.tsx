import { useState } from 'react';
import { Plus } from 'lucide-react';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import RecipeLibrary from '@/components/meals/recipe-library';
import RecipeForm from '@/components/meals/recipe-form';
import WeekPlanner from '@/components/meals/week-planner';
import ShoppingList from '@/components/meals/shopping-list';
import {
  useRecipes, useCreateRecipe, useUpdateRecipe, useWeekPlan, useUpsertPlanEntry,
  useShoppingList, useGenerateShoppingList, useAddShoppingItem, useUpdateShoppingItem, useRemoveShoppingItem,
} from '@/hooks/use-meals';
import type { Recipe, MealSlot } from '@/lib/types';

export default function MealsPage() {
  const { toast } = useToast();
  const from = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const to = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const { data: recipesData } = useRecipes();
  const recipes = recipesData?.data ?? [];
  const { data: planData } = useWeekPlan(from, to);
  const entries = planData?.data ?? [];
  const { data: listData } = useShoppingList();
  const items = listData?.data ?? [];

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
    toast('Recipe saved', 'success');
  };

  const assignRecipe = async (recipeId: string | null, freeText?: string) => {
    if (!assign) return;
    await upsertEntry.mutateAsync({ date: assign.date, slot: assign.slot, recipeId, freeText: freeText ?? null });
    setAssign(null);
    toast('Meal planned', 'success');
  };

  return (
    <Tabs defaultValue="planner" className="space-y-4">
      <TabsList>
        <TabsTrigger value="planner">Planner</TabsTrigger>
        <TabsTrigger value="library">Recipes</TabsTrigger>
        <TabsTrigger value="shopping">Shopping list</TabsTrigger>
      </TabsList>

      <TabsContent value="planner">
        <Card><CardContent className="p-4">
          <WeekPlanner entries={entries} recipes={recipes} onAssign={(date, slot) => setAssign({ date, slot })} />
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="library">
        <div className="flex justify-end mb-4">
          <Button onClick={() => { setEditing(null); setRecipeOpen(true); }}><Plus className="h-4 w-4" /> New recipe</Button>
        </div>
        <RecipeLibrary recipes={recipes} onSelect={(r) => { setEditing(r); setRecipeOpen(true); }} />
      </TabsContent>

      <TabsContent value="shopping">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Shopping list</CardTitle></CardHeader>
          <CardContent>
            <ShoppingList
              items={items}
              onToggle={(id, checked) => updateItem.mutate({ id, input: { checked } })}
              onAdd={(name) => addItem.mutate({ name })}
              onRemove={(id) => removeItem.mutate(id)}
              onGenerate={() => generate.mutate({ from, to }, { onSuccess: () => toast('List generated', 'success') })}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <Dialog open={recipeOpen} onOpenChange={setRecipeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit recipe' : 'New recipe'}</DialogTitle>
            <DialogClose onClose={() => setRecipeOpen(false)} />
          </DialogHeader>
          <RecipeForm recipe={editing ?? undefined} onSubmit={saveRecipe} onCancel={() => setRecipeOpen(false)}
            isLoading={createRecipe.isPending || updateRecipe.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plan a meal</DialogTitle>
            <DialogClose onClose={() => setAssign(null)} />
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recipes.map((r) => (
              <button key={r.id} onClick={() => assignRecipe(r.id)}
                className="block w-full rounded-lg border border-tan px-3 py-2 text-left text-sm hover:border-ember">{r.title}</button>
            ))}
            <button onClick={() => assignRecipe(null, 'Leftovers')}
              className="block w-full rounded-lg border border-dashed border-tan px-3 py-2 text-left text-sm text-ash hover:border-ember">
              Leftovers (free text)
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
