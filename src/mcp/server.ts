import { createMcpServer } from '@wyrhta/core/mcp';
import type { AuthAdapter, McpPrincipal } from '@wyrhta/core/mcp';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { collectMcpTools } from '../app.js';
import type { HeorthModule } from '../modules/registry.js';
import { identity } from '../wiring.js';
import { createApiKeyAuthAdapter } from './auth-adapter.js';

/**
 * Bridge Heorth's `McpAuthAdapter` (a plain `apiKey -> principal | null` function,
 * easy to unit test) into core's `AuthAdapter` shape (`resolve(): Promise<McpPrincipal>`,
 * no argument, throws on failure). Core's scaffold builds one `McpServer` per
 * `AuthAdapter`, so the raw key for a single HTTP request is closed over here.
 */
function toCoreAuthAdapter(
  resolve: (apiKey: string) => Promise<{ userId: string; role: McpPrincipal['role'] } | null>,
  rawKey: string | undefined,
): AuthAdapter {
  return {
    async resolve(): Promise<McpPrincipal> {
      if (!rawKey) throw new Error('MCP_UNAUTHORIZED');
      const principal = await resolve(rawKey);
      if (!principal) throw new Error('MCP_UNAUTHORIZED');
      return principal;
    },
  };
}

function extractApiKey(req: Request): string | undefined {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

/**
 * Assemble the single per-instance MCP server from every module's contributed
 * tool registry, wired to the `he_` API-key auth adapter. Tools stay namespaced
 * per module (household.*, calendar.*, meals.*, feoh.*).
 *
 * Core's `createMcpServer` returns an SDK `McpServer` (not a Web `fetch` handler),
 * and its `AuthAdapter` resolves a single caller with no per-call argument, so a
 * stateless MCP server + Web Standard Streamable HTTP transport is built fresh for
 * each incoming request, bound to that request's `Authorization: Bearer he_...` key.
 */
export function buildMcpServer(modules: HeorthModule[]): { fetch(req: Request): Promise<Response> } {
  const tools = collectMcpTools(modules).all();
  const resolve = createApiKeyAuthAdapter(identity);

  return {
    async fetch(req: Request): Promise<Response> {
      const rawKey = extractApiKey(req);
      const server = createMcpServer(tools, toCoreAuthAdapter(resolve, rawKey), {
        name: 'heorth',
        version: '0.1.0',
      });
      const transport = new WebStandardStreamableHTTPServerTransport();
      await server.connect(transport);
      return transport.handleRequest(req);
    },
  };
}
