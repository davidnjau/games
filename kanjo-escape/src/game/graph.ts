// ─────────────────────────────────────────────────────────────
// graph.ts — who can go where, and how far things are.
// Pure functions over the map. No game state lives here.
// ─────────────────────────────────────────────────────────────

import { EDGES, NODES, STAGE_IDS } from './map';
import type { EdgeKind, NodeId, UnitKind } from './types';

export interface Link {
  to: NodeId;
  kind: EdgeKind;
}

/** Adjacency list, built once: node → its links. */
const ADJ: Record<NodeId, Link[]> = {};
for (const id of Object.keys(NODES)) ADJ[id] = [];
for (const e of EDGES) {
  ADJ[e.a].push({ to: e.b, kind: e.kind });
  ADJ[e.b].push({ to: e.a, kind: e.kind });
}

export const links = (id: NodeId): readonly Link[] => ADJ[id];

export const edgeBetween = (a: NodeId, b: NodeId): Link | undefined =>
  ADJ[a].find((l) => l.to === b);

// ── Movement permissions ─────────────────────────────────────

/** The hawker can go anywhere except the Kanjo depot. */
export const hawkerCanEnter = (id: NodeId): boolean => NODES[id].kind !== 'DEPOT';

/** Askaris are banned from stages; trucks can't squeeze into alleys. */
export function askariCanEnter(kind: UnitKind, id: NodeId): boolean {
  const k = NODES[id].kind;
  if (k === 'STAGE') return false;
  if (kind === 'TRUCK' && k === 'ALLEY') return false;
  return true;
}

export const askariCanUse = (kind: UnitKind, edge: EdgeKind): boolean =>
  kind === 'FOOT' || edge === 'ROAD';

// ── Distances (BFS) ──────────────────────────────────────────

/**
 * Steps from `from` to every reachable node.
 * `canStep(link, fromNode)` decides which links may be followed.
 */
export function bfs(
  from: NodeId,
  canStep: (link: Link, at: NodeId) => boolean,
): Map<NodeId, number> {
  const dist = new Map<NodeId, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const l of ADJ[at]) {
      if (!dist.has(l.to) && canStep(l, at)) {
        dist.set(l.to, dist.get(at)! + 1);
        queue.push(l.to);
      }
    }
  }
  return dist;
}

/** Precomputed: hawker steps from each node to the nearest stage (ignoring askaris). */
export const STAGE_DISTANCE: Readonly<Record<NodeId, number>> = (() => {
  const out: Record<NodeId, number> = {};
  for (const id of Object.keys(NODES)) out[id] = Infinity;
  // Multi-source BFS: start from every stage at once.
  const queue = [...STAGE_IDS];
  for (const s of STAGE_IDS) out[s] = 0;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const l of ADJ[at]) {
      if (out[l.to] === Infinity && hawkerCanEnter(l.to) && NODES[l.to].kind !== 'STAGE') {
        out[l.to] = out[at] + 1;
        queue.push(l.to);
      }
    }
  }
  return out;
})();

/** Precomputed all-pairs distances for each unit kind (ignores other units). */
function allPairs(kind: UnitKind): Record<NodeId, Map<NodeId, number>> {
  const out: Record<NodeId, Map<NodeId, number>> = {};
  for (const id of Object.keys(NODES)) {
    out[id] = askariCanEnter(kind, id)
      ? bfs(id, (l) => askariCanUse(kind, l.kind) && askariCanEnter(kind, l.to))
      : new Map();
  }
  return out;
}

export const UNIT_DISTANCE: Readonly<Record<UnitKind, Record<NodeId, Map<NodeId, number>>>> = {
  TRUCK: allPairs('TRUCK'),
  FOOT: allPairs('FOOT'),
};
