import type { Role } from '@wyrhta/core/identity';
import { logEvent } from '@wyrhta/core/lib';

/** Resolves a raw API key to the calling member's id + role, or null if invalid. */
export type McpAuthAdapter = (apiKey: string) => Promise<{ userId: string; role: Role } | null>;

/**
 * The identity surface this adapter needs. Heorth's `identity.validateApiKey`
 * (src/wiring.ts) resolves a raw `he_` key to a `Principal` (`{ type, userId, role }`),
 * which structurally satisfies this narrower shape.
 */
export interface IdentityForMcp {
  validateApiKey(raw: string): Promise<{ userId: string; role: Role } | null>;
}

/**
 * Build the MCP auth adapter. Every MCP tool call resolves its `he_` API key to a
 * member + role through this adapter (the same identity path REST uses), and the
 * resolution is audit-logged. Per-tool role checks (e.g. Feoh child-write guard)
 * live in the tools themselves and run after this resolution.
 */
export function createApiKeyAuthAdapter(identity: IdentityForMcp): McpAuthAdapter {
  return async (rawKey: string) => {
    const principal = await identity.validateApiKey(rawKey);
    if (!principal) {
      logEvent({ event: 'mcp.auth.failure' });
      return null;
    }
    logEvent({ event: 'mcp.auth.success', member_id: principal.userId });
    return { userId: principal.userId, role: principal.role };
  };
}
