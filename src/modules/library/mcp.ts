import { z } from 'zod';
import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as service from './service.js';
import { MEDIA_TYPES, ITEM_STATUSES, STANDARD_LISTS, PROVIDERS } from './schema.js';

/** Wrap any JSON-serialisable value as an MCP text tool-result. */
function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const libraryTools: McpTool[] = [
  {
    name: 'library.list_items',
    description: 'List library items across the household, filtered by media type, member, provider, status, or standard list (later/favorites).',
    inputSchema: {
      mediaType: z.enum(MEDIA_TYPES).optional(),
      memberId: z.string().uuid().optional(),
      provider: z.enum(PROVIDERS).optional(),
      status: z.enum(ITEM_STATUSES).optional(),
      list: z.enum(STANDARD_LISTS).optional(),
      tag: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    async handler(_ctx, input) {
      const { rows, total } = await service.listItems(input as never);
      return result({ items: rows, total });
    },
  },
  {
    name: 'library.search',
    description: 'Full-text search library items by title or creator.',
    inputSchema: { q: z.string().min(1) },
    async handler(_ctx, input) {
      const items = await service.searchItems((input as { q: string }).q);
      return result({ items });
    },
  },
  {
    name: 'library.get_item',
    description: 'Get one library item by id, including owning member and source link.',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      const item = await service.getItem((input as { id: string }).id);
      if (!item) throw new Error('Item not found');
      return result(item);
    },
  },
  {
    name: 'library.list_connections',
    description: 'List connected library accounts and their sync status (never returns credentials).',
    inputSchema: {},
    async handler() {
      return result({ connections: await service.listConnections() });
    },
  },
  {
    name: 'library.sync_connection',
    description: 'Trigger a manual sync of one connected account.',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      return result(await service.syncConnection((input as { id: string }).id));
    },
  },
];
