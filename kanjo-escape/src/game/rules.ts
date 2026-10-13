// ─────────────────────────────────────────────────────────────
// rules.ts — the referee. Pure: state in, new state out.
//
// The interesting part of a hidden-movement game is the split
// between TRUTH (where the hawker really is) and PUBLIC knowledge
// (where the hawker could be). We track both:
//   state.hawkerNode  — the secret
//   state.belief      — every node consistent with what Kanjo has seen
// The belief is computed only from public events, so it's exactly
// what a perfect detective would deduce. The UI shows it as the
// "intel" overlay, and the Kanjo AI plans from it — never from the secret.
// ─────────────────────────────────────────────────────────────

import { askariCanEnter, askariCanUse, hawkerCanEnter, links } from './graph';
import { HAWKER_STARTS, NODES, SQUAD_START } from './map';
import {
  RULES,
  type Askari,
  type AskariOption,
  type EdgeKind,
  type MatchState,
  type Move,
  type NodeId,
  type PublicState,
} from './types';

export type Rng = () => number;

export const isRevealRound = (round: number): boolean => round % RULES.revealEvery === 0;

/** Rounds until the next reveal, counting the current round if it is one. */
export const roundsUntilReveal = (round: number): number =>
  (RULES.revealEvery - (round % RULES.revealEvery)) % RULES.revealEvery;

// ── Setup ────────────────────────────────────────────────────

export function createMatch(rng: Rng = Math.random): MatchState {
  const start = HAWKER_STARTS[Math.floor(rng() * HAWKER_STARTS.length)];
  return {
    round: 1,
    phase: 'HAWKER_TURN',
    hawkerNode: start,
    askaris: SQUAD_START.map((s) => ({ ...s, moved: false })),
    belief: [...HAWKER_STARTS],
    trail: [],
    lastSeen: null,
    outcome: null,
  };
}

/** Strip the secret. Anything playing Kanjo gets THIS, never the full state. */
export function publicView(state: MatchState): PublicState {
  const { hawkerNode: _secret, ...pub } = state;
  return pub;
}

const occupied = (askaris: Askari[]) => new Set(askaris.map((a) => a.node));

// ── Hawker ───────────────────────────────────────────────────

/** Moves available to a hawker standing on `from`. */
export function hawkerMovesFrom(from: NodeId, askaris: Askari[]): Move[] {
  const blocked = occupied(askaris);
  return links(from)
    .filter((l) => hawkerCanEnter(l.to) && !blocked.has(l.to))
    .map((l) => ({ to: l.to, via: l.kind }));
}

export const hawkerMoves = (state: MatchState): Move[] =>
  state.phase === 'HAWKER_TURN' ? hawkerMovesFrom(state.hawkerNode, state.askaris) : [];

/**
 * Deduction step. Kanjo knows the old belief, how the hawker moved
 * (road or alley) and where the squad stands. The new belief is every
 * node reachable from an old candidate by that kind of link — minus
 * stages (the game would have ended) and squad-occupied nodes.
 */
export function advanceBelief(belief: NodeId[], via: EdgeKind, askaris: Askari[]): NodeId[] {
  const blocked = occupied(askaris);
  const next = new Set<NodeId>();
  for (const b of belief) {
    for (const l of links(b)) {
      if (l.kind !== via) continue;
      if (!hawkerCanEnter(l.to) || blocked.has(l.to)) continue;
      if (NODES[l.to].kind === 'STAGE') continue;
      next.add(l.to);
    }
  }
  return [...next];
}

export function applyHawkerMove(state: MatchState, to: NodeId): MatchState {
  if (state.phase !== 'HAWKER_TURN') throw new Error('Not the hawker’s turn');
  const move = hawkerMoves(state).find((m) => m.to === to);
  if (!move) throw new Error(`Hawker cannot move to ${to}`);

  if (NODES[to].kind === 'STAGE') {
    return {
      ...state,
      hawkerNode: to,
      trail: [...state.trail, { round: state.round, via: move.via, revealedAt: to }],
      belief: [to],
      phase: 'GAME_OVER',
      outcome: { winner: 'HAWKER', reason: 'ESCAPED', node: to },
    };
  }

  const reveal = isRevealRound(state.round);
  return {
    ...state,
    hawkerNode: to,
    phase: 'KANJO_TURN',
    askaris: state.askaris.map((a) => ({ ...a, moved: false })),
    trail: [...state.trail, { round: state.round, via: move.via, revealedAt: reveal ? to : null }],
    belief: reveal ? [to] : advanceBelief(state.belief, move.via, state.askaris),
    lastSeen: reveal ? { node: to, round: state.round } : state.lastSeen,
  };
}

// ── Kanjo squad ──────────────────────────────────────────────

/**
 * Where can this askari go this turn? BFS up to its range, along links
 * it may use, through nodes it may enter, never through another askari.
 * Works on PublicState: the hawker's position is not needed (and
 * deliberately not known) — driving onto the hawker is how you catch them.
 */
export function askariOptions(state: PublicState, unitId: string): AskariOption[] {
  const unit = state.askaris.find((a) => a.id === unitId);
  if (!unit || unit.moved || state.phase !== 'KANJO_TURN') return [];
  const range = unit.kind === 'TRUCK' ? RULES.truckRange : RULES.footRange;
  const others = new Set(state.askaris.filter((a) => a.id !== unitId).map((a) => a.node));

  const parent = new Map<NodeId, NodeId | null>([[unit.node, null]]);
  let frontier = [unit.node];
  for (let step = 0; step < range; step++) {
    const next: NodeId[] = [];
    for (const at of frontier) {
      for (const l of links(at)) {
        if (parent.has(l.to)) continue;
        if (!askariCanUse(unit.kind, l.kind) || !askariCanEnter(unit.kind, l.to)) continue;
        if (others.has(l.to)) continue;
        parent.set(l.to, at);
        next.push(l.to);
      }
    }
    frontier = next;
  }

  const options: AskariOption[] = [];
  for (const to of parent.keys()) {
    if (to === unit.node) continue;
    const path: NodeId[] = [];
    for (let n: NodeId | null = to; n; n = parent.get(n) ?? null) path.unshift(n);
    options.push({ to, path });
  }
  return options;
}

export function applyAskariMove(state: MatchState, unitId: string, to: NodeId): MatchState {
  const option = askariOptions(state, unitId).find((o) => o.to === to);
  if (!option) throw new Error(`${unitId} cannot move to ${to}`);

  const askaris = state.askaris.map((a) => (a.id === unitId ? { ...a, node: to, moved: true } : a));

  if (to === state.hawkerNode) {
    return {
      ...state,
      askaris,
      belief: [to],
      phase: 'GAME_OVER',
      outcome: { winner: 'KANJO', reason: 'CAUGHT', node: to },
    };
  }
  // A miss is information too: the hawker is not here.
  return { ...state, askaris, belief: state.belief.filter((b) => b !== to) };
}

/** Askari stays put this round (still counts as having acted). */
export function holdAskari(state: MatchState, unitId: string): MatchState {
  if (state.phase !== 'KANJO_TURN') return state;
  return { ...state, askaris: state.askaris.map((a) => (a.id === unitId ? { ...a, moved: true } : a)) };
}

export function endKanjoTurn(state: MatchState): MatchState {
  if (state.phase !== 'KANJO_TURN') throw new Error('Not the squad’s turn');

  if (state.round >= RULES.maxRounds) {
    return { ...state, phase: 'GAME_OVER', outcome: { winner: 'KANJO', reason: 'TIME_UP', node: state.hawkerNode } };
  }
  const next: MatchState = { ...state, round: state.round + 1, phase: 'HAWKER_TURN' };
  if (hawkerMoves(next).length === 0) {
    return { ...next, phase: 'GAME_OVER', outcome: { winner: 'KANJO', reason: 'CORNERED', node: state.hawkerNode } };
  }
  return next;
}
