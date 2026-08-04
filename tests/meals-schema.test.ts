// tests/meals-schema.test.ts
import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { db } from '../src/db/index.js';
import { recipes } from '../src/modules/meals/schema.js';

describe('meals schema', () => {
  it('stores ingredients and steps as JSON', async () => {
    const { adult } = await seedTestHousehold();
    const [row] = await db.insert(recipes).values({
      title: 'Pasta', servings: 4,
      ingredients: [{ name: 'Pasta', qty: 500, unit: 'g' }],
      steps: ['Boil water', 'Cook pasta'], tags: ['quick'], createdBy: adult.user.id,
    }).returning();
    expect(row!.ingredients[0]!.name).toBe('Pasta');
    expect(row!.steps.length).toBe(2);
    expect(row!.tags).toEqual(['quick']);
  });
});
