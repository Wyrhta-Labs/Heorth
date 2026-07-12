### Task 2.1: Convention smoke test & MCP tool-invocation helper

Codifies the `register(app, mcpRegistry)` contract (already realized by `householdModule`) and gives every later module test a uniform way to invoke MCP tools.

**Files:**
- Modify: `tests/helpers.ts` (add `invokeTool`)
- Test: `tests/module-convention.test.ts`

**Interfaces:**
- Produces: `invokeTool(tools, name, ctx, input)` helper; a smoke test asserting all registered modules expose `name` + `register` and produce only namespaced MCP tools.

- [ ] **Step 1: Add `invokeTool` to `tests/helpers.ts`**

```ts
// Append to tests/helpers.ts
import type { McpTool, McpToolContext } from '@wyrhta/core/mcp';

export function invokeTool(
  tools: McpTool[],
  name: string,
  ctx: Partial<McpToolContext> & { userId: string; role: McpToolContext['role'] },
  input: unknown,
): Promise<unknown> {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`MCP tool not found: ${name}`);
  const parsed = t.inputSchema.parse(input);
  return t.handler({ requestId: 'test', ...ctx }, parsed);
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/module-convention.test.ts
import { describe, it, expect } from 'vitest';
import { ALL_MODULES } from '../src/modules/index.js';
import { collectMcpTools } from '../src/app.js';

describe('module convention', () => {
  it('every module exposes a name and a register function', () => {
    for (const mod of ALL_MODULES) {
      expect(typeof mod.name).toBe('string');
      expect(typeof mod.register).toBe('function');
    }
  });

  it('all contributed MCP tools are namespaced (module.tool)', () => {
    const tools = collectMcpTools(ALL_MODULES).all();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- tests/module-convention.test.ts`
Expected: PASS (2 tests) — `householdModule` already satisfies the contract and its tools are namespaced `household.*`.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers.ts tests/module-convention.test.ts
git commit -m "test: add module-convention smoke test and MCP invoke helper"
```

---

