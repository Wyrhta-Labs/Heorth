import { z } from 'zod';
import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import type { Role } from '@wyrhta/core/identity';
import * as service from './service.js';
import { decommissionReasons, type DecommissionReason } from './validators.js';

/**
 * Copied from src/modules/feoh/mcp.ts's `result`/`toolError`/`assertCanWrite`
 * idiom: writes are gated to admin/adult members, mirroring the REST routes'
 * `requireRole('admin', 'adult')` guard.
 */

/** Wrap any JSON-serialisable value as an MCP text tool-result. */
function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** Wrap a message as a classified MCP tool-error result (not an unhandled throw). */
function toolError(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function assertCanWrite(ctx: { principal: { userId: string; role: Role } }): McpToolResult | null {
  if (ctx.principal.role !== 'admin' && ctx.principal.role !== 'adult') {
    return toolError('Inventory writes require an admin or adult member');
  }
  return null;
}

export const inventoryTools: McpTool[] = [
  {
    name: 'inventory.list_items',
    description: 'List household inventory items (filter by status/category/search).',
    inputSchema: {
      status: z.enum(['active', 'decommissioned']).optional(),
      category: z.string().optional(),
      q: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async handler(_ctx, input) {
      return result(await service.listItems(input as never));
    },
  },
  {
    name: 'inventory.get_item',
    description: 'Get one inventory item by id (lifecycle fields included).',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      const row = await service.getItem((input as { id: string }).id);
      return row ? result(row) : toolError('Item not found');
    },
  },
  {
    name: 'inventory.record_item',
    description: 'Create an inventory item (name required; purchase fields optional).',
    inputSchema: {
      name: z.string().min(1),
      category: z.string().optional().nullable(),
      manufacturer: z.string().optional().nullable(),
      model: z.string().optional().nullable(),
      serialNumber: z.string().optional().nullable(),
      location: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      warrantyUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      purchasePrice: z.number().nonnegative().optional().nullable(),
      purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    },
    async handler(ctx, input) {
      const gate = assertCanWrite(ctx);
      if (gate) return gate;
      return result(await service.createItem(input as never));
    },
  },
  {
    name: 'inventory.decommission_item',
    description: 'Decommission an item (date, reason; optional proceeds). Inventory fields only - link a sale transaction separately via feoh.link_item_cost.',
    inputSchema: {
      id: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.enum(decommissionReasons),
      proceeds: z.number().nonnegative().optional(),
    },
    async handler(ctx, input) {
      const gate = assertCanWrite(ctx);
      if (gate) return gate;
      const { id, ...rest } = input as { id: string; date: string; reason: DecommissionReason; proceeds?: number };
      try {
        const row = await service.decommissionItem(id, rest);
        return row ? result(row) : toolError('Item not found');
      } catch (e) {
        if (e instanceof Error && e.message === 'ALREADY_DECOMMISSIONED') return toolError('Item is already decommissioned');
        throw e;
      }
    },
  },
];
