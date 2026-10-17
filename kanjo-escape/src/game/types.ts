// ─────────────────────────────────────────────────────────────
// types.ts — the vocabulary of Kanjo Escape.
// ─────────────────────────────────────────────────────────────

/** Tunable rule numbers. Balanced by scripts/simulate.ts — change, re-run, compare. */
export const RULES = {
  maxRounds: 15,
  revealEvery: 3, // the hawker is revealed after moving on rounds 3, 6, 9, 12, 15
  truckRange: 2,
  footRange: 1,
  trafficChance: 0.08, // chance a ROAD move jams, skipping the hawker's next turn
  bailCostBase: 15, // coins for a 1st bail; escalates with RULES-derived bailCost()
  escapeCoinsBase: 10, // minimum coins for reaching a stage
  escapeCoinsPerRound: 2, // bonus coins per round still left on the clock
  jailFreeCardCost: 10, // a one-time pass that substitutes for paying bail
};

export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';

/** Deltas from the RULES baseline above (which is NORMAL). Merged by `rulesFor()`. */
export const DIFFICULTY_RULES: Record<Difficulty, Partial<typeof RULES>> = {
  EASY: { revealEvery: 4, trafficChance: 0.03 },
  NORMAL: {},
  HARD: { revealEvery: 2, truckRange: 3, trafficChance: 0.16 },
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
  /** Traffic jammed this move: the squad gets a bonus round before the hawker moves again. */
  trafficked?: boolean;
}

export type Phase = 'HAWKER_TURN' | 'KANJO_TURN' | 'BAIL_DECISION' | 'GAME_OVER';

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
  /** The ruleset this match was created with (NORMAL unless a difficulty was chosen). */
  rules: typeof RULES;
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
  /**
   * Set when the hawker's last move rolled traffic. The *effect* (the squad
   * getting a bonus round) is public via `endKanjoTurn`'s phase not advancing
   * and the trail's `trafficked` flag — this raw boolean itself stays off
   * `PublicState` since the Kanjo AI doesn't need it to act optimally.
   */
  trafficDelay: boolean;
  /**
   * Set the instant an askari lands on the hawker; cleared by `payBail`/`declineBail`.
   * Like `trafficDelay`, nothing in `ai.ts` needs this to act, so it stays off `PublicState`.
   */
  pendingCapture: { node: NodeId } | null;
  /** How many times bail has been paid this match — `bailCost()` escalates with it. */
  bailsUsed: number;
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
