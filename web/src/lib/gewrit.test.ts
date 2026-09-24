import { describe, it, expect } from 'vitest';
import { parsePaperlessRef, previewKind, elementKey } from './gewrit';

describe('parsePaperlessRef', () => {
  it('accepts a bare document number', () => {
    expect(parsePaperlessRef('412')).toBe('412');
    expect(parsePaperlessRef('  412 ')).toBe('412');
  });

  it('extracts the id from Paperless URLs, including a sub-path, a query and a fragment', () => {
    expect(parsePaperlessRef('https://paperless.home/documents/412/details')).toBe('412');
    expect(parsePaperlessRef('https://paperless.home/documents/412/details?tab=notes')).toBe('412');
    expect(parsePaperlessRef('https://paperless.home/documents/412')).toBe('412');
    expect(parsePaperlessRef('https://home.example/paperless/documents/412/details#x')).toBe('412');
  });

  it('accepts a ten-digit id and refuses an eleven-digit one (the server bound)', () => {
    expect(parsePaperlessRef('1234567890')).toBe('1234567890');
    expect(parsePaperlessRef('12345678901')).toBeNull();
    expect(parsePaperlessRef('https://paperless.home/documents/12345678901/details')).toBeNull();
  });

  it('refuses anything that is not a document link or number', () => {
    for (const s of ['', '0', '-3', '4.5', 'abc', 'https://paperless.home/documents/', 'https://paperless.home/tags/4/', 'documents/412', 'https://paperless.home/documents/abc/details']) {
      expect(parsePaperlessRef(s)).toBeNull();
    }
  });
});

describe('previewKind', () => {
  it('renders PDFs and raster images, and downloads everything else', () => {
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('Application/PDF; charset=binary')).toBe('pdf');
    expect(previewKind('image/webp')).toBe('image');
    expect(previewKind('image/svg+xml')).toBe('download');
    expect(previewKind('text/html')).toBe('download');
    expect(previewKind('')).toBe('download');
  });
});

describe('elementKey', () => {
  it('keeps assets and places apart', () => {
    expect(elementKey({ assetId: 'a' })).toBe('asset:a');
    expect(elementKey({ placeId: 'a' })).toBe('place:a');
  });
});
