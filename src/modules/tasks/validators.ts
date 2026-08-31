import { z } from 'zod';
import { TASK_STATUSES } from './schema.js';

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  member_id: z.string().uuid().optional(),
  list_id: z.string().optional(),
  due_from: z.string().datetime().optional(),
  due_to: z.string().datetime().optional(),
});

export const completeTaskSchema = z.object({
  completed: z.boolean(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
});

/**
 * Provider-aware allowlist submission. The old `{ listIds: string[] }` shape
 * could not express which provider a list belonged to, so a Google list was
 * unselectable. No alias is kept — the web is the only client, and heorth-mcp
 * does not touch this route.
 */
export const setAllowlistSchema = z.object({
  lists: z.array(z.object({
    provider: z.string().min(1),
    listId: z.string().min(1),
  })).default([]),
});

export const setHouseholdListSchema = z.object({
  provider: z.string().min(1),
  listId: z.string().min(1),
});

export type ListTasksQueryInput = z.infer<typeof listTasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
