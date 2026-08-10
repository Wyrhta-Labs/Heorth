import { describe, it, expect } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { identity } from '../src/wiring.js';
import { seedTestHousehold, collectMcpTools } from './helpers.js';

/**
 * End-to-end MCP-over-HTTP handshake: drive the assembled `/mcp` transport with
 * real JSON-RPC requests (initialize -> tools/call) exactly as an MCP client
 * would, and assert the round-tripped responses. The transport runs stateless
 * (a fresh server per request), so each JSON-RPC message is a self-contained
 * HTTP POST; the SDK answers each independently.
 */

const server = buildMcpServer(collectMcpTools(ALL_MODULES));

/** Parse a Streamable-HTTP SSE response body into its single JSON-RPC message. */
function parseSse(body: string): any {
  const line = body.split('\n').find((l) => l.startsWith('data:'));
  if (!line) throw new Error(`no SSE data line in body: ${body}`);
  return JSON.parse(line.slice('data:'.length).trim());
}

async function rpc(key: string | undefined, message: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  const res = await server.fetch(
    new Request('http://local/mcp', { method: 'POST', headers, body: JSON.stringify(message) }),
  );
  const text = await res.text();
  return { status: res.status, json: text.trim() ? parseSse(text) : undefined };
}

const INIT = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0.0.0' } },
};

describe('MCP-over-HTTP e2e handshake', () => {
  it('answers an initialize handshake identifying the heorth server', async () => {
    const { admin } = await seedTestHousehold();
    const key = await identity.createApiKey(admin.user.id, 'e2e');

    const { status, json } = await rpc(key.key, INIT);
    expect(status).toBe(200);
    expect(json.result.serverInfo).toEqual({ name: 'heorth', version: '0.1.0' });
    expect(json.result.protocolVersion).toBeTruthy();
    expect(json.result.capabilities.tools).toBeTruthy();
  });

  it('round-trips a tools/call for household.whoami back to the caller identity', async () => {
    const { admin } = await seedTestHousehold();
    const key = await identity.createApiKey(admin.user.id, 'e2e');

    await rpc(key.key, INIT);
    const { status, json } = await rpc(key.key, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'household.whoami', arguments: {} },
    });
    expect(status).toBe(200);
    const whoami = JSON.parse(json.result.content[0].text);
    expect(whoami.id).toBe(admin.user.id);
    expect(whoami.role).toBe('admin');
  });

  it('rejects a tools/call carrying an unknown API key', async () => {
    await seedTestHousehold();
    const { json } = await rpc('he_deadbeefdeadbeef', {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'household.whoami', arguments: {} },
    });
    // Auth failure surfaces as a JSON-RPC error (never a successful result).
    expect(json.error ?? json.result?.isError).toBeTruthy();
    expect(json.result?.content?.[0]?.text).not.toContain(`"role":"admin"`);
  });
});
