// Mirrors tests/feoh-mcp.test.ts's bootstrap for the inventory module's four
// MCP tools: list_items, get_item, record_item, decommission_item.
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, invokeTool, collectMcpTools } from './helpers.js';
import { inventoryTools } from '../src/modules/inventory/mcp.js';
import { ALL_MODULES } from '../src/modules/index.js';

describe('inventory MCP tools (unit-level, direct handler invocation)', () => {
  it('records an item (admin principal), lists it, and gets it by id', async () => {
    const { admin } = await seedTestHousehold();

    const created = await invokeTool(inventoryTools, 'inventory.record_item',
      { userId: admin.user.id, role: 'admin' },
      { name: 'Dishwasher', category: 'appliance' }) as { id: string; name: string };
    expect(created.name).toBe('Dishwasher');

    const listed = await invokeTool(inventoryTools, 'inventory.list_items',
      { userId: admin.user.id, role: 'admin' },
      {}) as { rows: Array<{ id: string }> };
    expect(listed.rows.some((r) => r.id === created.id)).toBe(true);

    const got = await invokeTool(inventoryTools, 'inventory.get_item',
      { userId: admin.user.id, role: 'admin' },
      { id: created.id }) as { id: string; name: string };
    expect(got.name).toBe('Dishwasher');
  });

  it('returns a classified tool-error result (not a throw) for a child-role principal calling record_item', async () => {
    const { child } = await seedTestHousehold();

    const tool = inventoryTools.find((t) => t.name === 'inventory.record_item')!;
    const res = await tool.handler(
      { principal: { userId: child.user.id, role: 'child' }, requestId: 'test' },
      { name: 'Dishwasher' },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/admin or adult/);
  });

  it('decommissions an item once; a second decommission attempt returns a classified tool-error', async () => {
    const { admin } = await seedTestHousehold();

    const created = await invokeTool(inventoryTools, 'inventory.record_item',
      { userId: admin.user.id, role: 'admin' },
      { name: 'Old Fridge' }) as { id: string };

    const decommissioned = await invokeTool(inventoryTools, 'inventory.decommission_item',
      { userId: admin.user.id, role: 'admin' },
      { id: created.id, date: '2026-08-01', reason: 'broken' }) as { decommissionedAt: string };
    expect(decommissioned.decommissionedAt).toBeTruthy();

    const tool = inventoryTools.find((t) => t.name === 'inventory.decommission_item')!;
    const res = await tool.handler(
      { principal: { userId: admin.user.id, role: 'admin' }, requestId: 'test' },
      { id: created.id, date: '2026-08-02', reason: 'broken' },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/already decommissioned/);
  });

  it('returns a classified tool-error for an unknown item id', async () => {
    const { admin } = await seedTestHousehold();

    const tool = inventoryTools.find((t) => t.name === 'inventory.get_item')!;
    const res = await tool.handler(
      { principal: { userId: admin.user.id, role: 'admin' }, requestId: 'test' },
      { id: '00000000-0000-0000-0000-000000000000' },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/not found/);
  });
});

describe('inventory MCP tools registered in the assembled registry (createApp)', () => {
  it('contains exactly the four inventory.* tools', () => {
    const tools = collectMcpTools(ALL_MODULES).all();
    const inventoryToolNames = tools.filter((t) => t.name.startsWith('inventory.')).map((t) => t.name);
    expect(inventoryToolNames.sort()).toEqual([
      'inventory.decommission_item',
      'inventory.get_item',
      'inventory.list_items',
      'inventory.record_item',
    ]);
  });
});
