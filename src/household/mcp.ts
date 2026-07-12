import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as service from './service.js';

/** Wrap any JSON-serialisable value as an MCP text tool-result. */
function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const householdTools: McpTool[] = [
  {
    name: 'household.get_members',
    description: 'List every member of the household with their role and profile.',
    inputSchema: {},
    async handler() {
      const members = await service.listMembers();
      return result({ members });
    },
  },
  {
    name: 'household.whoami',
    description: 'Return the member identity behind the current API key.',
    inputSchema: {},
    async handler(ctx) {
      const member = await service.getMember(ctx.principal.userId);
      if (!member) throw new Error('NOT_FOUND');
      return result(member);
    },
  },
];
