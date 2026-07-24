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

export const setAllowlistSchema = z.object({
  listIds: z.array(z.string().min(1)).default([]),
});

export type ListTasksQueryInput = z.infer<typeof listTasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
