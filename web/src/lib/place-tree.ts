import type { EthelPlace } from './types';

export interface PlaceNode {
  place: EthelPlace;
  children: PlaceNode[];
}

/** Assemble the flat GET /places response into a tree. Cycle-safe and
 *  orphan-safe by construction: a node is attached at most once, and anything
 *  not attached to a real parent surfaces as a root rather than vanishing. */
export function buildPlaceTree(rows: EthelPlace[]): PlaceNode[] {
  const byId = new Map(rows.map((r) => [r.id, { place: r, children: [] as PlaceNode[] }]));
  const roots: PlaceNode[] = [];
  const attached = new Set<string>();

  for (const node of byId.values()) {
    const parent = node.place.parentId ? byId.get(node.place.parentId) : undefined;
    // Reject a parent that is already a descendant of this node, so a cycle
    // arriving from the server cannot build an infinite structure.
    if (parent && parent !== node && !isDescendant(byId, node.place.id, parent.place.id)) {
      parent.children.push(node);
      attached.add(node.place.id);
    }
  }
  for (const node of byId.values()) if (!attached.has(node.place.id)) roots.push(node);

  const sort = (nodes: PlaceNode[]): void => {
    nodes.sort((a, b) => a.place.name.localeCompare(b.place.name));
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

/** Is `candidateId` inside the subtree rooted at `rootId`? Walks UP from the
 *  candidate, bounded by the number of rows, so it terminates on any input. */
export function isDescendant(byId: Map<string, PlaceNode>, rootId: string, candidateId: string): boolean {
  let cursor: string | null | undefined = candidateId;
  for (let steps = 0; cursor && steps <= byId.size; steps++) {
    if (cursor === rootId) return true;
    cursor = byId.get(cursor)?.place.parentId;
  }
  return false;
}

/** The ids of `id` and everything beneath it, resolved from the flat row set.
 *  Used by the place manager to keep a place out of its own subtree when
 *  reparenting: the server answers PLACE_CYCLE, but the picker should not be
 *  able to offer the move in the first place. Bounded by `rows.length` per
 *  row, so a cycle cannot hang it. */
export function subtreeIds(rows: EthelPlace[], id: string): Set<string> {
  const byId = new Map(rows.map((r) => [r.id, { place: r, children: [] as PlaceNode[] }]));
  const ids = new Set<string>([id]);
  for (const row of rows) if (isDescendant(byId, id, row.id)) ids.add(row.id);
  return ids;
}

/** "House / Ground floor / Kitchen" - used on the asset card and in the
 *  picker's selected label. */
export function placePath(rows: EthelPlace[], id: string): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names: string[] = [];
  let cursor: string | null | undefined = id;
  for (let steps = 0; cursor && steps <= rows.length; steps++) {
    const row = byId.get(cursor);
    if (!row) break;
    names.unshift(row.name);
    cursor = row.parentId;
  }
  return names.join(' / ');
}

/** Depth-first flattening of the tree, for rendering an indented <select>. */
export function flattenPlaceTree(nodes: PlaceNode[], depth = 0): Array<{ place: EthelPlace; depth: number }> {
  const out: Array<{ place: EthelPlace; depth: number }> = [];
  for (const node of nodes) {
    out.push({ place: node.place, depth });
    out.push(...flattenPlaceTree(node.children, depth + 1));
  }
  return out;
}
