import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/feoh-import';

export function useImportStatus() { return useQuery({ queryKey: QUERY_KEYS.importStatus, queryFn: () => api.getImportStatus() }); }
export function useImportInbox(params: Parameters<typeof api.listInbox>[0] = { status: 'pending', limit: 50 }) {
  return useQuery({ queryKey: [...QUERY_KEYS.importInbox, params], queryFn: () => api.listInbox(params) });
}
export function useImportRules() { return useQuery({ queryKey: QUERY_KEYS.importRules, queryFn: () => api.listRules() }); }
export function useImportAccounts() { return useQuery({ queryKey: QUERY_KEYS.importAccounts, queryFn: () => api.listAccountMappings() }); }

/** Everything an import write can change: the inbox, the status counts, and the ledger views. */
function useInvalidateImport() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: QUERY_KEYS.importInbox });
    qc.invalidateQueries({ queryKey: QUERY_KEYS.importStatus });
    qc.invalidateQueries({ queryKey: QUERY_KEYS.transactions });
    qc.invalidateQueries({ queryKey: ['summary'] });
    qc.invalidateQueries({ queryKey: ['ledger'] });
  };
}

export function useTriggerSync() {
  const inv = useInvalidateImport();
  return useMutation({ mutationFn: () => api.triggerSync(), onSuccess: inv });
}
export function useConfirmInboxRow() {
  const inv = useInvalidateImport();
  return useMutation({ mutationFn: (v: { id: string; input: api.ConfirmInput }) => api.confirmInboxRow(v.id, v.input), onSuccess: inv });
}
export function useDismissInboxRow() {
  const inv = useInvalidateImport();
  return useMutation({ mutationFn: (id: string) => api.dismissInboxRow(id), onSuccess: inv });
}
export function useCreateRule() {
  const qc = useQueryClient(); const inv = useInvalidateImport();
  return useMutation({ mutationFn: (i: api.RuleInput) => api.createRule(i), onSuccess: () => { qc.invalidateQueries({ queryKey: QUERY_KEYS.importRules }); inv(); } });
}
export function useUpdateRule() {
  const qc = useQueryClient(); const inv = useInvalidateImport();
  return useMutation({ mutationFn: (v: { id: string; input: Partial<api.RuleInput> }) => api.updateRule(v.id, v.input), onSuccess: () => { qc.invalidateQueries({ queryKey: QUERY_KEYS.importRules }); inv(); } });
}
export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteRule(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.importRules }) });
}
export function useUpsertAccountMapping() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.MappingInput) => api.upsertAccountMapping(i), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.importAccounts }) });
}
export function useDeleteAccountMapping() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteAccountMapping(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.importAccounts }) });
}
