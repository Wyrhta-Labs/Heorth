import { describe, it, expect } from 'vitest';
import { previewHeaders } from '../src/modules/gewrit/preview.js';

describe('previewHeaders', () => {
  it('serves allowlisted types inline under their plain essence', () => {
    for (const [given, served] of [
      ['application/pdf', 'application/pdf'],
      ['application/PDF; charset=binary', 'application/pdf'],
      ['image/png', 'image/png'],
      ['image/jpeg', 'image/jpeg'],
      ['image/gif', 'image/gif'],
      ['image/webp', 'image/webp'],
    ] as const) {
      const h = previewHeaders({ contentType: given, contentLength: null });
      expect(h.get('content-type')).toBe(served);
      expect(h.get('content-disposition')).toBe('inline');
    }
  });

  it('turns everything else into an attachment of octet-stream', () => {
    for (const given of ['text/html', 'image/svg+xml', 'application/xml', 'text/plain', 'application/x-unknown', '', null]) {
      const h = previewHeaders({ contentType: given, contentLength: null });
      expect(h.get('content-type')).toBe('application/octet-stream');
      expect(h.get('content-disposition')).toBe('attachment');
    }
  });

  it('always sets no-store and nosniff, never a CSP, and forwards only a known length', () => {
    const h = previewHeaders({ contentType: 'application/pdf', contentLength: 1234 });
    expect(h.get('cache-control')).toBe('private, no-store');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('content-security-policy')).toBeNull();
    expect(h.get('content-length')).toBe('1234');
    expect(previewHeaders({ contentType: 'application/pdf', contentLength: null }).get('content-length')).toBeNull();
  });
});
