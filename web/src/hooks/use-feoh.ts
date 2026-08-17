import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/feoh';

export function useAccounts() { return useQuery({ queryKey: QUERY_KEYS.accounts, queryFn: () => api.listAccounts() }); }
export function useEnvelopes() { return useQuery({ queryKey: QUERY_KEYS.envelopes, queryFn: () => api.listEnvelopes() }); }
export function useSummary(month: string) { return useQuery({ queryKey: QUERY_KEYS.summary(month), queryFn: () => api.getSummary(month) }); }
export function useTransactions(params: Parameters<typeof api.listTransactions>[0] = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.transactions, params], queryFn: () => api.listTransactions(params) });
}
export function useBills() { return useQuery({ queryKey: QUERY_KEYS.bills, queryFn: () => api.listBills() }); }
export function useItemCosts(itemId: string) {
  return useQuery({ queryKey: QUERY_KEYS.itemCosts(itemId), queryFn: () => api.getItemCosts(itemId), enabled: !!itemId });
}
export function useOccurrences(params: Parameters<typeof api.listOccurrences>[0] = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.occurrences, params], queryFn: () => api.listOccurrences(params) });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.AccountInput) => api.createAccount(i), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.accounts }) });
}
export function useCreateEnvelope() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.EnvelopeInput) => api.createEnvelope(i), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.envelopes }) });
}
export function useRecordTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: api.TransactionInput) => api.recordTransaction(i),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.transactions });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}
export function useCreateBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.BillInput) => api.createBill(i), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.bills }) });
}
export function useDeleteBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteBill(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.bills }) });
}
export function useCreateItemCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: api.CreateItemCostInput) => api.createItemCost(i),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: QUERY_KEYS.itemCosts(vars.itemId) }),
  });
}
export function useDeleteItemCost(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteItemCost(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.itemCosts(itemId) }),
  });
}
function invalidateOccurrences(qc: ReturnType<typeof useQueryClient>) {
  return () => qc.invalidateQueries({ queryKey: QUERY_KEYS.occurrences });
}
export function useLinkOccurrence() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.LinkOccurrenceInput) => api.linkOccurrence(i), onSuccess: invalidateOccurrences(qc) });
}
export function useSkipOccurrence() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.OccurrenceRefInput) => api.skipOccurrence(i), onSuccess: invalidateOccurrences(qc) });
}
export function useUnskipOccurrence() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.OccurrenceRefInput) => api.unskipOccurrence(i), onSuccess: invalidateOccurrences(qc) });
}
export function useUnlinkOccurrence() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.OccurrenceRefInput) => api.unlinkOccurrence(i), onSuccess: invalidateOccurrences(qc) });
}
export function useOverrideOccurrence() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (i: api.OverrideOccurrenceInput) => api.overrideOccurrence(i), onSuccess: invalidateOccurrences(qc) });
}
export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) => api.importCsv(csv),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.transactions });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}
