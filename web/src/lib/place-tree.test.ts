import { describe, it, expect } from 'vitest';
import { buildPlaceTree, placePath, subtreeIds } from './place-tree';
import type { EthelPlace } from './types';

const p = (id: string, name: string, parentId: string | null): EthelPlace =>
  ({ id, name, kind: 'room', parentId, notes: null, createdAt: '', updatedAt: '' });

describe('buildPlaceTree', () => {
  it('nests children under parents and sorts siblings by name', () => {
    const tree = buildPlaceTree([p('2', 'Study', '1'), p('1', 'House', null), p('3', 'Kitchen', '1')]);
    expect(tree.length).toBe(1);
    expect(tree[0]!.place.name).toBe('House');
    expect(tree[0]!.children.map((c) => c.place.name)).toEqual(['Kitchen', 'Study']);
  });

  it('renders a place whose parent is missing as a root instead of dropping it', () => {
    // A filtered or partially-loaded response must never make a place vanish.
    const tree = buildPlaceTree([p('9', 'Orphan', 'gone')]);
    expect(tree.map((n) => n.place.name)).toEqual(['Orphan']);
  });

  it('survives a cycle without recursing forever', () => {
    // The server rejects cycles, but the client must not hang if one ever
    // arrives - a stack overflow in a picker takes the whole page down.
    const tree = buildPlaceTree([p('a', 'A', 'b'), p('b', 'B', 'a')]);
    expect(tree.length).toBeGreaterThan(0);
  });
});

describe('placePath', () => {
  it('renders an ancestor path for a nested place', () => {
    const rows = [p('1', 'House', null), p('2', 'Ground floor', '1'), p('3', 'Kitchen', '2')];
    expect(placePath(rows, '3')).toBe('House / Ground floor / Kitchen');
  });
});

describe('placePath under a cycle', () => {
  // Not in the brief. placePath walks UP an arbitrary chain, so an unbounded
  // loop there hangs the render outright - a harder failure than
  // buildPlaceTree's, which merely produces no roots. The `steps` bound is
  // what this pins; without it this test never returns.
  it('terminates on a cycle instead of walking forever', () => {
    const path = placePath([p('a', 'A', 'b'), p('b', 'B', 'a')], 'a');
    expect(typeof path).toBe('string');
    expect(path.length).toBeLessThan(100);
  });
});

describe('subtreeIds', () => {
  it('names the place and everything beneath it, so a reparent cannot offer its own subtree', () => {
    const rows = [p('1', 'House', null), p('2', 'Ground floor', '1'), p('3', 'Kitchen', '2'), p('4', 'Shed', null)];
    expect([...subtreeIds(rows, '1')].sort()).toEqual(['1', '2', '3']);
  });

  it('terminates on a cycle', () => {
    expect(subtreeIds([p('a', 'A', 'b'), p('b', 'B', 'a')], 'a').size).toBeGreaterThan(0);
  });
});
