import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import * as occurrences from '../src/modules/feoh/occurrences.js';
import * as inventoryService from '../src/modules/inventory/service.js';
import * as itemCosts from '../src/modules/feoh/item-costs.js';

async function setup() {
  const { adult } = await seedTestHousehold();
  const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
  const account2 = await service.createAccount({ name: 'Savings', kind: 'asset', openingBalance: 0 });
  const envelope = await service.createEnvelope({ name: 'Household', monthlyBudget: 400 });
  const envelope2 = await service.createEnvelope({ name: 'Repairs', monthlyBudget: 100 });
  return { adult, account, account2, envelope, envelope2 };
}

/** Standard feoh expense shape: envelope debit / account credit. */
async function expenseTx(
  adultId: string, envelopeId: string, accountId: string, amount: number, opts: { date?: string; payee?: string; recordedAmount?: number } = {},
) {
  const result = await service.recordTransaction({
    date: opts.date ?? '2026-08-01', payee: opts.payee ?? 'Expense',
    amount: opts.recordedAmount ?? amount, memo: null,
    postings: [
      { envelopeId, accountId: null, debit: amount, credit: 0 },
      { accountId, envelopeId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, adultId);
  return result.transaction;
}

/** Account-to-account transfer: no envelope posting. */
async function transferTx(adultId: string, accountId: string, account2Id: string, amount: number) {
  const result = await service.recordTransaction({
    date: '2026-08-01', payee: 'Transfer', amount, memo: null,
    postings: [
      { accountId, envelopeId: null, debit: amount, credit: 0 },
      { accountId: account2Id, envelopeId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, adultId);
  return result.transaction;
}

/** Envelope reallocation: no account posting. */
async function reallocTx(adultId: string, envelopeId: string, envelope2Id: string, amount: number) {
  const result = await service.recordTransaction({
    date: '2026-08-01', payee: 'Reallocate', amount, memo: null,
    postings: [
      { envelopeId, accountId: null, debit: amount, credit: 0 },
      { envelopeId: envelope2Id, accountId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, adultId);
  return result.transaction;
}

function yearsAgoIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe('feoh item costs / TCO', () => {
  it('counts a tier-2 link on an expense into the TCO totals and perYear', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({
      name: 'Laptop', purchasePrice: 599, purchaseDate: yearsAgoIso(2),
    });
    const repairTx = await expenseTx(adult.user.id, envelope.id, account.id, 180, { payee: 'Repair shop' });
    await itemCosts.createItemCost({ transactionId: repairTx.id, itemId: item.id, kind: 'repair' });

    const breakdown = await itemCosts.getItemCosts(item.id);
    expect(breakdown!.totals.capital).toBe(599);
    expect(breakdown!.totals.tier2).toBe(180);
    expect(breakdown!.totals.total).toBe(779);
    expect(breakdown!.totals.perYear).not.toBeNull();
    expect(Math.abs(breakdown!.totals.perYear! - 779 / 2)).toBeLessThan(1);
  });

  it('ignores transactions.amount and uses the actual posting size', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Fridge' });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 50, { recordedAmount: 999 });
    await itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'repair' });

    const breakdown = await itemCosts.getItemCosts(item.id);
    expect(breakdown!.totals.tier2).toBe(50);
  });

  it('rejects tier-2 links on transactions with no cost size, but allows provenance-exempt purchase/disposal', async () => {
    const { adult, account, account2, envelope, envelope2 } = await setup();
    const item = await inventoryService.createItem({ name: 'Camera' });

    const transfer = await transferTx(adult.user.id, account.id, account2.id, 300);
    await expect(itemCosts.createItemCost({ transactionId: transfer.id, itemId: item.id, kind: 'repair' }))
      .rejects.toThrow('NOT_A_COST');
    // provenance-exempt: purchase is allowed even on a transfer-shaped transaction
    const purchaseLink = await itemCosts.createItemCost({ transactionId: transfer.id, itemId: item.id, kind: 'purchase' });
    expect(purchaseLink.kind).toBe('purchase');

    const item2 = await inventoryService.createItem({ name: 'Camera 2' });
    const realloc = await reallocTx(adult.user.id, envelope.id, envelope2.id, 40);
    await expect(itemCosts.createItemCost({ transactionId: realloc.id, itemId: item2.id, kind: 'repair' }))
      .rejects.toThrow('NOT_A_COST');
  });

  it('rejects duplicate (transactionId, itemId) links and duplicate capital links per item', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Drone' });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 100);
    await itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'repair' });
    await expect(itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'maintenance' }))
      .rejects.toThrow('DUPLICATE_LINK');

    const txn2 = await expenseTx(adult.user.id, envelope.id, account.id, 200, { payee: 'Purchase 1' });
    await itemCosts.createItemCost({ transactionId: txn2.id, itemId: item.id, kind: 'purchase' });
    const txn3 = await expenseTx(adult.user.id, envelope.id, account.id, 210, { payee: 'Purchase 2' });
    await expect(itemCosts.createItemCost({ transactionId: txn3.id, itemId: item.id, kind: 'purchase' }))
      .rejects.toThrow('DUPLICATE_LINK');
  });

  it('rejects new tier-2 links on a decommissioned item, but allows disposal', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Mower' });
    await inventoryService.decommissionItem(item.id, { date: '2026-08-01', reason: 'sold', proceeds: 50 });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 30);
    await expect(itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'repair' }))
      .rejects.toThrow('ITEM_DECOMMISSIONED');
    const disposalLink = await itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'disposal' });
    expect(disposalLink.kind).toBe('disposal');
  });

  it('counts a paid recurring occurrence once, attributed to tier2 when also cost-linked', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Boiler' });
    const bill = await service.createBill({
      payee: 'Boiler service', amount: 12, cadence: 'monthly', nextDue: '2026-09-01', inventoryItemId: item.id,
    });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 12, { date: bill.nextDue, payee: 'Boiler service' });
    await occurrences.linkOccurrence({ billId: bill.id, dueDate: bill.nextDue, transactionId: txn.id });
    await itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'repair' });

    const breakdown = await itemCosts.getItemCosts(item.id);
    expect(breakdown!.totals.tier2).toBe(12);
    expect(breakdown!.totals.recurring).toBe(0);
  });

  it('subtracts disposalProceeds from the total', async () => {
    const item = await inventoryService.createItem({ name: 'Old Sofa', purchasePrice: 100 });
    await inventoryService.decommissionItem(item.id, { date: '2026-08-01', reason: 'sold', proceeds: 30 });
    const breakdown = await itemCosts.getItemCosts(item.id);
    expect(breakdown!.totals.proceeds).toBe(30);
    expect(breakdown!.totals.total).toBe(70);
  });

  it('returns null perYear/lifetimeDays when the item has no purchaseDate', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Toaster' });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 20);
    await itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'repair' });
    const breakdown = await itemCosts.getItemCosts(item.id);
    expect(breakdown!.totals.perYear).toBeNull();
    expect(breakdown!.totals.lifetimeDays).toBeNull();
  });

  it('createItemCost throws NOT_FOUND_TRANSACTION / NOT_FOUND_ITEM; deleteItemCost removes a link; getItemCosts returns null for an unknown item', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Blender' });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 15);
    await expect(itemCosts.createItemCost({ transactionId: '00000000-0000-0000-0000-000000000000', itemId: item.id, kind: 'repair' }))
      .rejects.toThrow('NOT_FOUND_TRANSACTION');
    await expect(itemCosts.createItemCost({ transactionId: txn.id, itemId: '00000000-0000-0000-0000-000000000000', kind: 'repair' }))
      .rejects.toThrow('NOT_FOUND_ITEM');

    const link = await itemCosts.createItemCost({ transactionId: txn.id, itemId: item.id, kind: 'repair' });
    const deleted = await itemCosts.deleteItemCost(link.id);
    expect(deleted!.id).toBe(link.id);
    const breakdown = await itemCosts.getItemCosts(item.id);
    expect(breakdown!.totals.tier2).toBe(0);

    expect(await itemCosts.getItemCosts('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
