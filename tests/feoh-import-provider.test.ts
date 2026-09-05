import { describe, it, expect, afterEach } from 'vitest';
import {
  getTransactionSourceProvider, setTransactionSourceProvider, resetTransactionSourceProvider,
} from '../src/modules/feoh/import/provider.js';
import { SourceProviderError } from '../src/modules/feoh/import/providers/types.js';
import { FakeSource, fakeLine } from './fake-source.js';

afterEach(() => resetTransactionSourceProvider());

describe('transaction source seam', () => {
  it('resolves to null when import is disabled (the test env blanks the group)', () => {
    expect(getTransactionSourceProvider()).toBeNull();
  });

  it('returns whatever the test installed, including an explicit null', () => {
    const fake = new FakeSource();
    setTransactionSourceProvider(fake);
    expect(getTransactionSourceProvider()).toBe(fake);
    setTransactionSourceProvider(null);
    expect(getTransactionSourceProvider()).toBeNull();
  });
});

describe('FakeSource', () => {
  it('pages in a stable order and reports a checkpoint that replays everything', async () => {
    const fake = new FakeSource();
    fake.rows = [fakeLine({ sourceId: '1:1', date: '2026-09-02' }), fakeLine({ sourceId: '1:2', date: '2026-09-01' }), fakeLine({ sourceId: '2:1', date: '2026-09-02' })];
    const p1 = await fake.listSince(null, 2);
    expect(p1.items.map((i) => i.sourceId)).toEqual(['1:2', '1:1']);
    expect(p1.nextCursor).toBe('2');
    const p2 = await fake.listSince(p1.nextCursor, 2);
    expect(p2.items.map((i) => i.sourceId)).toEqual(['2:1']);
    expect(p2.nextCursor).toBeNull();
    expect(p2.checkpoint).toBe('0');
  });

  it('throws the configured error', async () => {
    const fake = new FakeSource();
    fake.failWith = new SourceProviderError('auth_failed');
    await expect(fake.listSince(null, 10)).rejects.toBeInstanceOf(SourceProviderError);
  });
});
