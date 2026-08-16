import { z } from 'zod';
import type { McpTool, McpToolContext, McpToolResult } from '@wyrhta/core/mcp';
import type { Role } from '@wyrhta/core/identity';
import { assertNoneAreMaintenanceAdmin, assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
import * as service from './service.js';
import * as occ from './occurrences.js';
import * as itemCosts from './item-costs.js';
import { getAccountLedger } from './ledger.js';

/**
 * Heorth is a multi-member household (unlike single-user Feoh, whose copy of
 * this file requires an explicit `createdBy` party id and has no role gate):
 * writes are gated to admin/adult members via `assertCanWrite`, and the
 * actor is always derived from `ctx.principal.userId` — never taken from the
 * tool input — same split as the REST routes (`requireRole('admin', 'adult')`
 * + the auth principal). The maintenance-admin quarantine (see
 * `src/household/maintenance-admin.ts`) applies here too: neither the acting
 * member nor any split member may be the maintenance admin.
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
    return toolError('Finance writes require an admin or adult member');
  }
  return null;
}

/** Known occurrence state-machine errors, mapped to a classified tool-error
 *  result (not an unhandled throw) — mirrors routes.ts's OCC_ERRORS. */
const OCC_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND_BILL: 'Bill not found',
  NOT_FOUND_TRANSACTION: 'Transaction not found',
  NOT_AN_OCCURRENCE: 'dueDate is not an occurrence of this bill',
  ALREADY_PAID: 'Occurrence is already linked to a transaction',
  ALREADY_SKIPPED: 'Occurrence is skipped',
};
async function occCall(fn: () => Promise<void>): Promise<McpToolResult> {
  try {
    await fn();
    return result({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? OCC_ERROR_MESSAGES[e.message] : undefined;
    if (msg) return toolError(msg);
    throw e;
  }
}

/** Known item-cost linking errors, mapped to a classified tool-error result
 *  (not an unhandled throw) — mirrors routes.ts's COST_ERRORS. */
const COST_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND_TRANSACTION: 'Transaction not found',
  NOT_FOUND_ITEM: 'Item not found',
  ITEM_DECOMMISSIONED: 'Only disposal links are allowed on a decommissioned item',
  NOT_A_COST: 'Transaction has no envelope spending - transfers cannot be item costs',
  DUPLICATE_LINK: 'This link already exists (or purchase/disposal already linked)',
};

export const feohTools: McpTool[] = [
  {
    name: 'feoh.list_envelopes',
    description: 'List budget envelopes with their monthly budgets.',
    inputSchema: {},
    async handler() {
      return result({ envelopes: await service.listEnvelopes() });
    },
  },
  {
    name: 'feoh.record_transaction',
    description: 'Record a balanced double-entry transaction (postings must balance).',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      payee: z.string().min(1),
      memo: z.string().nullish(),
      amount: z.number(),
      postings: z.array(z.object({
        accountId: z.string().uuid().nullish(),
        envelopeId: z.string().uuid().nullish(),
        debit: z.number().nonnegative().default(0),
        credit: z.number().nonnegative().default(0),
      })).min(2),
      splits: z.array(z.object({ memberId: z.string().uuid(), share: z.number() })).default([]),
    },
    async handler(ctx: McpToolContext, input) {
      const gateError = assertCanWrite(ctx);
      if (gateError) return gateError;
      await assertNotMaintenanceAdmin(ctx.principal.userId);
      const parsed = input as { splits?: Array<{ memberId: string }> };
      await assertNoneAreMaintenanceAdmin((parsed.splits ?? []).map((s) => s.memberId));
      try {
        return result(await service.recordTransaction(input as never, ctx.principal.userId));
      } catch (e) {
        if (e instanceof Error && e.message === 'UNBALANCED') throw new Error('Postings do not balance');
        if (e instanceof Error && e.message === 'ORPHAN_POSTING') throw new Error('Each posting must reference an account or envelope');
        throw e;
      }
    },
  },
  {
    name: 'feoh.get_month_summary',
    description: 'Return spend per envelope vs budget for a month (YYYY-MM).',
    inputSchema: { month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) },
    async handler(_ctx, input) {
      return result(await service.getMonthSummary((input as { month: string }).month));
    },
  },
  {
    name: 'feoh.list_recurring_bills',
    description: 'List recurring bills with cadence and next due date.',
    inputSchema: {},
    async handler() {
      return result({ bills: await service.listBills() });
    },
  },
  {
    name: 'feoh.import_csv',
    description: 'Import transactions from CSV text (date,payee,memo,amount,envelope,account).',
    inputSchema: { csv: z.string().min(1) },
    async handler(ctx: McpToolContext, input) {
      const gateError = assertCanWrite(ctx);
      if (gateError) return gateError;
      await assertNotMaintenanceAdmin(ctx.principal.userId);
      return result(await service.importTransactionsCsv((input as { csv: string }).csv, ctx.principal.userId));
    },
  },
  {
    name: 'feoh.export_ledger',
    description: 'Export all transactions as a readable plaintext ledger.',
    inputSchema: {},
    async handler() {
      return result({ ledger: await service.exportLedger() });
    },
  },
  {
    name: 'feoh.list_occurrences',
    description: 'List recurring-bill occurrences (planned/paid/overdue/skipped) in a date window. The "what is overdue" tool.',
    inputSchema: {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      billId: z.string().uuid().optional(),
      status: z.enum(['planned', 'paid', 'overdue', 'skipped', 'unknown']).optional(),
    },
    async handler(_ctx, input) {
      return result({ occurrences: await occ.listOccurrences(input as never) });
    },
  },
  {
    name: 'feoh.link_occurrence',
    description: 'Mark an occurrence paid by linking the settling transaction.',
    inputSchema: {
      billId: z.string().uuid(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      transactionId: z.string().uuid(),
    },
    async handler(ctx: McpToolContext, input) {
      const gateError = assertCanWrite(ctx);
      if (gateError) return gateError;
      await assertNotMaintenanceAdmin(ctx.principal.userId);
      return occCall(() => occ.linkOccurrence(input as never));
    },
  },
  {
    name: 'feoh.skip_occurrence',
    description: 'Skip one occurrence of a recurring bill.',
    inputSchema: {
      billId: z.string().uuid(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    async handler(ctx: McpToolContext, input) {
      const gateError = assertCanWrite(ctx);
      if (gateError) return gateError;
      await assertNotMaintenanceAdmin(ctx.principal.userId);
      return occCall(() => occ.skipOccurrence(input as never));
    },
  },
  {
    name: 'feoh.get_item_costs',
    description: 'Return the total-cost-of-ownership breakdown (capital, tier-2 costs, recurring, proceeds) for an inventory item.',
    inputSchema: { itemId: z.string().uuid() },
    async handler(_ctx, input) {
      const breakdown = await itemCosts.getItemCosts((input as { itemId: string }).itemId);
      if (!breakdown) return toolError('Item not found');
      return result(breakdown);
    },
  },
  {
    name: 'feoh.account_ledger',
    description: 'Return an account\'s ledger entries with a running balance, plus opening/end balance for the window (read-only).',
    inputSchema: {
      accountId: z.string().uuid(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    async handler(_ctx, input) {
      const parsed = input as { accountId: string; from?: string; to?: string };
      const ledger = await getAccountLedger(parsed.accountId, { from: parsed.from, to: parsed.to });
      if (!ledger) return toolError('Account not found');
      return result(ledger);
    },
  },
  {
    name: 'feoh.link_item_cost',
    description: 'Link a transaction to an inventory item as a cost (purchase, disposal, repair, maintenance, accessory).',
    inputSchema: {
      transactionId: z.string().uuid(),
      itemId: z.string().uuid(),
      kind: z.enum(['purchase', 'disposal', 'repair', 'maintenance', 'accessory']),
    },
    async handler(ctx: McpToolContext, input) {
      const gateError = assertCanWrite(ctx);
      if (gateError) return gateError;
      await assertNotMaintenanceAdmin(ctx.principal.userId);
      try {
        return result(await itemCosts.createItemCost(input as never));
      } catch (e: unknown) {
        const msg = e instanceof Error ? COST_ERROR_MESSAGES[e.message] : undefined;
        if (msg) return toolError(msg);
        throw e;
      }
    },
  },
];
