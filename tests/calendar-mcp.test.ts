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
