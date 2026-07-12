### Task 1.3: Household MCP tools

**Files:**
- Modify: `src/household/mcp.ts`
- Test: `tests/household-mcp.test.ts`

**Interfaces:**
- Consumes: household service, `McpTool`/`McpToolContext`.
- Produces: `householdTools: McpTool[]` — `household.get_members`, `household.whoami`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/household-mcp.test.ts
import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { householdTools } from '../src/household/mcp.js';
import type { McpTool, McpToolContext } from '@wyrhta/core/mcp';

function tool(name: string): McpTool {
  const t = householdTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

describe('household MCP tools', () => {
  it('household.get_members returns all members', async () => {
    await seedTestHousehold();
    const ctx: McpToolContext = { userId: 'x', role: 'adult', requestId: 'r' };
    const result = await tool('household.get_members').handler(ctx, {}) as { members: unknown[] };
    expect(result.members.length).toBe(3);
  });

  it('household.whoami returns the calling member', async () => {
    const { child } = await seedTestHousehold();
    const ctx: McpToolContext = { userId: child.user.id, role: 'child', requestId: 'r' };
    const result = await tool('household.whoami').handler(ctx, {}) as { id: string; role: string };
    expect(result.id).toBe(child.user.id);
    expect(result.role).toBe('child');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/household-mcp.test.ts`
Expected: FAIL — tools not registered (placeholder is empty).

- [ ] **Step 3: Replace `src/household/mcp.ts`**

```ts
import { z } from 'zod';
import type { McpTool } from '@wyrhta/core/mcp';
import * as service from './service.js';

export const householdTools: McpTool[] = [
  {
    name: 'household.get_members',
    description: 'List every member of the household with their role and profile.',
    inputSchema: z.object({}),
    async handler() {
      const members = await service.listMembers();
      return { members };
    },
  },
  {
    name: 'household.whoami',
    description: 'Return the member identity behind the current API key.',
    inputSchema: z.object({}),
    async handler(ctx) {
      const member = await service.getMember(ctx.userId);
      if (!member) throw new Error('Member not found');
      return member;
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/household-mcp.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/household/mcp.ts tests/household-mcp.test.ts
git commit -m "feat: add household MCP tools (get_members, whoami)"
```

---

