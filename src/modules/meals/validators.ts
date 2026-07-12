import { z } from 'zod';
import { MEAL_SLOTS } from './schema.js';

const ingredientSchema = z.object({
  name: z.string().min(1),
  qty: z.number(),
  unit: z.string(),
});

export const createRecipeSchema = z.object({
  title: z.string().min(1),
  servings: z.number().int().positive().default(1),
  ingredients: z.array(ingredientSchema).default([]),
  steps: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const updateRecipeSchema = createRecipeSchema.partial();

export const upsertPlanEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  slot: z.enum(MEAL_SLOTS),
  recipeId: z.string().uuid().optional().nullable(),
  freeText: z.string().optional().nullable(),
  cook: z.string().uuid().optional().nullable(),
  helper: z.string().uuid().optional().nullable(),
});

export const planQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const generateQuerySchema = planQuerySchema;

export const addShoppingItemSchema = z.object({
  name: z.string().min(1),
  qty: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
});

export const updateShoppingItemSchema = z.object({
  name: z.string().min(1).optional(),
  qty: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  checked: z.boolean().optional(),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type UpsertPlanEntryInput = z.infer<typeof upsertPlanEntrySchema>;
export type AddShoppingItemInput = z.infer<typeof addShoppingItemSchema>;
export type UpdateShoppingItemInput = z.infer<typeof updateShoppingItemSchema>;
