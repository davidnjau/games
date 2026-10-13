// ─────────────────────────────────────────────────────────────
// types.ts — the vocabulary of Kanjo Escape.
// ─────────────────────────────────────────────────────────────

/** Tunable rule numbers. Balanced by scripts/simulate.ts — change, re-run, compare. */
export const RULES = {
  maxRounds: 15,
  revealEvery: 3, // the hawker is revealed after moving on rounds 3, 6, 9, 12, 15
  truckRange: 2,
  footRange: 1,
};

export type NodeKind = 'JUNCTION' | 'ALLEY' | 'STAGE' | 'DEPOT';
export type EdgeKind = 'ROAD' | 'ALLEY';
export type Side = 'HAWKER' | 'KANJO';
export type UnitKind = 'TRUCK' | 'FOOT';
export type NodeId = string;

export interface MapNode {
  id: NodeId;
  kind: NodeKind;
  x: number; // map units, not pixels
  y: number;
  label: string;
}

export interface MapEdge {
  a: NodeId;
  b: NodeId;
  kind: EdgeKind;
}

export interface Askari {
  id: string;
  kind: UnitKind;
  node: NodeId;
  moved: boolean; // has this unit acted this round?
}

/** One row of the public chase log. Kanjo always learns HOW the hawker moved, not WHERE. */
export interface TrailEntry {
  round: number;
  via: EdgeKind;
  revealedAt: NodeId | null;
}

export type Phase = 'HAWKER_TURN' | 'KANJO_TURN' | 'GAME_OVER';

export type OutcomeReason = 'ESCAPED' | 'CAUGHT' | 'CORNERED' | 'TIME_UP';

export interface Outcome {
  winner: Side;
  reason: OutcomeReason;
  node: NodeId; // where it happened
}

/** Everything both players are allowed to know. */
export interface PublicState {
  round: number;
  phase: Phase;
  askaris: Askari[];
  /** Every node the hawker could be on, deduced from public info only. */
  belief: NodeId[];
  trail: TrailEntry[];
  lastSeen: { node: NodeId; round: number } | null;
  outcome: Outcome | null;
}

/** The full truth. `hawkerNode` is SECRET: never show it to (or feed it to) the Kanjo side. */
export interface MatchState extends PublicState {
  hawkerNode: NodeId;
}

export interface Move {
  to: NodeId;
  via: EdgeKind;
}

/** A destination an askari can reach, with the path it drives (for animation). */
export interface AskariOption {
  to: NodeId;
  path: NodeId[]; // includes start and end
}
