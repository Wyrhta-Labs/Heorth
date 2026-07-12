import { z } from 'zod';
import type { McpTool, McpToolContext, McpToolResult } from '@wyrhta/core/mcp';
import * as service from './service.js';

/** Wrap any JSON-serialisable value as an MCP text tool-result. */
function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function assertCanWrite(ctx: McpToolContext): void {
  if (ctx.principal.role === 'child') throw new Error('Children may not edit finances');
}

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
    async handler(ctx, input) {
      assertCanWrite(ctx);
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
    inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/) },
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
    async handler(ctx, input) {
      assertCanWrite(ctx);
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
];
