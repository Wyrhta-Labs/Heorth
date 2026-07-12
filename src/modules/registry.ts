import type { Hono } from 'hono';
import type { McpTool } from '@wyrhta/core/mcp';

/** Mutable collection a module pushes its MCP tools into during registration. */
export class McpRegistry {
  private tools: McpTool[] = [];
  add(...tools: McpTool[]): void {
    this.tools.push(...tools);
  }
  all(): McpTool[] {
    return [...this.tools];
  }
}

/**
 * Module convention: each module exports `register(app, mcpRegistry)` mounting
 * its REST routes and contributing its MCP tools. Compile-time registration only.
 */
export interface HeorthModule {
  name: string;
  register(app: Hono, mcp: McpRegistry): void;
}
