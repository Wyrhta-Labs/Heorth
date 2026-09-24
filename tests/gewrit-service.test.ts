import { describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { ethelAssets, ethelPlaces } from '../src/modules/ethel/schema.js';
import { gewritDocuments, gewritLinks } from '../src/modules/gewrit/schema.js';
import * as service from '../src/modules/gewrit/service.js';
import { createFakeDocuments, doc } from './fake-documents.js';

async function asset(name = 'Boiler') {
  const [a] = await db.insert(ethelAssets).values({ name }).returning();
  return a!;
}
async function place(name = 'House') {
  const [p] = await db.insert(ethelPlaces).values({ name, kind: 'building' }).returning();
  return p!;
}
async function backdate(documentId: string, fields: { lastSeenMinutes?: number; updatedMinutes?: number }) {
  const set: Partial<typeof gewritDocuments.$inferInsert> = {};
  if (fields.lastSeenMinutes !== undefined) set.lastSeenAt = new Date(Date.now() - fields.lastSeenMinutes * 60_000);
  if (fields.updatedMinutes !== undefined) set.updatedAt = new Date(Date.now() - fields.updatedMinutes * 60_000);
  await db.update(gewritDocuments).set(set).where(eq(gewritDocuments.id, documentId));
}
async function reason(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  return (e as { code?: string; reason?: string } | null)?.code ?? (e as { reason?: string } | null)?.reason ?? 'no error';
}

/**
 * Polls pg_stat_activity (its own pool connection, released after each check)
 * until some OTHER backend is blocked on a row lock, or throws after
 * `timeoutMs`. Deterministic-race tests use this instead of `Promise.all`
 * timing to prove the interleaving they need actually happened — a defect
 * that skips the lock (no `FOR UPDATE`, or the wrong lock order) never makes
 * a backend block, so the poll times out and the test fails loudly instead of
 * passing on luck.
 */
async function waitForLockWait(timeoutMs = 8000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.execute(sql`
      SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()
    `) as unknown as unknown[];
    if (rows.length > 0) return;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for a backend to block on a lock');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe('gewrit service — linking', () => {
  it('links a document with a fresh snapshot', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412', 'Vitodens manual', { documentType: 'Manual', correspondent: 'Viessmann', createdOn: '2019-03-11' })]);
    const link = await service.createLink(fake, { externalId: '412', role: 'manual', note: 'In the utility room drawer', assetId: a.id });
    expect(link).toMatchObject({
      role: 'manual', note: 'In the utility room drawer',
      document: { externalId: '412', title: 'Vitodens manual', documentType: 'Manual', correspondent: 'Viessmann', createdOn: '2019-03-11', status: 'available', externalUrl: 'https://paperless.test/documents/412/details' },
    });
  });

  it('refuses an unknown element before calling the provider', async () => {
    const fake = createFakeDocuments([doc('412')]);
    expect(await reason(service.createLink(fake, { externalId: '412', role: 'manual', assetId: '00000000-0000-4000-8000-000000000000' }))).toBe('ELEMENT_NOT_FOUND');
    expect(fake.calls.getMany).toHaveLength(0);
  });

  it('refuses a document Paperless does not have, writing nothing', async () => {
    const a = await asset();
    expect(await reason(service.createLink(createFakeDocuments(), { externalId: '9', role: 'manual', assetId: a.id }))).toBe('DOCUMENT_NOT_FOUND');
    expect(await db.select().from(gewritDocuments)).toHaveLength(0);
  });

  it('lets a provider failure through, writing nothing', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    fake.failWith = 'unreachable';
    expect(await reason(service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id }))).toBe('unreachable');
    expect(await db.select().from(gewritDocuments)).toHaveLength(0);
  });

  it('refuses a duplicate, allows another role and another element, and keeps ONE document row', async () => {
    const a = await asset();
    const p = await place();
    const fake = createFakeDocuments([doc('412')]);
    await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    expect(await reason(service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id }))).toBe('ALREADY_LINKED');
    await service.createLink(fake, { externalId: '412', role: 'warranty', assetId: a.id });
    await service.createLink(fake, { externalId: '412', role: 'manual', placeId: p.id });
    expect(await db.select().from(gewritDocuments)).toHaveLength(1);
    expect(await db.select().from(gewritLinks)).toHaveLength(3);
  });

  it('turns an element deleted mid-request into ELEMENT_NOT_FOUND and rolls back the document row', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    fake.beforeGetMany = async () => { await db.delete(ethelAssets).where(eq(ethelAssets.id, a.id)); };
    expect(await reason(service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id }))).toBe('ELEMENT_NOT_FOUND');
    expect(await db.select().from(gewritDocuments)).toHaveLength(0);
  });
});

describe('gewrit service — listing', () => {
  it('answers null for an unknown element', async () => {
    expect(await service.listForElement(createFakeDocuments(), { placeId: '00000000-0000-4000-8000-000000000000' })).toBeNull();
  });

  it('does not call the provider while every snapshot is fresh', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    fake.calls.getMany.length = 0;
    const r = await service.listForElement(fake, { assetId: a.id });
    expect(r!.links).toHaveLength(1);
    expect(r!.stale).toBe(false);
    expect(fake.calls.getMany).toHaveLength(0);
  });

  it('refreshes a stale snapshot in one batched call with the short timeout', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412', 'Old title'), doc('413')]);
    const l1 = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    const l2 = await service.createLink(fake, { externalId: '413', role: 'invoice', assetId: a.id });
    await backdate(l1.document.id, { lastSeenMinutes: 20 });
    await backdate(l2.document.id, { lastSeenMinutes: 20 });
    fake.docs.set('412', doc('412', 'New title'));
    fake.calls.getMany.length = 0;
    fake.calls.timeouts.length = 0;
    const r = await service.listForElement(fake, { assetId: a.id });
    expect(fake.calls.getMany).toEqual([['412', '413']]);
    expect(fake.calls.timeouts).toEqual([service.REFRESH_TIMEOUT_MS]);
    expect(r!.links.find((l) => l.role === 'manual')!.document.title).toBe('New title');
  });

  it('marks a document Paperless no longer returns as missing, and brings it back when it reappears', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    const l = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    await backdate(l.document.id, { lastSeenMinutes: 20 });
    fake.docs.delete('412');
    expect((await service.listForElement(fake, { assetId: a.id }))!.links[0]!.document.status).toBe('missing');
    fake.docs.set('412', doc('412'));
    expect((await service.listForElement(fake, { assetId: a.id }))!.links[0]!.document.status).toBe('available');
  });

  it('answers from the snapshot with stale: true when Paperless is down', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412', 'Kept title')]);
    const l = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    await backdate(l.document.id, { lastSeenMinutes: 20 });
    fake.failWith = 'timeout';
    const r = await service.listForElement(fake, { assetId: a.id });
    expect(r!.stale).toBe(true);
    expect(r!.links[0]!.document).toMatchObject({ title: 'Kept title', status: 'available' });
  });

  it('classifies a refused credential as staleReason auth, and every other outage as unavailable', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    const l = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    await backdate(l.document.id, { lastSeenMinutes: 20 });
    fake.failWith = 'auth';
    expect((await service.listForElement(fake, { assetId: a.id }))!.staleReason).toBe('auth');

    await backdate(l.document.id, { lastSeenMinutes: 20 });
    fake.failWith = 'timeout';
    expect((await service.listForElement(fake, { assetId: a.id }))!.staleReason).toBe('unavailable');
  });

  it('reports staleReason null when the snapshot is fresh or the refresh succeeds', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    expect((await service.listForElement(fake, { assetId: a.id }))!.staleReason).toBeNull();
  });

  it('orders by the fixed role order, then title', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('1', 'Zeta'), doc('2', 'Alpha'), doc('3', 'Beta')]);
    await service.createLink(fake, { externalId: '1', role: 'warranty', assetId: a.id });
    await service.createLink(fake, { externalId: '2', role: 'other', assetId: a.id });
    await service.createLink(fake, { externalId: '3', role: 'manual', assetId: a.id });
    await service.createLink(fake, { externalId: '2', role: 'manual', assetId: a.id });
    const r = await service.listForElement(fake, { assetId: a.id });
    expect(r!.links.map((l) => `${l.role}:${l.document.title}`)).toEqual(['manual:Alpha', 'manual:Beta', 'warranty:Zeta', 'other:Alpha']);
  });
});

describe('gewrit service — deleting and the sweep', () => {
  it('removes the document row with its last link, and keeps it while another link exists', async () => {
    const a = await asset();
    const p = await place();
    const fake = createFakeDocuments([doc('412')]);
    const l1 = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    const l2 = await service.createLink(fake, { externalId: '412', role: 'manual', placeId: p.id });
    expect(await service.deleteLink(l1.id)).toBe(true);
    expect(await db.select().from(gewritDocuments)).toHaveLength(1);
    expect(await service.deleteLink(l2.id)).toBe(true);
    expect(await db.select().from(gewritDocuments)).toHaveLength(0);
    expect(await service.deleteLink(l2.id)).toBe(false);
  });

  it('survives a delete racing a relink of the same document, without deadlock or a lost link', async () => {
    const a = await asset();
    const b = await asset('Car');
    const fake = createFakeDocuments([doc('412')]);
    for (let i = 0; i < 5; i++) {
      const l = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
      const [deleted, relinked] = await Promise.all([
        service.deleteLink(l.id),
        service.createLink(fake, { externalId: '412', role: 'invoice', assetId: b.id }),
      ]);
      expect(deleted).toBe(true);
      expect(relinked.document.externalId).toBe('412');
      expect(await db.select().from(gewritDocuments)).toHaveLength(1);
      expect((await db.select().from(gewritLinks)).map((x) => x.role)).toEqual(['invoice']);
      await service.deleteLink(relinked.id);
    }
  });

  it('deterministic: delete waits behind a held upsert, then sees the link the held transaction adds', async () => {
    // Forces the exact interleaving the timing-based race test above can only hope
    // for: deleteLink's FOR UPDATE must block on a row a concurrent upsert is
    // holding, and must still see a link that upsert's transaction adds before it
    // commits. A buggy deleteLink that deletes the link BEFORE locking the document
    // (or never locks it at all) never blocks here — waitForLockWait times out and
    // fails the test, instead of the five-iteration timing gamble silently passing.
    const a = await asset();
    const b = await asset('Car');
    const fake = createFakeDocuments([doc('412')]);
    const l1 = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });

    let release!: () => void;
    const proceed = new Promise<void>((resolve) => { release = resolve; });
    const held = db.transaction(async (tx) => {
      // The same upsert createLink does, holding the document row's lock.
      await tx.insert(gewritDocuments)
        .values({
          source: 'paperless', externalId: '412', title: 'x', documentType: null, correspondent: null,
          createdOn: null, status: 'available', lastSeenAt: new Date(), updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [gewritDocuments.source, gewritDocuments.externalId],
          set: { updatedAt: new Date() },
        });
      await proceed;
      await tx.insert(gewritLinks).values({ documentId: l1.document.id, assetId: b.id, placeId: null, role: 'invoice', note: null });
    }).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));

    const deleted = service.deleteLink(l1.id).then((v) => ({ ok: true as const, v }), (error: unknown) => ({ ok: false as const, error }));

    try {
      await waitForLockWait();
    } finally {
      release();
    }

    const [heldOutcome, deletedOutcome] = await Promise.all([held, deleted]);
    if (!heldOutcome.ok) throw heldOutcome.error;
    if (!deletedOutcome.ok) throw deletedOutcome.error;
    expect(deletedOutcome.v).toBe(true);
    expect(await db.select().from(gewritDocuments).where(eq(gewritDocuments.externalId, '412'))).toHaveLength(1);
    expect((await db.select().from(gewritLinks)).map((x) => x.assetId)).toEqual([b.id]);
  });

  it('deterministic: create waits behind a held delete, then gets a fresh document row', async () => {
    // The mirror interleaving: createLink's INSERT .. ON CONFLICT must block on a
    // row a concurrent transaction has FOR-UPDATE-locked and is about to delete,
    // then succeed with a fresh row once that transaction commits. A createLink
    // that does not re-resolve the conflict after the wait (or races the delete)
    // either loses the link or errors instead of blocking here.
    const a = await asset();
    const b = await asset('Car');
    const fake = createFakeDocuments([doc('412')]);
    const l1 = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    const originalDocId = l1.document.id;

    let release!: () => void;
    const proceed = new Promise<void>((resolve) => { release = resolve; });
    const held = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM gewrit_documents WHERE id = ${originalDocId} FOR UPDATE`);
      await tx.delete(gewritLinks).where(eq(gewritLinks.id, l1.id));
      await tx.delete(gewritDocuments).where(eq(gewritDocuments.id, originalDocId));
      await proceed;
    }).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));

    const created = service.createLink(fake, { externalId: '412', role: 'invoice', assetId: b.id })
      .then((v) => ({ ok: true as const, v }), (error: unknown) => ({ ok: false as const, error }));

    try {
      await waitForLockWait();
    } finally {
      release();
    }

    const [heldOutcome, createdOutcome] = await Promise.all([held, created]);
    if (!heldOutcome.ok) throw heldOutcome.error;
    if (!createdOutcome.ok) throw createdOutcome.error;
    expect(createdOutcome.v.document.externalId).toBe('412');
    const rows = await db.select().from(gewritDocuments).where(eq(gewritDocuments.externalId, '412'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(originalDocId);
    expect((await db.select().from(gewritLinks)).map((x) => x.assetId)).toEqual([b.id]);
  });

  it('sweeps an orphan older than an hour, spares a younger one, and never touches a still-linked document', async () => {
    const a = await asset();
    const b = await asset('Car');
    const c = await asset('Ladder');
    const fake = createFakeDocuments([doc('1'), doc('2'), doc('3')]);
    const old = await service.createLink(fake, { externalId: '1', role: 'manual', assetId: a.id });
    const young = await service.createLink(fake, { externalId: '2', role: 'manual', assetId: b.id });
    // Still linked and backdated the same as the orphan — this is what catches
    // a sweep whose NOT EXISTS got lost and started deleting live documents.
    const linked = await service.createLink(fake, { externalId: '3', role: 'manual', assetId: c.id });
    await db.delete(ethelAssets).where(eq(ethelAssets.id, a.id));
    await db.delete(ethelAssets).where(eq(ethelAssets.id, b.id));
    await backdate(old.document.id, { updatedMinutes: 61 });
    await backdate(young.document.id, { updatedMinutes: 30 });
    await backdate(linked.document.id, { updatedMinutes: 61 });
    await service.sweepOrphans();
    expect((await db.select().from(gewritDocuments)).map((d) => d.externalId).sort()).toEqual(['2', '3']);
    expect(await db.select().from(gewritLinks).where(eq(gewritLinks.id, linked.id))).toHaveLength(1);
  });

  it('edits role and note, and refuses a role that collides', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    const l1 = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    await service.createLink(fake, { externalId: '412', role: 'warranty', assetId: a.id });
    expect(await service.updateLink(fake, l1.id, { note: 'shelf 2' })).toMatchObject({ role: 'manual', note: 'shelf 2' });
    expect(await reason(service.updateLink(fake, l1.id, { role: 'warranty' }))).toBe('ALREADY_LINKED');
    expect(await service.updateLink(fake, '00000000-0000-4000-8000-000000000000', { note: null })).toBeNull();
  });
});

describe('gewrit service — preview target', () => {
  it('finds a linked document and refuses an orphan or an unknown id', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    const l = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    expect(await service.previewTarget(l.document.id)).toEqual({ id: l.document.id, source: 'paperless', externalId: '412' });
    await db.delete(ethelAssets).where(eq(ethelAssets.id, a.id));
    expect(await service.previewTarget(l.document.id)).toBeNull();
    expect(await service.previewTarget('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('marks a document missing', async () => {
    const a = await asset();
    const fake = createFakeDocuments([doc('412')]);
    const l = await service.createLink(fake, { externalId: '412', role: 'manual', assetId: a.id });
    await service.markMissing(l.document.id);
    const [row] = await db.select().from(gewritDocuments);
    expect(row!.status).toBe('missing');
  });
});
