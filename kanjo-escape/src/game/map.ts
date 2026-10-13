// ─────────────────────────────────────────────────────────────
// map.ts — a stylised Nairobi CBD as a graph.
//
// Streets are a grid of JUNCTIONS joined by ROAD edges. Narrow
// ALLEY nodes cut through some blocks; only people on foot can use
// them. Four matatu STAGES on the edge are the hawker's exits, and
// the Kanjo DEPOT at Machakos is the squad's base.
//
// Coordinates are in "map units": 2 units between streets.
// ─────────────────────────────────────────────────────────────

import type { EdgeKind, MapEdge, MapNode, NodeId } from './types';

const COLUMNS = [
  { key: 'kimathi', name: 'Kimathi St', x: 1 },
  { key: 'moi', name: 'Moi Ave', x: 3 },
  { key: 'tom', name: 'Tom Mboya', x: 5 },
  { key: 'latema', name: 'Latema Rd', x: 7 },
  { key: 'accra', name: 'Accra Rd', x: 9 },
  { key: 'race', name: 'Racecourse Rd', x: 11 },
];

const ROWS = [
  { key: 'moktar', name: 'Moktar Daddah', y: 1 },
  { key: 'muranga', name: "Murang'a Rd", y: 3 },
  { key: 'kenyatta', name: 'Kenyatta Ave', y: 5 },
  { key: 'ronald', name: 'Ronald Ngala', y: 7 },
  { key: 'river', name: 'River Rd', y: 9 },
  { key: 'luthuli', name: 'Luthuli Ave', y: 11 },
  { key: 'haile', name: 'Haile Selassie', y: 13 },
];

export const STREET_LABELS = { columns: COLUMNS, rows: ROWS };

const jid = (c: string, r: string) => `${c}-${r}`;

// Road segments that DON'T exist — breaks the perfect grid so the city has character.
const CLOSED_ROADS: [NodeId, NodeId][] = [
  ['kimathi-moktar', 'kimathi-muranga'],
  ['tom-moktar', 'latema-moktar'],
  ['latema-muranga', 'accra-muranga'],
  ['tom-ronald', 'latema-ronald'],
  ['moi-river', 'moi-luthuli'],
  ['latema-river', 'latema-luthuli'],
  ['accra-luthuli', 'race-luthuli'],
];

const ALLEYS: { id: NodeId; label: string; x: number; y: number; links: NodeId[] }[] = [
  { id: 'alley-biashara', label: 'Biashara St', x: 4, y: 2, links: ['moi-moktar', 'tom-muranga'] },
  { id: 'alley-gakere', label: 'Gakere Lane', x: 10, y: 2, links: ['accra-moktar', 'race-muranga'] },
  { id: 'alley-banda', label: 'Banda St', x: 2, y: 4, links: ['kimathi-muranga', 'moi-kenyatta'] },
  { id: 'alley-ngariama', label: 'Ngariama Lane', x: 8, y: 4, links: ['latema-kenyatta', 'accra-muranga'] },
  { id: 'alley-gaberone', label: 'Gaberone Rd', x: 6, y: 6, links: ['tom-kenyatta', 'latema-ronald'] },
  { id: 'alley-dubois', label: 'Dubois Rd', x: 10, y: 6, links: ['accra-kenyatta', 'race-ronald'] },
  { id: 'alley-koinange', label: 'Koinange St', x: 2, y: 8, links: ['kimathi-ronald', 'moi-river'] },
  { id: 'alley-cross', label: 'Cross Lane', x: 4, y: 8, links: ['moi-ronald', 'tom-river'] },
  { id: 'alley-mfangano', label: 'Mfangano St', x: 8, y: 8, links: ['latema-river', 'accra-ronald'] },
  { id: 'alley-kirinyaga', label: 'Kirinyaga Rd', x: 6, y: 10, links: ['latema-river', 'tom-luthuli'] },
  { id: 'alley-duruma', label: 'Duruma Rd', x: 10, y: 10, links: ['accra-river', 'race-luthuli'] },
  { id: 'alley-wabera', label: 'Wabera St', x: 2, y: 12, links: ['kimathi-luthuli', 'moi-haile'] },
  { id: 'alley-taveta', label: 'Taveta Rd', x: 4, y: 12, links: ['moi-luthuli', 'tom-haile'] },
  { id: 'alley-mwea', label: 'Mwea Lane', x: 8, y: 12, links: ['latema-haile', 'accra-luthuli'] },
];

/** Hawker exits. Askaris may not enter a stage: it's packed with matatus and touts. */
const STAGES: { id: NodeId; label: string; x: number; y: number; links: NodeId[] }[] = [
  { id: 'stage-khoja', label: 'Khoja', x: -0.6, y: 6, links: ['kimathi-kenyatta', 'kimathi-ronald'] },
  { id: 'stage-archives', label: 'Archives', x: 6, y: -0.6, links: ['tom-moktar', 'latema-moktar'] },
  { id: 'stage-railways', label: 'Railways', x: 6, y: 14.6, links: ['tom-haile', 'latema-haile'] },
  { id: 'stage-odeon', label: 'Odeon', x: 12.6, y: 10, links: ['race-river', 'race-luthuli'] },
];

const DEPOT = { id: 'depot-machakos', label: 'Kanjo HQ · Machakos', x: 12.6, y: 14, links: ['race-haile'] };

// ── Build nodes and edges ────────────────────────────────────

const nodes: Record<NodeId, MapNode> = {};
const edges: MapEdge[] = [];
const addEdge = (a: NodeId, b: NodeId, kind: EdgeKind) => edges.push({ a, b, kind });
const closed = new Set(CLOSED_ROADS.map(([a, b]) => [a, b].sort().join('|')));

for (const c of COLUMNS) {
  for (const r of ROWS) {
    const id = jid(c.key, r.key);
    nodes[id] = { id, kind: 'JUNCTION', x: c.x, y: r.y, label: `${c.name} / ${r.name}` };
  }
}
COLUMNS.forEach((c, ci) =>
  ROWS.forEach((r, ri) => {
    const here = jid(c.key, r.key);
    const neighbours = [
      ci + 1 < COLUMNS.length ? jid(COLUMNS[ci + 1].key, r.key) : null,
      ri + 1 < ROWS.length ? jid(c.key, ROWS[ri + 1].key) : null,
    ];
    for (const n of neighbours) {
      if (n && !closed.has([here, n].sort().join('|'))) addEdge(here, n, 'ROAD');
    }
  }),
);

for (const a of ALLEYS) {
  nodes[a.id] = { id: a.id, kind: 'ALLEY', x: a.x, y: a.y, label: a.label };
  for (const l of a.links) addEdge(a.id, l, 'ALLEY');
}
for (const s of STAGES) {
  nodes[s.id] = { id: s.id, kind: 'STAGE', x: s.x, y: s.y, label: s.label };
  for (const l of s.links) addEdge(s.id, l, 'ROAD');
}
nodes[DEPOT.id] = { id: DEPOT.id, kind: 'DEPOT', x: DEPOT.x, y: DEPOT.y, label: DEPOT.label };
for (const l of DEPOT.links) addEdge(DEPOT.id, l, 'ROAD');

export const NODES: Readonly<Record<NodeId, MapNode>> = nodes;
export const EDGES: readonly MapEdge[] = edges;
export const STAGE_IDS: readonly NodeId[] = STAGES.map((s) => s.id);

/** Where the hawker might start. This list is PUBLIC; which one was picked is secret. */
export const HAWKER_STARTS: readonly NodeId[] = ['latema-river', 'accra-ronald', 'alley-gaberone', 'moi-river', 'accra-muranga'];

/** The squad. Names and starts follow the original playthrough log. */
export const SQUAD_START = [
  { id: 'askari_1', kind: 'TRUCK', node: 'tom-haile' },
  { id: 'askari_2', kind: 'FOOT', node: 'tom-ronald' },
  { id: 'askari_3', kind: 'TRUCK', node: 'depot-machakos' },
] as const;
