import { describe, it, expect, vi, afterEach } from 'vitest';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();
vi.mock('./client', async (orig) => ({
  ...(await orig<typeof import('./client')>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

import * as api from './feoh-import';

afterEach(() => vi.clearAllMocks());

describe('feoh-import api client paths', () => {
  it('hits /feoh/ingestion/* with the documented methods', () => {
    api.getImportStatus();
    expect(apiGet).toHaveBeenCalledWith('/feoh/ingestion/status');
    api.triggerSync();
    expect(apiPost).toHaveBeenCalledWith('/feoh/ingestion/sync', {});
    api.listInbox({ status: 'pending', limit: 50 });
    expect(apiGet).toHaveBeenCalledWith('/feoh/ingestion/inbox?status=pending&limit=50');
    api.confirmInboxRow('r1', { envelopeId: 'e1' });
    expect(apiPost).toHaveBeenCalledWith('/feoh/ingestion/inbox/r1/confirm', { envelopeId: 'e1' });
    api.dismissInboxRow('r1');
    expect(apiPost).toHaveBeenCalledWith('/feoh/ingestion/inbox/r1/dismiss', {});
    api.listRules();
    expect(apiGet).toHaveBeenCalledWith('/feoh/ingestion/rules');
    api.createRule({ pattern: 'rewe', envelopeId: 'e1' });
    expect(apiPost).toHaveBeenCalledWith('/feoh/ingestion/rules', { pattern: 'rewe', envelopeId: 'e1' });
    api.updateRule('k1', { enabled: false });
    expect(apiPatch).toHaveBeenCalledWith('/feoh/ingestion/rules/k1', { enabled: false });
    api.deleteRule('k1');
    expect(apiDelete).toHaveBeenCalledWith('/feoh/ingestion/rules/k1');
    api.listAccountMappings();
    expect(apiGet).toHaveBeenCalledWith('/feoh/ingestion/accounts');
    api.upsertAccountMapping({ sourceAccountId: '7', accountId: 'a1' });
    expect(apiPut).toHaveBeenCalledWith('/feoh/ingestion/accounts', { sourceAccountId: '7', accountId: 'a1' });
    api.deleteAccountMapping('m1');
    expect(apiDelete).toHaveBeenCalledWith('/feoh/ingestion/accounts/m1');
  });
});
