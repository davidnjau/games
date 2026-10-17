// ─────────────────────────────────────────────────────────────
// ai.ts — computer opponents for both sides.
//
// Both AIs are "scoring" AIs: list every option, give each a number,
// pick the best (with a pinch of randomness so they aren't robotic).
//
// FAIRNESS: the Kanjo AI receives PublicState — it is literally
// unable to see the hawker. It hunts using the belief set, just like
// a human detective would.
// ─────────────────────────────────────────────────────────────

import { NODES } from './map';
import { STAGE_DISTANCE, UNIT_DISTANCE, bfs, hawkerCanEnter, links } from './graph';
import { askariOptions, hawkerMovesFrom, isRevealRound, type Rng } from './rules';
import type { Askari, MatchState, NodeId, PublicState } from './types';
import type { RULES } from './types';

// ── Hawker AI ────────────────────────────────────────────────

/** Which nodes could any askari land on next squad turn? */
function threatMap(askaris: Askari[], round: number, rules: typeof RULES): Map<NodeId, number> {
  const threat = new Map<NodeId, number>();
  const fake: PublicState = { round, phase: 'KANJO_TURN', rules, askaris: askaris.map((a) => ({ ...a, moved: false })), belief: [], trail: [], lastSeen: null, outcome: null };
  for (const a of askaris) {
    for (const o of askariOptions(fake, a.id)) threat.set(o.to, (threat.get(o.to) ?? 0) + 1);
  }
  return threat;
}

/** Hawker steps to the nearest stage, routing around squad-occupied nodes. */
function escapeDistance(from: NodeId, askaris: Askari[]): number {
  const blocked = new Set(askaris.map((a) => a.node));
  const dist = bfs(from, (l) => hawkerCanEnter(l.to) && !blocked.has(l.to));
  let best = Infinity;
  for (const [id, d] of dist) if (NODES[id].kind === 'STAGE') best = Math.min(best, d);
  return best;
}

export function chooseHawkerMove(state: MatchState, rng: Rng = Math.random): NodeId {
  const moves = hawkerMovesFrom(state.hawkerNode, state.askaris);
  if (moves.length === 0) throw new Error('No moves');

  const exit = moves.find((m) => NODES[m.to].kind === 'STAGE');
  if (exit) return exit.to;

  const threat = threatMap(state.askaris, state.round, state.rules);
  const revealing = isRevealRound(state.round, state.rules.revealEvery);

  let best = moves[0].to;
  let bestScore = -Infinity;
  for (const m of moves) {
    const caughtNext = threat.get(m.to) ?? 0;
    const escape = escapeDistance(m.to, state.askaris);
    // How many safe ways onward from here? Dead ends are traps.
    const exits = hawkerMovesFrom(m.to, state.askaris).filter((n) => !threat.has(n.to)).length;

    let score = 0;
    score -= caughtNext * (revealing ? 90 : 55); // being reachable is worse when you're about to be seen
    score -= Math.min(escape, 8) * 9;
    score += Math.min(exits, 3) * 4;
    if (m.via === 'ALLEY') score += revealing ? 2 : 6; // alleys hide your route (and trucks can't follow)
    score += rng() * 8;

    if (score > bestScore) {
      bestScore = score;
      best = m.to;
    }
  }
  return best;
}

// ── Kanjo AI ─────────────────────────────────────────────────

export interface SquadOrder {
  unitId: string;
  to: NodeId | null; // null = hold position
}

/** Rounds for an askari to get to (or right next to) a node. */
function reachTime(
  a: { kind: Askari['kind']; node: NodeId },
  target: NodeId,
  rules: Pick<typeof RULES, 'truckRange' | 'footRange'>,
): number {
  const table = UNIT_DISTANCE[a.kind][a.node];
  const range = a.kind === 'TRUCK' ? rules.truckRange : rules.footRange;
  const direct = table.get(target);
  if (direct !== undefined) return Math.ceil(direct / range);
  // Trucks can't enter alleys: count the time to the nearest mouth of the alley, plus a bit.
  let best = Infinity;
  for (const l of links(target)) {
    const d = table.get(l.to);
    if (d !== undefined) best = Math.min(best, Math.ceil(d / range) + 0.75);
  }
  return best;
}

/** How dangerous is it if the hawker is on this node? Closer to a stage = more urgent. */
const urgency = (id: NodeId): number => 1 + 8 / (1 + STAGE_DISTANCE[id]) ** 1.3;

/** Lower is better: weighted distance from the squad to every place the hawker might be. */
function coverage(
  units: { kind: Askari['kind']; node: NodeId }[],
  belief: NodeId[],
  rules: Pick<typeof RULES, 'truckRange' | 'footRange'>,
): number {
  let total = 0;
  for (const b of belief) {
    let t = Infinity;
    for (const u of units) t = Math.min(t, reachTime(u, b, rules));
    total += urgency(b) * Math.min(t, 6);
  }
  return total;
}

/**
 * Plans the whole squad's turn at once by trying every combination of
 * moves (small enough here: a truck has ~12 options, a foot askari ~5).
 *
 * `unitIds`, if given, restricts which units the AI decides for — used
 * online when only some askari seats are AI-controlled. Units left out
 * are treated as staying put (not yet-decided human intent isn't planned
 * around); callers should only invoke this once every *un-moved* unit
 * outside `unitIds` has already acted or isn't AI-controlled.
 */
export function chooseSquadOrders(pub: PublicState, rng: Rng = Math.random, unitIds?: string[]): SquadOrder[] {
  const units = pub.askaris.filter((a) => !a.moved && (!unitIds || unitIds.includes(a.id)));
  const optionLists = units.map((u) => [
    null as NodeId | null,
    ...askariOptions(pub, u.id).map((o) => o.to),
  ]);
  const belief = pub.belief;
  const totalUrgency = belief.reduce((s, b) => s + urgency(b), 0) || 1;

  let bestPlan: (NodeId | null)[] = units.map(() => null);
  let bestScore = Infinity;

  const plan: (NodeId | null)[] = [];
  const search = (i: number) => {
    if (i === units.length) {
      const dests = units.map((u, k) => plan[k] ?? u.node);
      if (new Set(dests).size !== dests.length) return; // two askaris on one node
      const placed = pub.askaris.map((a) => {
        const k = units.findIndex((u) => u.id === a.id);
        return { kind: a.kind, node: k >= 0 ? dests[k] : a.node };
      });
      // Landing on a candidate node might catch the hawker; and if not, it rules that node out.
      let catchChance = 0;
      const remaining = belief.filter((b) => {
        if (dests.includes(b)) {
          catchChance += urgency(b) / totalUrgency;
          return false;
        }
        return true;
      });
      const score = coverage(placed, remaining, pub.rules) - catchChance * 120 + rng() * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestPlan = [...plan];
      }
      return;
    }
    for (const opt of optionLists[i]) {
      plan[i] = opt;
      search(i + 1);
    }
  };
  search(0);

  return orderSafely(pub, units.map((u, k) => ({ unitId: u.id, to: bestPlan[k] })));
}

/**
 * Units can't drive through each other, so the order matters.
 * Try orders until every move in the plan is legal when executed in sequence.
 */
function orderSafely(pub: PublicState, orders: SquadOrder[]): SquadOrder[] {
  const perms = permutations(orders);
  for (const p of perms) {
    let s: PublicState = pub;
    let ok = true;
    for (const o of p) {
      if (o.to === null) {
        s = { ...s, askaris: s.askaris.map((a) => (a.id === o.unitId ? { ...a, moved: true } : a)) };
        continue;
      }
      if (!askariOptions(s, o.unitId).some((x) => x.to === o.to)) {
        ok = false;
        break;
      }
      s = { ...s, askaris: s.askaris.map((a) => (a.id === o.unitId ? { ...a, node: o.to!, moved: true } : a)) };
    }
    if (ok) return p;
  }
  return orders.map((o) => ({ ...o, to: null }));
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Small, fast, seedable random number generator (for reproducible simulations and tests). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
