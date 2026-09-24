import { DocumentProviderError, type DocumentMeta, type DocumentProvider } from './types.js';

/**
 * The demo stack's provider (`GEWRIT_PROVIDER=fake`, ADR 0012): four fixed
 * documents and a generated one-page PDF for each. It never opens a network
 * connection. The PDFs are built in code because `tsc` does not copy binary
 * assets into `dist/`.
 */
export const DEMO_DOCUMENTS: readonly DocumentMeta[] = [
  { externalId: '1', title: 'Vaillant ecoTEC plus operating manual', documentType: 'Manual', correspondent: 'Vaillant', createdOn: '2024-01-15' },
  { externalId: '2', title: 'Vaillant ecoTEC plus warranty certificate', documentType: 'Certificate', correspondent: 'Vaillant', createdOn: '2024-01-15' },
  { externalId: '3', title: 'Ford Focus registration certificate', documentType: 'Certificate', correspondent: 'Vehicle licensing office', createdOn: '2022-06-01' },
  { externalId: '4', title: 'Ground floor plan', documentType: 'Plan', correspondent: 'Architect', createdOn: '2019-03-11' },
];

function pdfString(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** A valid single-page PDF 1.4 with a computed xref table. ASCII only, so the
 *  string length equals the byte length the offsets need. */
export function buildSamplePdf(title: string): Uint8Array {
  const content =
    `BT /F1 18 Tf 72 720 Td (${pdfString(title)}) Tj ` +
    `0 -28 Td /F1 11 Tf (Demo document - served by the Heorth demo provider, not by Paperless.) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function createDemoProvider(): DocumentProvider {
  const byId = new Map(DEMO_DOCUMENTS.map((d) => [d.externalId, d]));
  return {
    id: 'fake',
    async search(query, limit) {
      const q = query.toLowerCase();
      return DEMO_DOCUMENTS
        .filter((d) => [d.title, d.documentType, d.correspondent].some((f) => f?.toLowerCase().includes(q)))
        .slice(0, limit);
    },
    async getMany(ids) {
      return ids.flatMap((id) => {
        const d = byId.get(id);
        return d ? [d] : [];
      });
    },
    async openPreview(id) {
      const d = byId.get(id);
      if (!d) throw new DocumentProviderError('not_found', 'no such demo document');
      const bytes = buildSamplePdf(d.title);
      return { body: streamOf(bytes), contentType: 'application/pdf', contentLength: bytes.length };
    },
    externalUrl() {
      return null;
    },
  };
}
