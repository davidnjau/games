// ─────────────────────────────────────────────────────────────
// sim.ts — play a whole match AI vs AI, no screen involved.
// Used by the tests (to check invariants over many games) and by
// scripts/simulate.ts (to balance the rules).
// ─────────────────────────────────────────────────────────────

import { chooseHawkerMove, chooseSquadOrders, mulberry32 } from './ai';
import { applyAskariMove, applyHawkerMove, createMatch, endKanjoTurn, holdAskari, publicView } from './rules';
import type { MatchState } from './types';

export interface SimResult {
  final: MatchState;
  /** Called after every state change; lets tests check invariants mid-game. */
}

export function simulateMatch(seed: number, onState?: (s: MatchState) => void): MatchState {
  const rng = mulberry32(seed);
  let s = createMatch(rng);
  onState?.(s);
  while (s.phase !== 'GAME_OVER') {
    if (s.phase === 'HAWKER_TURN') {
      s = applyHawkerMove(s, chooseHawkerMove(s, rng));
      onState?.(s);
      continue;
    }
    for (const order of chooseSquadOrders(publicView(s), rng)) {
      s = order.to ? applyAskariMove(s, order.unitId, order.to) : holdAskari(s, order.unitId);
      onState?.(s);
      if (s.phase === 'GAME_OVER') break;
    }
    if (s.phase === 'KANJO_TURN') {
      s = endKanjoTurn(s);
      onState?.(s);
    }
  }
  return s;
}
