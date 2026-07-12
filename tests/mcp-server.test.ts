import { describe, it, expect } from 'vitest';
import { collectMcpTools, createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { createApiKeyAuthAdapter } from '../src/mcp/auth-adapter.js';
import { identity } from '../src/wiring.js';
import { seedTestHousehold, invokeTool } from './helpers.js';
import * as feohService from '../src/modules/feoh/service.js';

describe('assembled MCP server', () => {
  it('exposes namespaced tools from every module', () => {
    const names = collectMcpTools(ALL_MODULES).all().map((t) => t.name);
    // Cross-module reachability: at least one tool from each namespace is present.
    expect(names).toContain('household.whoami');
    expect(names).toContain('calendar.list_events');
    expect(names).toContain('meals.list_recipes');
    expect(names).toContain('feoh.record_transaction');
    // Every tool is namespaced module.tool.
    for (const n of names) expect(n).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it('builds a server with a working fetch transport', () => {
    const server = buildMcpServer(ALL_MODULES);
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

  it('enforces roles end-to-end: a child key is rejected from a finance-write tool', async () => {
    const { child } = await seedTestHousehold();
    const key = await identity.createApiKey(child.user.id, 'kid-agent');
    const adapter = createApiKeyAuthAdapter(identity);

    // 1) The child's he_ key resolves to a child role.
    const ctx = await adapter(key.key);
    expect(ctx?.role).toBe('child');

    // 2) Invoking feoh.record_transaction from the assembled registry with that
    //    resolved context is rejected by the tool's finance-write guard.
    const account = await feohService.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await feohService.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    const tools = collectMcpTools(ALL_MODULES).all();
    await expect(
      invokeTool(tools, 'feoh.record_transaction',
        { userId: ctx!.userId, role: ctx!.role },
        {
          date: '2026-07-05', payee: 'Market', amount: 10,
          postings: [
            { envelopeId: envelope.id, debit: 10, credit: 0 },
            { accountId: account.id, debit: 0, credit: 10 },
          ],
        }),
    ).rejects.toThrow(/finances/);
  });

  it('a REST app built from the same modules still answers health', async () => {
    const app = createApp(ALL_MODULES);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
