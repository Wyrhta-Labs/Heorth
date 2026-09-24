import { describe, it, expect } from 'vitest';
import { createDemoProvider, buildSamplePdf, DEMO_DOCUMENTS } from '../src/modules/gewrit/providers/demo.js';
import { isDocumentProviderError } from '../src/modules/gewrit/providers/types.js';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

describe('gewrit demo provider', () => {
  const p = createDemoProvider();

  it('is the fake source with four documents and no external UI', () => {
    expect(p.id).toBe('fake');
    expect(DEMO_DOCUMENTS.map((d) => d.externalId)).toEqual(['1', '2', '3', '4']);
    expect(p.externalUrl('1')).toBeNull();
  });

  it('searches title, type and correspondent case-insensitively, honouring the limit', async () => {
    expect((await p.search('VAILLANT', 25)).map((d) => d.externalId)).toEqual(['1', '2']);
    expect((await p.search('certificate', 1))).toHaveLength(1);
    expect(await p.search('nothing matches this', 25)).toEqual([]);
  });

  it('returns only known ids from getMany', async () => {
    expect((await p.getMany(['4', '9'])).map((d) => d.externalId)).toEqual(['4']);
  });

  it('serves a PDF whose xref offset points at the xref table', async () => {
    const s = await p.openPreview('1');
    expect(s.contentType).toBe('application/pdf');
    const bytes = await readAll(s.body);
    expect(s.contentLength).toBe(bytes.length);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('escapes parentheses and backslashes in the title', () => {
    const text = new TextDecoder().decode(buildSamplePdf('A (b) \\ c'));
    expect(text).toContain('(A \\(b\\) \\\\ c) Tj');
  });

  it('throws not_found for an unknown id', async () => {
    const e = await p.openPreview('9').catch((x: unknown) => x);
    expect(isDocumentProviderError(e) && e.reason).toBe('not_found');
  });
});
