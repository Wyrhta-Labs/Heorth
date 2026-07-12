import { apiGet, apiPost, apiPatch, apiDelete, apiGetText, apiPostText, qs } from './client';
import type {
  SingleResponse, ListResponse, Account, Envelope, Transaction, TransactionDetail,
  RecurringBill, MonthSummary,
} from '@/lib/types';

export interface AccountInput { name: string; kind: 'asset' | 'liability'; openingBalance?: number; }
export interface EnvelopeInput { name: string; monthlyBudget?: number; tone?: string | null; }
export interface PostingInput { accountId?: string | null; envelopeId?: string | null; debit?: number; credit?: number; }
export interface TransactionInput {
  date: string; payee: string; memo?: string | null; amount: number;
  postings: PostingInput[]; splits?: { memberId: string; share: number }[];
}
export interface BillInput { payee: string; amount: number; cadence: string; nextDue: string; envelopeId?: string | null; }

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
