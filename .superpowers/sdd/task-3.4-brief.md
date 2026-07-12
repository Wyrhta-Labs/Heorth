### Task 3.4: Calendar MCP tools

**Files:**
- Modify: `src/modules/calendar/mcp.ts`
- Test: `tests/calendar-mcp.test.ts`

**Interfaces:**
- Produces: `calendarTools` — `calendar.list_events`, `calendar.create_event`, `calendar.update_event`, `calendar.move_event`, `calendar.list_upcoming`. Mutations enforce the child-scope rule.

- [ ] **Step 1: Write the failing test**

```ts
// tests/calendar-mcp.test.ts
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, invokeTool } from './helpers.js';
import { calendarTools } from '../src/modules/calendar/mcp.js';

describe('calendar MCP tools', () => {
  it('creates and lists events', async () => {
    const { admin } = await seedTestHousehold();
    await invokeTool(calendarTools, 'calendar.create_event',
      { userId: admin.user.id, role: 'admin' },
      { title: 'Swim', startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T10:00:00Z' });
    const listed = await invokeTool(calendarTools, 'calendar.list_events',
      { userId: admin.user.id, role: 'admin' },
      { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' }) as { events: unknown[] };
    expect(listed.events.length).toBe(1);
  });

  it('blocks a child from moving another member event', async () => {
    const { admin, child } = await seedTestHousehold();
    const created = await invokeTool(calendarTools, 'calendar.create_event',
      { userId: admin.user.id, role: 'admin' },
      { title: 'Bills', startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T10:00:00Z' }) as { id: string };
    await expect(
      invokeTool(calendarTools, 'calendar.move_event',
        { userId: child.user.id, role: 'child' },
        { id: created.id, startAt: '2026-07-12T09:00:00Z' }),
    ).rejects.toThrow(/own events/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/calendar-mcp.test.ts`
Expected: FAIL — tools empty.

- [ ] **Step 3: Replace `src/modules/calendar/mcp.ts`**

```ts
import { z } from 'zod';
import type { McpTool, McpToolContext } from '@wyrhta/core/mcp';
import * as service from './service.js';

async function assertCanMutate(ctx: McpToolContext, id: string): Promise<void> {
  if (ctx.role !== 'child') return;
  const owner = await service.getEventOwner(id);
  if (owner === null) throw new Error('Event not found');
  if (owner !== ctx.userId) throw new Error('Children may only edit their own events');
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
    inputSchema: z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
      member_id: z.string().uuid().optional(),
    }),
    async handler(_ctx, input) {
      const i = input as { from: string; to: string; member_id?: string };
      const { rows } = await service.listEvents(i);
      return { events: rows };
    },
  },
  {
    name: 'calendar.create_event',
    description: 'Create a calendar event, optionally recurring, with attendees.',
    inputSchema: z.object(eventInput),
    async handler(ctx, input) {
      return service.createEvent(input as never, ctx.userId);
    },
  },
  {
    name: 'calendar.update_event',
    description: 'Update fields of an existing event.',
    inputSchema: z.object({ id: z.string().uuid() }).and(z.object(eventInput).partial()),
    async handler(ctx, input) {
      const { id, ...rest } = input as { id: string } & Record<string, unknown>;
      await assertCanMutate(ctx, id);
      const event = await service.updateEvent(id, rest as never);
      if (!event) throw new Error('Event not found');
      return event;
    },
  },
  {
    name: 'calendar.move_event',
    description: 'Reschedule an event to a new start (and optional end) time.',
    inputSchema: z.object({
      id: z.string().uuid(), startAt: z.string().datetime(), endAt: z.string().datetime().optional(),
    }),
    async handler(ctx, input) {
      const i = input as { id: string; startAt: string; endAt?: string };
      await assertCanMutate(ctx, i.id);
      const event = await service.moveEvent(i.id, i.startAt, i.endAt);
      if (!event) throw new Error('Event not found');
      return event;
    },
  },
  {
    name: 'calendar.list_upcoming',
    description: 'List the next N upcoming event occurrences, optionally for one member.',
    inputSchema: z.object({ member_id: z.string().uuid().optional(), limit: z.number().int().positive().max(50).default(10) }),
    async handler(_ctx, input) {
      const i = input as { member_id?: string; limit: number };
      const events = await service.listUpcoming(i.member_id ?? null, i.limit);
      return { events };
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/calendar-mcp.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calendar/mcp.ts tests/calendar-mcp.test.ts
git commit -m "feat: add calendar MCP tools with child-scope enforcement"
```

---

