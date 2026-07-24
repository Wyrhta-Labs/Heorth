import { z } from 'zod';
import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as service from './service.js';
import { TASK_STATUSES } from './schema.js';

/** Wrap any JSON-serialisable value as an MCP text tool-result. */
function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const tasksTools: McpTool[] = [
  {
    name: 'tasks.list',
    description: 'List household tasks mirrored from Microsoft To Do, with optional filters.',
    inputSchema: {
      status: z.enum(TASK_STATUSES).optional(),
      member_id: z.string().uuid().optional(),
      list_id: z.string().optional(),
      due_from: z.string().datetime().optional(),
      due_to: z.string().datetime().optional(),
    },
    async handler(_ctx, input) {
      const i = input as {
        status?: (typeof TASK_STATUSES)[number]; member_id?: string; list_id?: string;
        due_from?: string; due_to?: string;
      };
      const rows = await service.listTasks({
        status: i.status, memberId: i.member_id, listId: i.list_id,
        dueFrom: i.due_from, dueTo: i.due_to,
      });
      return result({ tasks: rows });
    },
  },
  {
    name: 'tasks.complete',
    description: 'Complete or uncomplete a task (writes back to Microsoft To Do).',
    inputSchema: {
      id: z.string().uuid(),
      completed: z.boolean().optional().default(true),
    },
    async handler(_ctx, input) {
      const i = input as { id: string; completed: boolean };
      const row = await service.completeTask(i.id, i.completed);
      if (!row) throw new Error('Task not found');
      return result(row);
    },
  },
  {
    name: 'tasks.create',
    description: 'Create a task in the shared household To Do list.',
    inputSchema: {
      title: z.string().min(1),
      notes: z.string().nullish(),
      dueAt: z.string().datetime().nullish(),
    },
    async handler(ctx, input) {
      const i = input as { title: string; notes?: string | null; dueAt?: string | null };
      const row = await service.createTask(
        { title: i.title, notes: i.notes ?? null, dueAt: i.dueAt ?? null },
        ctx.principal.userId,
      );
      return result(row);
    },
  },
];
