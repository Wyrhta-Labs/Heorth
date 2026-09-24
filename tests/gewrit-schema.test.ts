import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { pgErrorCode } from '@wyrhta/core/db';
import { db } from '../src/db/index.js';
import { ethelAssets, ethelPlaces } from '../src/modules/ethel/schema.js';
import { gewritDocuments, gewritLinks } from '../src/modules/gewrit/schema.js';

async function codeOf(p: PromiseLike<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (e) { return pgErrorCode(e); }
}

async function fixture() {
  const [asset] = await db.insert(ethelAssets).values({ name: 'Boiler' }).returning();
  const [place] = await db.insert(ethelPlaces).values({ name: 'House', kind: 'building' }).returning();
  const [doc] = await db.insert(gewritDocuments).values({
    source: 'paperless', externalId: '412', title: 'Boiler manual', lastSeenAt: new Date(),
  }).returning();
  return { asset: asset!, place: place!, doc: doc! };
}

describe('gewrit schema', () => {
  it('refuses a link with neither element', async () => {
    const { doc } = await fixture();
    expect(await codeOf(db.insert(gewritLinks).values({ documentId: doc.id, role: 'manual' }))).toBe('23514');
  });

  it('refuses a link with both elements', async () => {
    const { doc, asset, place } = await fixture();
    expect(await codeOf(db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, placeId: place.id, role: 'manual' }))).toBe('23514');
  });

  it('refuses the same document on the same asset in the same role (NULLS NOT DISTINCT)', async () => {
    const { doc, asset } = await fixture();
    await db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'manual' });
    expect(await codeOf(db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'manual' }))).toBe('23505');
  });

  it('allows the same document on the same asset in another role, and on a place', async () => {
    const { doc, asset, place } = await fixture();
    await db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'manual' });
    await db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'warranty' });
    await db.insert(gewritLinks).values({ documentId: doc.id, placeId: place.id, role: 'manual' });
    expect(await db.select().from(gewritLinks)).toHaveLength(3);
  });

  it('refuses an unknown role, an unknown status, an unknown source, and a note over 500 chars', async () => {
    const { doc, asset } = await fixture();
    expect(await codeOf(db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'receipt' }))).toBe('23514');
    expect(await codeOf(db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'other', note: 'x'.repeat(501) }))).toBe('23514');
    expect(await codeOf(db.update(gewritDocuments).set({ status: 'gone' }).where(eq(gewritDocuments.id, doc.id)))).toBe('23514');
    expect(await codeOf(db.insert(gewritDocuments).values({ source: 'nextcloud', externalId: '1', title: 't', lastSeenAt: new Date() }))).toBe('23514');
  });

  it('refuses a second row for the same (source, external id)', async () => {
    await fixture();
    expect(await codeOf(db.insert(gewritDocuments).values({ source: 'paperless', externalId: '412', title: 'again', lastSeenAt: new Date() }))).toBe('23505');
  });

  it('cascades an asset or place delete to its links and keeps the document row', async () => {
    const { doc, asset, place } = await fixture();
    await db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'manual' });
    await db.insert(gewritLinks).values({ documentId: doc.id, placeId: place.id, role: 'manual' });
    await db.delete(ethelAssets).where(eq(ethelAssets.id, asset.id));
    await db.delete(ethelPlaces).where(eq(ethelPlaces.id, place.id));
    expect(await db.select().from(gewritLinks)).toHaveLength(0);
    expect(await db.select().from(gewritDocuments)).toHaveLength(1);
  });

  it('cascades a document delete to its links', async () => {
    const { doc, asset } = await fixture();
    await db.insert(gewritLinks).values({ documentId: doc.id, assetId: asset.id, role: 'manual' });
    await db.delete(gewritDocuments).where(eq(gewritDocuments.id, doc.id));
    expect(await db.select().from(gewritLinks)).toHaveLength(0);
  });
});
