import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { createApiKeyAuthAdapter } from '../src/mcp/auth-adapter.js';
import { identity } from '../src/wiring.js';
import { seedTestHousehold, invokeTool, collectMcpTools } from './helpers.js';

describe('assembled MCP server', () => {
  it('exposes namespaced tools from every module', () => {
    const names = collectMcpTools(ALL_MODULES).all().map((t) => t.name);
    // Cross-module reachability: at least one tool from each namespace is present.
    // feoh.* is always registered (ADR 0007, gate removed 2026-08-16).
    expect(names).toContain('household.whoami');
    expect(names).toContain('calendar.list_events');
    expect(names).toContain('meals.list_recipes');
    expect(names).toContain('feoh.record_transaction');
    expect(names).toContain('feoh.list_occurrences');
    expect(names).toContain('feoh.link_occurrence');
    expect(names).toContain('feoh.skip_occurrence');
    // Every tool is namespaced module.tool.
    for (const n of names) expect(n).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it('builds a server with a working fetch transport', () => {
    const server = buildMcpServer(collectMcpTools(ALL_MODULES));
    expect(typeof server.fetch).toBe('function');
  });

  it('resolves an he_ API key to the member + role, and rejects an unknown key', async () => {
    const { admin } = await seedTestHousehold();
    const key = await identity.createApiKey(admin.user.id, 'agent');
    const adapter = createApiKeyAuthAdapter(identity);

    const resolved = await adapter(key.key);
    expect(resolved).toEqual({ userId: admin.user.id, role: 'admin' });
    expect(key.key.startsWith('he_')).toBe(true);

    const bad = await adapter('he_deadbeef');
    expect(bad).toBeNull();
  });

  it('enforces roles end-to-end: a child key cannot edit another member’s event', async () => {
    const { adult, child } = await seedTestHousehold();
    const key = await identity.createApiKey(child.user.id, 'kid-agent');
    const adapter = createApiKeyAuthAdapter(identity);

    // 1) The child's he_ key resolves to a child role.
    const ctx = await adapter(key.key);
    expect(ctx?.role).toBe('child');

    // 2) A role guard in the assembled registry rejects that resolved context:
    //    a child may not edit an event owned by another member.
    const tools = collectMcpTools(ALL_MODULES).all();
    const created = await invokeTool(tools, 'calendar.create_event',
      { userId: adult.user.id, role: 'adult' },
      { title: 'Board meeting', startAt: '2026-07-05T09:00:00Z', endAt: '2026-07-05T10:00:00Z' }) as { id: string };
    await expect(
      invokeTool(tools, 'calendar.update_event',
        { userId: ctx!.userId, role: ctx!.role },
        { id: created.id, title: 'Hijacked' }),
    ).rejects.toThrow(/own events/);
  });

  it('a REST app built from the same modules still answers health', async () => {
    const app = createApp(ALL_MODULES);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
