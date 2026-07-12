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
