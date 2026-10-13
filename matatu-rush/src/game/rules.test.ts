import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyRoadblock,
  createMatch,
  isStreetBlocked,
  legalMoves,
  routeStillOpen,
  shortestRouteLength,
  validateRoadblock,
} from './rules';
import type { MatchState, Position, Roadblock } from './types';

/** Build a match and drop both vehicles wherever a test needs them. */
function matchWith(p1: Position, p2: Position, roadblocks: Roadblock[] = []): MatchState {
  const m = createMatch('MANYANGA', 'UBER');
  m.players[0].position = p1;
  m.players[1].position = p2;
  m.roadblocks = roadblocks;
  return m;
}

const sortPos = (ps: Position[]) =>
  [...ps].sort((a, b) => a.y - b.y || a.x - b.x).map((p) => `${p.x},${p.y}`);

describe('createMatch', () => {
  it('puts drivers at opposite stages with 10 spikes each', () => {
    const m = createMatch('CHAPAA', 'UBER');
    expect(m.players[0].position).toEqual({ x: 4, y: 0 });
    expect(m.players[1].position).toEqual({ x: 4, y: 8 });
    expect(m.players[0].targetStageY).toBe(8);
    expect(m.players[1].targetStageY).toBe(0);
    expect(m.players.every((p) => p.spikesRemaining === 10)).toBe(true);
    expect(m.currentTurn).toBe(1);
  });
});

describe('isStreetBlocked', () => {
  const h: Roadblock = { x: 3, y: 4, orientation: 'HORIZONTAL' };
  const v: Roadblock = { x: 3, y: 4, orientation: 'VERTICAL' };

  it('horizontal spikes cut the two vertical streets they cover', () => {
    expect(isStreetBlocked({ x: 3, y: 4 }, { x: 3, y: 5 }, [h])).toBe(true);
    expect(isStreetBlocked({ x: 4, y: 5 }, { x: 4, y: 4 }, [h])).toBe(true);
    expect(isStreetBlocked({ x: 5, y: 4 }, { x: 5, y: 5 }, [h])).toBe(false);
    expect(isStreetBlocked({ x: 3, y: 4 }, { x: 4, y: 4 }, [h])).toBe(false);
  });

  it('vertical spikes cut the two horizontal streets they cover', () => {
    expect(isStreetBlocked({ x: 3, y: 4 }, { x: 4, y: 4 }, [v])).toBe(true);
    expect(isStreetBlocked({ x: 4, y: 5 }, { x: 3, y: 5 }, [v])).toBe(true);
    expect(isStreetBlocked({ x: 3, y: 6 }, { x: 4, y: 6 }, [v])).toBe(false);
  });
});

describe('pathfinding', () => {
  it('finds the straight-line distance on an empty board', () => {
    expect(shortestRouteLength({ x: 4, y: 0 }, 8, [])).toBe(8);
  });

  it('counts the detour around a wall', () => {
    const wall: Roadblock = { x: 3, y: 0, orientation: 'HORIZONTAL' };
    // Spikes cover columns 3 and 4 under row 0: one step right to x=5, then 8 down.
    expect(shortestRouteLength({ x: 4, y: 0 }, 8, [wall])).toBe(9);
  });

  it('reports a fully boxed vehicle as gridlocked', () => {
    // Box the corner cell (0,0): one spike below it, one to its right.
    const box: Roadblock[] = [
      { x: 0, y: 0, orientation: 'HORIZONTAL' },
      { x: 0, y: 0, orientation: 'VERTICAL' },
    ];
    // (These two cross at the same centre so the game would never allow it —
    // but the pure pathfinder doesn't care, which is exactly what we want here.)
    expect(routeStillOpen({ x: 0, y: 0 }, 8, box)).toBe(false);
  });
});

describe('legalMoves', () => {
  it('gives four moves in open space', () => {
    const m = matchWith({ x: 4, y: 4 }, { x: 0, y: 8 });
    expect(legalMoves(m)).toHaveLength(4);
  });

  it('respects board edges', () => {
    const m = matchWith({ x: 0, y: 0 }, { x: 8, y: 8 });
    expect(sortPos(legalMoves(m))).toEqual(['1,0', '0,1']);
  });

  it('respects spikes', () => {
    const m = matchWith({ x: 4, y: 4 }, { x: 0, y: 8 }, [
      { x: 4, y: 4, orientation: 'HORIZONTAL' },
    ]);
    expect(sortPos(legalMoves(m))).not.toContain('4,5');
  });

  it('Standard Overtake: jumps straight over a rival', () => {
    const m = matchWith({ x: 4, y: 4 }, { x: 4, y: 5 });
    const moves = sortPos(legalMoves(m));
    expect(moves).toContain('4,6');
    expect(moves).not.toContain('4,5');
  });

  it('Corner Drift: slides diagonally when spikes are behind the rival', () => {
    const m = matchWith({ x: 4, y: 4 }, { x: 4, y: 5 }, [
      { x: 4, y: 5, orientation: 'HORIZONTAL' }, // behind rival
    ]);
    const moves = sortPos(legalMoves(m));
    expect(moves).toContain('3,5');
    expect(moves).toContain('5,5');
    expect(moves).not.toContain('4,6');
  });

  it('Corner Drift also triggers at the board edge', () => {
    const m = matchWith({ x: 4, y: 7 }, { x: 4, y: 8 });
    const moves = sortPos(legalMoves(m));
    expect(moves).toContain('3,8');
    expect(moves).toContain('5,8');
  });
});

describe('applyMove', () => {
  it('moves the vehicle and passes the turn', () => {
    const next = applyMove(createMatch('MANYANGA', 'UBER'), { x: 4, y: 1 });
    expect(next.players[0].position).toEqual({ x: 4, y: 1 });
    expect(next.currentTurn).toBe(2);
  });

  it('rejects illegal moves', () => {
    expect(() => applyMove(createMatch('MANYANGA', 'UBER'), { x: 4, y: 3 })).toThrow();
  });

  it('declares a winner on reaching the stage', () => {
    const m = matchWith({ x: 2, y: 7 }, { x: 6, y: 3 });
    const next = applyMove(m, { x: 2, y: 8 });
    expect(next.phase).toBe('GAME_OVER');
    expect(next.winner).toBe(1);
  });
});

describe('validateRoadblock / applyRoadblock', () => {
  const base = () => createMatch('MANYANGA', 'UBER');

  it('accepts a normal spike and spends one', () => {
    const rb: Roadblock = { x: 3, y: 3, orientation: 'HORIZONTAL' };
    expect(validateRoadblock(base(), rb)).toEqual({ ok: true });
    const next = applyRoadblock(base(), rb);
    expect(next.players[0].spikesRemaining).toBe(9);
    expect(next.roadblocks).toHaveLength(1);
    expect(next.currentTurn).toBe(2);
  });

  it('rejects out-of-bounds grooves', () => {
    expect(validateRoadblock(base(), { x: 8, y: 0, orientation: 'VERTICAL' })).toEqual({
      ok: false,
      reason: 'OUT_OF_BOUNDS',
    });
  });

  it('rejects crossing and overlapping spikes', () => {
    const m = base();
    m.roadblocks = [{ x: 3, y: 3, orientation: 'HORIZONTAL' }];
    expect(validateRoadblock(m, { x: 3, y: 3, orientation: 'VERTICAL' })).toMatchObject({
      reason: 'OVERLAP',
    });
    expect(validateRoadblock(m, { x: 4, y: 3, orientation: 'HORIZONTAL' })).toMatchObject({
      reason: 'OVERLAP',
    });
    // Two apart is fine — they touch end to end.
    expect(validateRoadblock(m, { x: 5, y: 3, orientation: 'HORIZONTAL' })).toEqual({ ok: true });
  });

  it('GRIDLOCK: refuses the final spike that would seal a driver in', () => {
    // Fence player 1 into the 2x2 top-left pocket: cells (0,0),(1,0),(0,1),(1,1).
    const m = matchWith({ x: 0, y: 0 }, { x: 8, y: 8 }, [
      { x: 1, y: 0, orientation: 'VERTICAL' }, // right side of the pocket
    ]);
    // A horizontal spike under the pocket closes it completely.
    expect(validateRoadblock(m, { x: 0, y: 1, orientation: 'HORIZONTAL' })).toEqual({
      ok: false,
      reason: 'GRIDLOCK',
    });
  });

  it('rejects when the driver has no spikes left', () => {
    const m = base();
    m.players[0].spikesRemaining = 0;
    expect(validateRoadblock(m, { x: 3, y: 3, orientation: 'HORIZONTAL' })).toMatchObject({
      reason: 'NO_SPIKES',
    });
  });
});
