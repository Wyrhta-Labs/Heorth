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
