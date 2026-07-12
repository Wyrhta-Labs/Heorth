import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Plus } from 'lucide-react';
import type { Recipe, Ingredient } from '@/lib/types';
import type { RecipeInput } from '@/api/meals';

interface Props { recipe?: Recipe; onSubmit: (input: RecipeInput) => Promise<void>; onCancel: () => void; isLoading?: boolean; }

export default function RecipeForm({ recipe, onSubmit, onCancel, isLoading }: Props) {
  const [title, setTitle] = useState(recipe?.title ?? '');
  const [servings, setServings] = useState(recipe?.servings ?? 4);
  const [tags, setTags] = useState((recipe?.tags ?? []).join(', '));
  const [ingredients, setIngredients] = useState<Ingredient[]>(recipe?.ingredients ?? [{ name: '', qty: 1, unit: '' }]);
  const [steps, setSteps] = useState<string[]>(recipe?.steps ?? ['']);

  const setIng = (i: number, patch: Partial<Ingredient>) =>
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      title,
      servings: Number(servings) || 1,
      ingredients: ingredients.filter((i) => i.name.trim()),
      steps: steps.filter((s) => s.trim()),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="title">Title *</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="servings">Servings</Label>
          <Input id="servings" type="number" min={1} value={servings} onChange={(e) => setServings(Number(e.target.value))} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="quick, veg" />
      </div>

      <div className="space-y-2">
        <Label>Ingredients</Label>
        {ingredients.map((ing, i) => (
          <div key={i} className="flex gap-2">
            <Input className="flex-1" placeholder="Name" value={ing.name} onChange={(e) => setIng(i, { name: e.target.value })} />
            <Input className="w-20" type="number" placeholder="Qty" value={ing.qty} onChange={(e) => setIng(i, { qty: Number(e.target.value) })} />
            <Input className="w-24" placeholder="Unit" value={ing.unit} onChange={(e) => setIng(i, { unit: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" onClick={() => setIngredients((p) => p.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setIngredients((p) => [...p, { name: '', qty: 1, unit: '' }])}>
          <Plus className="h-4 w-4" /> Add ingredient
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Steps</Label>
        {steps.map((s, i) => (
          <div key={i} className="flex gap-2">
            <Textarea className="flex-1" rows={1} value={s} onChange={(e) => setSteps((p) => p.map((x, idx) => (idx === i ? e.target.value : x)))} />
            <Button type="button" variant="ghost" size="icon" onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setSteps((p) => [...p, ''])}>
          <Plus className="h-4 w-4" /> Add step
        </Button>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading || !title.trim()}>{isLoading ? 'Saving…' : recipe ? 'Update' : 'Create'}</Button>
      </div>
    </form>
  );
}
