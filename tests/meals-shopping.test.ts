import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/meals/service.js';

describe('shopping list', () => {
  it('merges like ingredients across planned recipes and preserves hand-added items', async () => {
    const { admin } = await seedTestHousehold();
    const a = await service.createRecipe({
      title: 'Soup', servings: 4, ingredients: [{ name: 'Onion', qty: 2, unit: 'each' }, { name: 'Stock', qty: 1, unit: 'L' }], steps: [], tags: [],
    }, admin.user.id);
    const b = await service.createRecipe({
      title: 'Curry', servings: 4, ingredients: [{ name: 'Onion', qty: 3, unit: 'each' }], steps: [], tags: [],
    }, admin.user.id);

    await service.upsertPlanEntry({ date: '2026-07-13', slot: 'supper', recipeId: a.id });
    await service.upsertPlanEntry({ date: '2026-07-14', slot: 'supper', recipeId: b.id });

    // Hand-added item survives generation.
    await service.addShoppingItem({ name: 'Kitchen roll', qty: 1, unit: 'pack' });

    const items = await service.generateShoppingList('2026-07-13', '2026-07-19');
    const onion = items.find((i) => i.name === 'Onion');
    expect(Number(onion!.qty)).toBe(5); // 2 + 3 merged
    expect(onion!.sourceRecipeId).not.toBeNull();
    const handAdded = items.find((i) => i.name === 'Kitchen roll');
    expect(handAdded).toBeTruthy();
    expect(handAdded!.sourceRecipeId).toBeNull();
  });

  it('checks off an item', async () => {
    await seedTestHousehold();
    const item = await service.addShoppingItem({ name: 'Milk', qty: 2, unit: 'L' });
    const updated = await service.updateShoppingItem(item.id, { checked: true });
    expect(updated!.checked).toBe(true);
  });
});
