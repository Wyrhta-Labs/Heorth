### Task 3.3: Calendar REST routes + module registration (with child scope guard)

**Files:**
- Create: `src/modules/calendar/routes.ts`, `src/modules/calendar/mcp.ts` (placeholder), `src/modules/calendar/index.ts`
- Modify: `src/modules/index.ts`
- Test: `tests/calendar-routes.test.ts`

**Interfaces:**
- Consumes: calendar service, `ok`/`err`, `requireAuth`, auth context.
- Produces: `calendarModule: HeorthModule`; REST under `/api/v1/events`. Placeholder `export const calendarTools: McpTool[] = [];` filled in Task 3.4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/calendar-routes.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { calendarModule } from '../src/modules/calendar/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, calendarModule]);

async function makeEvent(jwt: string, title = 'Event') {
  const res = await app.request('/api/v1/events', {
    method: 'POST', headers: authHeaders(jwt),
    body: JSON.stringify({ title, startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T10:00:00Z' }),
  });
  return res;
}

describe('calendar routes', () => {
  it('creates and lists events in a range', async () => {
    const { admin } = await seedTestHousehold();
    await makeEvent(admin.jwt);
    const list = await app.request('/api/v1/events?from=2026-07-01T00:00:00Z&to=2026-07-31T00:00:00Z', {
      headers: authHeaders(admin.jwt),
    });
    expect(list.status).toBe(200);
    const body = await list.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('lets a child edit their own event but not another member event', async () => {
    const { admin, child } = await seedTestHousehold();
    const childEventRes = await makeEvent(child.jwt, 'Kid practice');
    const { data: childEvent } = await childEventRes.json() as { data: { id: string } };
    const adminEventRes = await makeEvent(admin.jwt, 'Bills');
    const { data: adminEvent } = await adminEventRes.json() as { data: { id: string } };

    const own = await app.request(`/api/v1/events/${childEvent.id}`, {
      method: 'PATCH', headers: authHeaders(child.jwt), body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(own.status).toBe(200);

    const other = await app.request(`/api/v1/events/${adminEvent.id}`, {
      method: 'PATCH', headers: authHeaders(child.jwt), body: JSON.stringify({ title: 'Nope' }),
    });
    expect(other.status).toBe(403);
  });

  it('moves an event', async () => {
    const { admin } = await seedTestHousehold();
    const { data } = await (await makeEvent(admin.jwt)).json() as { data: { id: string } };
    const moved = await app.request(`/api/v1/events/${data.id}/move`, {
      method: 'POST', headers: authHeaders(admin.jwt), body: JSON.stringify({ startAt: '2026-07-11T14:00:00Z' }),
    });
    expect(moved.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/calendar-routes.test.ts`
Expected: FAIL — `calendarModule` not found.

- [ ] **Step 3: Write `src/modules/calendar/routes.ts`**

```ts
import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '@wyrhta/core/auth';
import * as service from './service.js';
import { createEventSchema, updateEventSchema, moveEventSchema, listEventsQuerySchema } from './validators.js';

export const calendarRouter = new Hono();
calendarRouter.use('*', requireAuth);

/** Child may only mutate events they created. */
async function assertCanMutate(c: Parameters<typeof requireAuth>[0], id: string): Promise<Response | null> {
  const auth = c.get('auth');
  if (auth.role !== 'child') return null;
  const owner = await service.getEventOwner(id);
  if (owner === null) return err(c, 'NOT_FOUND', 'Event not found', 404);
  if (owner !== auth.userId) return err(c, 'FORBIDDEN', 'Children may only edit their own events', 403);
  return null;
}

calendarRouter.get('/', async (c) => {
  const q = listEventsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const { rows, total, limit, offset } = await service.listEvents(q.data);
  return ok(c, rows, { total, limit, offset });
});

calendarRouter.post('/', async (c) => {
  const body = createEventSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const event = await service.createEvent(body.data, c.get('auth').userId);
  return ok(c, event, undefined, 201);
});

calendarRouter.get('/:id', async (c) => {
  const event = await service.getEvent(c.req.param('id'));
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, event);
});

calendarRouter.patch('/:id', async (c) => {
  const blocked = await assertCanMutate(c, c.req.param('id'));
  if (blocked) return blocked;
  const body = updateEventSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const event = await service.updateEvent(c.req.param('id'), body.data);
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, event);
});

calendarRouter.post('/:id/move', async (c) => {
  const blocked = await assertCanMutate(c, c.req.param('id'));
  if (blocked) return blocked;
  const body = moveEventSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const event = await service.moveEvent(c.req.param('id'), body.data.startAt, body.data.endAt);
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, event);
});

calendarRouter.delete('/:id', async (c) => {
  const blocked = await assertCanMutate(c, c.req.param('id'));
  if (blocked) return blocked;
  const event = await service.deleteEvent(c.req.param('id'));
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, { id: event.id });
});
```

- [ ] **Step 4: Write `src/modules/calendar/mcp.ts` (placeholder) and `src/modules/calendar/index.ts`**

`src/modules/calendar/mcp.ts`:
```ts
import type { McpTool } from '@wyrhta/core/mcp';
export const calendarTools: McpTool[] = [];
```

`src/modules/calendar/index.ts`:
```ts
import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { calendarRouter } from './routes.js';
import { calendarTools } from './mcp.js';

export const calendarModule: HeorthModule = {
  name: 'calendar',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/events', calendarRouter);
    mcp.add(...calendarTools);
  },
};
```

- [ ] **Step 5: Register in `src/modules/index.ts`**

```ts
import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';
import { calendarModule } from './calendar/index.js';

export const ALL_MODULES: HeorthModule[] = [
  householdModule,
  calendarModule,
];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/calendar-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/modules/calendar/routes.ts src/modules/calendar/mcp.ts src/modules/calendar/index.ts src/modules/index.ts tests/calendar-routes.test.ts
git commit -m "feat: add calendar REST routes with child-scope guard and register module"
```

---

