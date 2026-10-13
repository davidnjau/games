// ─────────────────────────────────────────────────────────────
// rules.ts — the game's brain.
//
// Everything here is PURE: functions take a state and return a
// new state or an answer. No canvas, no DOM, no Math.random, no
// time. That makes the rules easy to test and easy to reuse later
// (an AI opponent, an online server, a Kotlin port...).
// ─────────────────────────────────────────────────────────────

import {
  BOARD_SIZE,
  GROOVE_COUNT,
  SPIKES_PER_PLAYER,
  type MatchState,
  type Player,
  type PlayerId,
  type Position,
  type Roadblock,
  type SpikeCheck,
  type VehicleType,
} from './types';

export const PLAYER_COLORS: Record<PlayerId, string> = {
  1: '#FFCC00',
  2: '#00FF66',
};

const DIRECTIONS: Position[] = [
  { x: 0, y: -1 }, // up
  { x: 0, y: 1 }, // down
  { x: -1, y: 0 }, // left
  { x: 1, y: 0 }, // right
];

// ── Small helpers ────────────────────────────────────────────

export const samePos = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y;

export const addPos = (a: Position, b: Position): Position => ({ x: a.x + b.x, y: a.y + b.y });

export const inBounds = (p: Position): boolean =>
  p.x >= 0 && p.x < BOARD_SIZE && p.y >= 0 && p.y < BOARD_SIZE;

export const otherPlayer = (id: PlayerId): PlayerId => (id === 1 ? 2 : 1);

export const getPlayer = (state: MatchState, id: PlayerId): Player => state.players[id - 1];

export const activePlayer = (state: MatchState): Player => getPlayer(state, state.currentTurn);

// ── Match creation ───────────────────────────────────────────

export function createMatch(p1Vehicle: VehicleType, p2Vehicle: VehicleType): MatchState {
  const mid = Math.floor(BOARD_SIZE / 2);
  return {
    players: [
      {
        id: 1,
        vehicleType: p1Vehicle,
        position: { x: mid, y: 0 },
        targetStageY: BOARD_SIZE - 1,
        spikesRemaining: SPIKES_PER_PLAYER,
        color: PLAYER_COLORS[1],
      },
      {
        id: 2,
        vehicleType: p2Vehicle,
        position: { x: mid, y: BOARD_SIZE - 1 },
        targetStageY: 0,
        spikesRemaining: SPIKES_PER_PLAYER,
        color: PLAYER_COLORS[2],
      },
    ],
    currentTurn: 1,
    phase: 'CHOOSE_ACTION',
    mode: 'DRIVE',
    roadblocks: [],
    winner: null,
    turnNumber: 1,
  };
}

// ── The street graph ─────────────────────────────────────────
// We never store edges explicitly. An edge between two adjacent
// junctions exists unless a roadblock cuts it. That's cheaper and
// means "dropping spikes" is just pushing to an array.

/** Is the street between two orthogonally-adjacent junctions cut by spikes? */
export function isStreetBlocked(a: Position, b: Position, roadblocks: Roadblock[]): boolean {
  if (a.x === b.x) {
    // Moving up/down crosses a HORIZONTAL groove at row min(a.y, b.y).
    const grooveY = Math.min(a.y, b.y);
    return roadblocks.some(
      (r) => r.orientation === 'HORIZONTAL' && r.y === grooveY && (r.x === a.x || r.x === a.x - 1),
    );
  }
  // Moving left/right crosses a VERTICAL groove at column min(a.x, b.x).
  const grooveX = Math.min(a.x, b.x);
  return roadblocks.some(
    (r) => r.orientation === 'VERTICAL' && r.x === grooveX && (r.y === a.y || r.y === a.y - 1),
  );
}

/** Neighbouring junctions you can drive to (ignores the other vehicle). */
export function openStreets(from: Position, roadblocks: Roadblock[]): Position[] {
  return DIRECTIONS.map((d) => addPos(from, d)).filter(
    (to) => inBounds(to) && !isStreetBlocked(from, to, roadblocks),
  );
}

// ── Pathfinding (Breadth-First Search) ───────────────────────

/**
 * Fewest steps from `start` to any junction on row `targetY`,
 * or -1 if the vehicle is completely boxed in.
 * BFS explores in "rings" of equal distance, so the first time we
 * touch the target row we've found the shortest route.
 */
export function shortestRouteLength(
  start: Position,
  targetY: number,
  roadblocks: Roadblock[],
): number {
  const key = (p: Position) => p.y * BOARD_SIZE + p.x;
  const distance = new Map<number, number>([[key(start), 0]]);
  const queue: Position[] = [start];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const d = distance.get(key(current))!;
    if (current.y === targetY) return d;

    for (const next of openStreets(current, roadblocks)) {
      if (!distance.has(key(next))) {
        distance.set(key(next), d + 1);
        queue.push(next);
      }
    }
  }
  return -1;
}

/** Blueprint 4.1 — does at least one route to the stage still exist? */
export function routeStillOpen(start: Position, targetY: number, roadblocks: Roadblock[]): boolean {
  return shortestRouteLength(start, targetY, roadblocks) >= 0;
}

// ── Driving ──────────────────────────────────────────────────

/**
 * All junctions the active driver may move to this turn, including
 * the Overtake (straight jump) and Corner Drift (diagonal) rules.
 */
export function legalMoves(state: MatchState): Position[] {
  const me = activePlayer(state);
  const rival = getPlayer(state, otherPlayer(me.id));
  const { roadblocks } = state;
  const moves: Position[] = [];

  for (const dir of DIRECTIONS) {
    const next = addPos(me.position, dir);
    if (!inBounds(next) || isStreetBlocked(me.position, next, roadblocks)) continue;

    if (!samePos(next, rival.position)) {
      moves.push(next);
      continue;
    }

    // Rival is nose-to-tail with us → try to overtake.
    const jump = addPos(next, dir);
    if (inBounds(jump) && !isStreetBlocked(next, jump, roadblocks)) {
      moves.push(jump); // Standard Overtake
      continue;
    }

    // Spikes (or the board edge) behind the rival → Corner Drift.
    const sideways: Position[] =
      dir.x === 0 ? [{ x: -1, y: 0 }, { x: 1, y: 0 }] : [{ x: 0, y: -1 }, { x: 0, y: 1 }];
    for (const side of sideways) {
      const drift = addPos(next, side);
      if (inBounds(drift) && !isStreetBlocked(next, drift, roadblocks)) moves.push(drift);
    }
  }
  return moves;
}

export function isLegalMove(state: MatchState, to: Position): boolean {
  return legalMoves(state).some((m) => samePos(m, to));
}

/** Returns the next state after driving. Throws on illegal input. */
export function applyMove(state: MatchState, to: Position): MatchState {
  if (state.phase !== 'CHOOSE_ACTION') throw new Error('Not accepting moves right now');
  if (!isLegalMove(state, to)) throw new Error(`Illegal move to ${to.x},${to.y}`);

  const players = state.players.map((p) =>
    p.id === state.currentTurn ? { ...p, position: { ...to } } : p,
  ) as [Player, Player];

  const mover = players[state.currentTurn - 1];
  if (to.y === mover.targetStageY) {
    return { ...state, players, phase: 'GAME_OVER', winner: mover.id };
  }
  return endTurn({ ...state, players });
}

// ── Dropping Kanjo Spikes ────────────────────────────────────

/** Every check from blueprint 4.1, plus the physical overlap rules. */
export function validateRoadblock(state: MatchState, rb: Roadblock): SpikeCheck {
  if (activePlayer(state).spikesRemaining <= 0) return { ok: false, reason: 'NO_SPIKES' };

  if (rb.x < 0 || rb.x >= GROOVE_COUNT || rb.y < 0 || rb.y >= GROOVE_COUNT) {
    return { ok: false, reason: 'OUT_OF_BOUNDS' };
  }

  for (const w of state.roadblocks) {
    // Same centre: identical spike, or one crossing the other like a "+".
    if (w.x === rb.x && w.y === rb.y) return { ok: false, reason: 'OVERLAP' };
    // Same direction and shifted by one: they'd share half their length.
    if (w.orientation === rb.orientation) {
      if (rb.orientation === 'HORIZONTAL' && w.y === rb.y && Math.abs(w.x - rb.x) === 1) {
        return { ok: false, reason: 'OVERLAP' };
      }
      if (rb.orientation === 'VERTICAL' && w.x === rb.x && Math.abs(w.y - rb.y) === 1) {
        return { ok: false, reason: 'OVERLAP' };
      }
    }
  }

  // The anti-trapping rule: test on a COPY of the network, for BOTH drivers.
  const proposed = [...state.roadblocks, rb];
  const allOpen = state.players.every((p) =>
    routeStillOpen(p.position, p.targetStageY, proposed),
  );
  if (!allOpen) return { ok: false, reason: 'GRIDLOCK' };

  return { ok: true };
}

/** Returns the next state after dropping spikes. Throws on invalid input. */
export function applyRoadblock(state: MatchState, rb: Roadblock): MatchState {
  if (state.phase !== 'CHOOSE_ACTION') throw new Error('Not accepting spikes right now');
  const check = validateRoadblock(state, rb);
  if (!check.ok) throw new Error(`Invalid roadblock: ${check.reason}`);

  const players = state.players.map((p) =>
    p.id === state.currentTurn ? { ...p, spikesRemaining: p.spikesRemaining - 1 } : p,
  ) as [Player, Player];

  return endTurn({ ...state, players, roadblocks: [...state.roadblocks, { ...rb }] });
}

// ── Turn switching ───────────────────────────────────────────

function endTurn(state: MatchState): MatchState {
  return {
    ...state,
    currentTurn: otherPlayer(state.currentTurn),
    mode: 'DRIVE',
    turnNumber: state.turnNumber + 1,
  };
}

export function setMode(state: MatchState, mode: MatchState['mode']): MatchState {
  if (state.phase !== 'CHOOSE_ACTION') return state;
  if (mode === 'SPIKES' && activePlayer(state).spikesRemaining <= 0) return state;
  return { ...state, mode };
}
