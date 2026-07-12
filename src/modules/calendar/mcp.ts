import { z } from 'zod';
import type { McpTool, McpToolContext, McpToolResult } from '@wyrhta/core/mcp';
import * as service from './service.js';

/** Wrap any JSON-serialisable value as an MCP text tool-result. */
function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

async function assertCanMutate(ctx: McpToolContext, id: string): Promise<void> {
  if (ctx.principal.role !== 'child') return;
  const owner = await service.getEventOwner(id);
  if (owner === null) throw new Error('Event not found');
  if (owner !== ctx.principal.userId) throw new Error('Children may only edit their own events');
}

const eventInput = {
  title: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean().optional().default(false),
  location: z.string().nullish(),
  notes: z.string().nullish(),
  category: z.string().nullish(),
  color: z.string().nullish(),
  recurrence: z.string().nullish(),
  attendeeIds: z.array(z.string().uuid()).optional().default([]),
};

export const calendarTools: McpTool[] = [
  {
    name: 'calendar.list_events',
    description: 'List calendar events expanded across a date range (from/to ISO timestamps).',
    inputSchema: {
      from: z.string().datetime(),
      to: z.string().datetime(),
      member_id: z.string().uuid().optional(),
    },
    async handler(_ctx, input) {
      const i = input as { from: string; to: string; member_id?: string };
      const { rows } = await service.listEvents(i);
      return result({ events: rows });
    },
  },
  {
    name: 'calendar.create_event',
    description: 'Create a calendar event, optionally recurring, with attendees.',
    inputSchema: eventInput,
    async handler(ctx, input) {
      return result(await service.createEvent(input as never, ctx.principal.userId));
    },
  },
  {
    name: 'calendar.update_event',
    description: 'Update fields of an existing event.',
    inputSchema: {
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
      allDay: z.boolean().optional(),
      location: z.string().nullish(),
      notes: z.string().nullish(),
      category: z.string().nullish(),
      color: z.string().nullish(),
      recurrence: z.string().nullish(),
      attendeeIds: z.array(z.string().uuid()).optional(),
    },
    async handler(ctx, input) {
      const { id, ...rest } = input as { id: string } & Record<string, unknown>;
      await assertCanMutate(ctx, id);
      const event = await service.updateEvent(id, rest as never);
      if (!event) throw new Error('Event not found');
      return result(event);
    },
  },
  {
    name: 'calendar.move_event',
    description: 'Reschedule an event to a new start (and optional end) time.',
    inputSchema: {
      id: z.string().uuid(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime().optional(),
    },
    async handler(ctx, input) {
      const i = input as { id: string; startAt: string; endAt?: string };
      await assertCanMutate(ctx, i.id);
      const event = await service.moveEvent(i.id, i.startAt, i.endAt);
      if (!event) throw new Error('Event not found');
      return result(event);
    },
  },
  {
    name: 'calendar.list_upcoming',
    description: 'List the next N upcoming event occurrences, optionally for one member.',
    inputSchema: {
      member_id: z.string().uuid().optional(),
      limit: z.number().int().positive().max(50).optional().default(10),
    },
    async handler(_ctx, input) {
      const i = input as { member_id?: string; limit: number };
      const events = await service.listUpcoming(i.member_id ?? null, i.limit);
      return result({ events });
    },
  },
];
