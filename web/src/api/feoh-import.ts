import { apiGet, apiPost, apiPatch, apiPut, apiDelete, qs } from './client';
import type {
  SingleResponse, ListResponse, ImportedTransaction, ImportRule, ImportAccountMapping, ImportStatus, ImportRowStatus,
} from '@/lib/types';

export interface RuleInput { pattern: string; envelopeId: string; priority?: number; enabled?: boolean }
export interface MappingInput { sourceAccountId: string; accountId: string }
export interface ConfirmInput { envelopeId: string; accountId?: string }
export interface SyncResult { ok: boolean; pages: number; inserted: number; booked: number; skipped: number }

export function getImportStatus(): Promise<SingleResponse<ImportStatus>> { return apiGet('/feoh/ingestion/status'); }
export function triggerSync(): Promise<SingleResponse<SyncResult>> { return apiPost('/feoh/ingestion/sync', {}); }

export function listInbox(params: { status?: ImportRowStatus; limit?: number; offset?: number } = {}): Promise<ListResponse<ImportedTransaction>> {
  return apiGet(`/feoh/ingestion/inbox${qs(params)}`);
}
export function confirmInboxRow(id: string, input: ConfirmInput): Promise<SingleResponse<ImportedTransaction>> {
  return apiPost(`/feoh/ingestion/inbox/${id}/confirm`, input);
}
export function dismissInboxRow(id: string): Promise<SingleResponse<ImportedTransaction>> {
  return apiPost(`/feoh/ingestion/inbox/${id}/dismiss`, {});
}

export function listRules(): Promise<SingleResponse<ImportRule[]>> { return apiGet('/feoh/ingestion/rules'); }
export function createRule(input: RuleInput): Promise<SingleResponse<ImportRule>> { return apiPost('/feoh/ingestion/rules', input); }
export function updateRule(id: string, input: Partial<RuleInput>): Promise<SingleResponse<ImportRule>> { return apiPatch(`/feoh/ingestion/rules/${id}`, input); }
export function deleteRule(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/feoh/ingestion/rules/${id}`); }

export function listAccountMappings(): Promise<SingleResponse<ImportAccountMapping[]>> { return apiGet('/feoh/ingestion/accounts'); }
export function upsertAccountMapping(input: MappingInput): Promise<SingleResponse<ImportAccountMapping>> { return apiPut('/feoh/ingestion/accounts', input); }
export function deleteAccountMapping(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/feoh/ingestion/accounts/${id}`); }
