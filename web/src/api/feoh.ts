import { apiGet, apiPost, apiPatch, apiDelete, apiGetText, apiPostText, qs } from './client';
import type {
  SingleResponse, ListResponse, Account, Envelope, Transaction, TransactionDetail,
  RecurringBill, MonthSummary, OccurrenceEntry, OccurrenceStatus, ItemCostsBreakdown,
  ItemCostKind, FeohItemCost, LedgerEntry, LedgerMeta, ReconcileResult,
} from '@/lib/types';

export interface AccountInput { name: string; kind: 'asset' | 'liability'; openingBalance?: number; }
export interface EnvelopeInput { name: string; monthlyBudget?: number; tone?: string | null; }
export interface PostingInput { accountId?: string | null; envelopeId?: string | null; debit?: number; credit?: number; }
export interface TransactionInput {
  date: string; payee: string; memo?: string | null; amount: number;
  postings: PostingInput[]; splits?: { memberId: string; share: number }[];
}
export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
export interface BillInput {
  payee: string; amount: number; cadence: Cadence; nextDue: string;
  envelopeId?: string | null; inventoryItemId?: string | null;
}

export interface LinkOccurrenceInput { billId: string; dueDate: string; transactionId: string; }
export interface OccurrenceRefInput { billId: string; dueDate: string; }
export interface OverrideOccurrenceInput { billId: string; dueDate: string; amount: number | null; }
export interface CreateItemCostInput { transactionId: string; itemId: string; kind: ItemCostKind; }
export interface ReconcileInput { countedBalance: number; date: string; envelopeId: string; memo?: string | null; }

export function listAccounts(): Promise<SingleResponse<Account[]>> { return apiGet('/feoh/accounts'); }
export function createAccount(input: AccountInput): Promise<SingleResponse<Account>> { return apiPost('/feoh/accounts', input); }

export function listEnvelopes(): Promise<SingleResponse<Envelope[]>> { return apiGet('/feoh/envelopes'); }
export function createEnvelope(input: EnvelopeInput): Promise<SingleResponse<Envelope>> { return apiPost('/feoh/envelopes', input); }
export function updateEnvelope(id: string, input: Partial<EnvelopeInput>): Promise<SingleResponse<Envelope>> { return apiPatch(`/feoh/envelopes/${id}`, input); }
export function deleteEnvelope(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/feoh/envelopes/${id}`); }

export function getSummary(month: string): Promise<SingleResponse<MonthSummary>> { return apiGet(`/feoh/summary${qs({ month })}`); }

export function listTransactions(params: { from?: string; to?: string; limit?: number; offset?: number } = {}): Promise<ListResponse<Transaction>> {
  return apiGet(`/feoh/transactions${qs(params)}`);
}
export function recordTransaction(input: TransactionInput): Promise<SingleResponse<TransactionDetail>> { return apiPost('/feoh/transactions', input); }
export function deleteTransaction(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/feoh/transactions/${id}`); }

export function listBills(): Promise<SingleResponse<RecurringBill[]>> { return apiGet('/feoh/bills'); }
export function createBill(input: BillInput): Promise<SingleResponse<RecurringBill>> { return apiPost('/feoh/bills', input); }
export function deleteBill(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/feoh/bills/${id}`); }

export function exportCsv(): Promise<string> { return apiGetText('/feoh/export?format=csv'); }
export function exportLedger(): Promise<string> { return apiGetText('/feoh/export?format=ledger'); }
export function importCsv(csv: string): Promise<SingleResponse<{ imported: number }>> { return apiPostText('/feoh/import', csv); }

export function listOccurrences(
  params: { from?: string; to?: string; billId?: string; status?: OccurrenceStatus } = {},
): Promise<SingleResponse<OccurrenceEntry[]>> {
  return apiGet(`/feoh/occurrences${qs(params)}`);
}
export function linkOccurrence(input: LinkOccurrenceInput): Promise<SingleResponse<{ ok: true }>> { return apiPost('/feoh/occurrences/link', input); }
export function skipOccurrence(input: OccurrenceRefInput): Promise<SingleResponse<{ ok: true }>> { return apiPost('/feoh/occurrences/skip', input); }
export function unlinkOccurrence(input: OccurrenceRefInput): Promise<SingleResponse<{ ok: true }>> { return apiPost('/feoh/occurrences/unlink', input); }
export function unskipOccurrence(input: OccurrenceRefInput): Promise<SingleResponse<{ ok: true }>> { return apiPost('/feoh/occurrences/unskip', input); }
export function overrideOccurrence(input: OverrideOccurrenceInput): Promise<SingleResponse<{ ok: true }>> { return apiPatch('/feoh/occurrences/override', input); }

export function getItemCosts(itemId: string): Promise<SingleResponse<ItemCostsBreakdown>> { return apiGet(`/feoh/item-costs/${itemId}`); }
export function createItemCost(input: CreateItemCostInput): Promise<SingleResponse<FeohItemCost>> { return apiPost('/feoh/item-costs', input); }
export function deleteItemCost(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/feoh/item-costs/${id}`); }

export function getAccountLedger(
  id: string, params: { from?: string; to?: string; limit?: number; offset?: number } = {},
): Promise<{ data: LedgerEntry[]; meta: LedgerMeta }> {
  return apiGet(`/feoh/accounts/${id}/ledger${qs(params)}`);
}
export function reconcileAccount(id: string, input: ReconcileInput): Promise<SingleResponse<ReconcileResult>> {
  return apiPost(`/feoh/accounts/${id}/reconcile`, input);
}
