import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import type { GewritLink } from '@/lib/types';

const getFeatures = vi.fn();
vi.mock('@/api/features', () => ({ getFeatures: (...a: unknown[]) => getFeatures(...a) }));

const listDocuments = vi.fn();
const searchDocuments = vi.fn();
const createLink = vi.fn();
vi.mock('@/api/gewrit', () => ({
  listDocuments: (...a: unknown[]) => listDocuments(...a),
  searchDocuments: (...a: unknown[]) => searchDocuments(...a),
  createLink: (...a: unknown[]) => createLink(...a),
  updateLink: vi.fn(),
  deleteLink: vi.fn(),
  fetchPreview: vi.fn(() => new Promise(() => undefined)),
}));

import { ToastProvider } from '@/components/ui/toast';
import DocumentsPanel from './documents-panel';

const ASSET = '11111111-1111-4111-8111-111111111111';

function link(id: string, role: GewritLink['role'], title: string, extra: Partial<GewritLink['document']> = {}): GewritLink {
  return {
    id, role, note: null, createdAt: '',
    document: { id: `d-${id}`, externalId: id, title, documentType: null, correspondent: 'Viessmann', createdOn: null, status: 'available', lastSeenAt: '', externalUrl: null, ...extra },
  };
}

function features(gewrit: boolean) {
  getFeatures.mockResolvedValue({ data: { finance: true, kithledger: false, kithledgerUrl: null, gewrit } });
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DocumentsPanel element={{ assetId: ASSET }} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listDocuments.mockResolvedValue({ data: [], meta: { stale: false } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DocumentsPanel', () => {
  it('renders nothing and lists nothing while Gewrit is off', async () => {
    features(false);
    renderPanel();
    await waitFor(() => expect(getFeatures).toHaveBeenCalled());
    expect(screen.queryByText('Documents')).toBeNull();
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('groups links in the fixed role order', async () => {
    features(true);
    listDocuments.mockResolvedValue({ data: [link('2', 'warranty', 'Warranty card'), link('1', 'manual', 'Operating manual')], meta: { stale: false } });
    renderPanel();
    await screen.findByText('Operating manual');
    const headings = screen.getAllByText(/^(Manual|Warranty)$/).map((e) => e.textContent);
    expect(headings).toEqual(['Manual', 'Warranty']);
  });

  it('shows a missing document and the stale hint', async () => {
    features(true);
    listDocuments.mockResolvedValue({ data: [link('1', 'manual', 'Gone manual', { status: 'missing' })], meta: { stale: true } });
    renderPanel();
    expect(await screen.findByText('Deleted in Paperless')).toBeInTheDocument();
    expect(screen.getByText('Paperless is not reachable — showing the last known details.')).toBeInTheDocument();
  });

  it('links a search hit', async () => {
    features(true);
    searchDocuments.mockResolvedValue({ data: [{ externalId: '413', title: 'Boiler invoice', documentType: null, correspondent: null, createdOn: null }] });
    createLink.mockResolvedValue({ data: link('413', 'manual', 'Boiler invoice') });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Link document' }));
    fireEvent.change(screen.getByLabelText('Search Paperless'), { target: { value: 'boiler' } });
    await waitFor(() => expect(searchDocuments).toHaveBeenCalledWith('boiler'));
    fireEvent.click(await screen.findByRole('button', { name: /Boiler invoice/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(createLink).toHaveBeenCalledWith({ externalId: '413', role: 'manual', note: null, assetId: ASSET }));
  });

  it('links a pasted Paperless URL and refuses a pasted non-link', async () => {
    features(true);
    createLink.mockResolvedValue({ data: link('412', 'manual', 'x') });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Link document' }));
    const paste = screen.getByLabelText('Or paste a Paperless link or document number');
    fireEvent.change(paste, { target: { value: 'https://paperless.home/tags/4/' } });
    expect(screen.getByText('That is not a Paperless document link or number.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();
    fireEvent.change(paste, { target: { value: 'https://paperless.home/documents/412/details?tab=notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ externalId: '412', assetId: ASSET })));
  });

  it('turns a 403 into a sentence a child can read', async () => {
    features(true);
    createLink.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Insufficient role'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Link document' }));
    fireEvent.change(screen.getByLabelText('Or paste a Paperless link or document number'), { target: { value: '412' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText('Only adults can link or change documents.')).toBeInTheDocument();
  });
});
