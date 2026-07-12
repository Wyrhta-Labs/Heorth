import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { householdTools } from '../src/household/mcp.js';
import type { McpTool, McpToolContext } from '@wyrhta/core/mcp';

function tool(name: string): McpTool {
  const t = householdTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

function unwrap(res: Awaited<ReturnType<McpTool['handler']>>): any {
  return JSON.parse(res.content[0]!.text);
}

describe('household MCP tools', () => {
  it('household.get_members returns all members', async () => {
    await seedTestHousehold();
    const ctx: McpToolContext = { principal: { userId: 'x', role: 'adult' }, requestId: 'r' };
    const data = unwrap(await tool('household.get_members').handler(ctx, {}));
    expect(data.members.length).toBe(3);
  });

  it('household.whoami returns the calling member', async () => {
    const { child } = await seedTestHousehold();
    const ctx: McpToolContext = { principal: { userId: child.user.id, role: 'child' }, requestId: 'r' };
    const data = unwrap(await tool('household.whoami').handler(ctx, {}));
    expect(data.id).toBe(child.user.id);
    expect(data.role).toBe('child');
  });
});
