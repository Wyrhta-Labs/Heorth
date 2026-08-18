import type { Hono } from 'hono';

/**
 * Module convention: each module exports `register(app)` mounting its REST
 * routes. Compile-time registration only.
 *
 * Heorth is REST-only since ADR 0008 — the MCP surface lives in its own
 * service (`Wyrhta-Labs/heorth-mcp`), a pure REST client, so modules no
 * longer contribute in-process MCP tools.
 */
export interface HeorthModule {
  name: string;
  register(app: Hono): void;
}
