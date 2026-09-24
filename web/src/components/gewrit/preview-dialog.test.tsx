import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GewritLink } from '@/lib/types';

const fetchPreview = vi.fn();
vi.mock('@/api/gewrit', () => ({
  fetchPreview: (...a: unknown[]) => fetchPreview(...a),
  listDocuments: vi.fn(), searchDocuments: vi.fn(), createLink: vi.fn(), updateLink: vi.fn(), deleteLink: vi.fn(),
}));

import { ToastProvider } from '@/components/ui/toast';
import PreviewDialog from './preview-dialog';

const LINK: GewritLink = {
  id: 'l1', role: 'manual', note: null, createdAt: '',
  document: { id: 'd1', externalId: '412', title: 'Boiler manual', documentType: null, correspondent: null, createdOn: null, status: 'available', lastSeenAt: '', externalUrl: 'https://paperless.home/documents/412/details' },
};

function renderPreview(link: GewritLink) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PreviewDialog link={link} onClose={() => undefined} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PreviewDialog', () => {
  it('renders a PDF in an unsandboxed iframe from the blob URL', async () => {
    fetchPreview.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const { container } = renderPreview(LINK);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('blob:preview');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(screen.getByRole('link', { name: 'Open in Paperless' })).toHaveAttribute('href', LINK.document.externalUrl);
  });

  it('never renders a non-allowlisted type — it offers a download', async () => {
    fetchPreview.mockResolvedValue(new Blob(['<script>'], { type: 'text/html' }));
    const { container } = renderPreview(LINK);
    const a = await screen.findByRole('link', { name: 'Download' });
    expect(a).toHaveAttribute('download');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not fetch a missing document', async () => {
    renderPreview({ ...LINK, document: { ...LINK.document, status: 'missing' } });
    expect(screen.getByText('Deleted in Paperless')).toBeInTheDocument();
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  it('revokes the blob URL when it closes', async () => {
    fetchPreview.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const { container, unmount } = renderPreview(LINK);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('aborts a download still in flight when it closes', async () => {
    fetchPreview.mockReturnValue(new Promise(() => undefined));
    const { unmount } = renderPreview(LINK);
    await waitFor(() => expect(fetchPreview).toHaveBeenCalled());
    const signal = fetchPreview.mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
