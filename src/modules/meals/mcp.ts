import { z } from 'zod';
import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as service from './service.js';
import { MEAL_SLOTS } from './schema.js';

/** Wrap any JSON-serialisable value as an MCP text tool-result. */
function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const mealsTools: McpTool[] = [
  {
    name: 'meals.list_recipes',
    description: 'List recipes, optionally filtered by tag.',
    inputSchema: {
      tag: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    async handler(_ctx, input) {
      const i = input as { tag?: string; limit?: number };
      const { rows } = await service.listRecipes(i);
      return result({ recipes: rows });
    },
  },
  {
    name: 'meals.create_recipe',
    description: 'Create a recipe with ingredients, steps, and tags.',
    inputSchema: {
      title: z.string().min(1),
      servings: z.number().int().positive().default(1),
      ingredients: z.array(z.object({ name: z.string(), qty: z.number(), unit: z.string() })).default([]),
      steps: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
    },
    async handler(ctx, input) {
      return result(await service.createRecipe(input as never, ctx.principal.userId));
    },
  },
  {
    name: 'meals.plan_meal',
    description: 'Assign a recipe or free-text meal to a date + slot (upserts).',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slot: z.enum(MEAL_SLOTS),
      recipeId: z.string().uuid().nullish(),
      freeText: z.string().nullish(),
      cook: z.string().uuid().nullish(),
      helper: z.string().uuid().nullish(),
    },
    async handler(_ctx, input) {
      return result(await service.upsertPlanEntry(input as never));
    },
  },
  {
    name: 'meals.get_week_plan',
    description: 'Return meal plan entries between two dates (YYYY-MM-DD).',
    inputSchema: {
      from: z.string(),
      to: z.string(),
    },
    async handler(_ctx, input) {
      const i = input as { from: string; to: string };
      const entries = await service.getWeekPlan(i.from, i.to);
      return result({ entries });
    },
  },
  {
    name: 'meals.generate_shopping_list',
    description: 'Generate (regenerate) the shopping list from planned recipes in a date range.',
    inputSchema: {
      from: z.string(),
      to: z.string(),
    },
    async handler(_ctx, input) {
      const i = input as { from: string; to: string };
      const items = await service.generateShoppingList(i.from, i.to);
      return result({ items });
    },
  },
  {
    name: 'meals.check_off_item',
    description: 'Mark a shopping list item as checked or unchecked.',
    inputSchema: {
      id: z.string().uuid(),
      checked: z.boolean().default(true),
    },
    async handler(_ctx, input) {
      const i = input as { id: string; checked: boolean };
      const item = await service.updateShoppingItem(i.id, { checked: i.checked });
      if (!item) throw new Error('Item not found');
      return result(item);
    },
  },
];
