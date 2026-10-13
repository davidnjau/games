import { describe, expect, it } from 'vitest';
import { chooseHawkerMove, chooseSquadOrders, mulberry32 } from './ai';
import { STAGE_DISTANCE, askariCanEnter, links } from './graph';
import { EDGES, HAWKER_STARTS, NODES, STAGE_IDS } from './map';
import {
  advanceBelief,
  applyAskariMove,
  applyHawkerMove,
  askariOptions,
  createMatch,
  endKanjoTurn,
  hawkerMoves,
  isRevealRound,
  publicView,
} from './rules';
import { simulateMatch } from './sim';
import { RULES, type MatchState } from './types';

/** A match with the hawker and squad wherever a test needs them. */
function setup(hawker: string, squad: Record<string, string> = {}): MatchState {
  const m = createMatch(() => 0);
  m.hawkerNode = hawker;
  m.belief = [hawker];
  m.askaris = m.askaris.map((a) => ({ ...a, node: squad[a.id] ?? a.node }));
  return m;
}

const toKanjoTurn = (m: MatchState): MatchState => ({ ...m, phase: 'KANJO_TURN' });

describe('map', () => {
  it('every edge joins two real nodes', () => {
    for (const e of EDGES) {
      expect(NODES[e.a]).toBeDefined();
      expect(NODES[e.b]).toBeDefined();
    }
  });

  it('every stage is reachable by the hawker from every start', () => {
    for (const s of HAWKER_STARTS) expect(STAGE_DISTANCE[s]).toBeLessThan(Infinity);
  });

  it('alleys only connect by ALLEY links; stages only by ROAD links', () => {
    for (const e of EDGES) {
      const kinds = [NODES[e.a].kind, NODES[e.b].kind];
      if (kinds.includes('ALLEY')) expect(e.kind).toBe('ALLEY');
      if (kinds.includes('STAGE')) expect(e.kind).toBe('ROAD');
    }
  });
});

describe('movement permissions', () => {
  it('askaris may never enter a stage; trucks may never enter an alley', () => {
    for (const s of STAGE_IDS) {
      expect(askariCanEnter('TRUCK', s)).toBe(false);
      expect(askariCanEnter('FOOT', s)).toBe(false);
    }
    expect(askariCanEnter('TRUCK', 'alley-cross')).toBe(false);
    expect(askariCanEnter('FOOT', 'alley-cross')).toBe(true);
  });

  it('the hawker cannot step onto an askari', () => {
    const m = setup('tom-river', { askari_2: 'tom-luthuli' });
    expect(hawkerMoves(m).map((x) => x.to)).not.toContain('tom-luthuli');
  });

  it('the hawker cannot enter the Kanjo depot', () => {
    const m = setup('race-haile', { askari_3: 'race-kenyatta' });
    expect(hawkerMoves(m).map((x) => x.to)).not.toContain('depot-machakos');
  });

  it('a truck reaches 2 road steps, never into an alley or through another askari', () => {
    const m = toKanjoTurn(setup('race-moktar', { askari_1: 'latema-river', askari_2: 'accra-river' }));
    const dests = askariOptions(publicView(m), 'askari_1').map((o) => o.to);
    expect(dests).toContain('latema-ronald'); // one road step north
    expect(dests).not.toContain('alley-mfangano'); // alley
    expect(dests).not.toContain('accra-river'); // occupied
    expect(dests).not.toContain('race-river'); // only reachable THROUGH the foot askari
    for (const d of dests) expect(NODES[d].kind).not.toBe('ALLEY');
  });

  it('a foot askari moves exactly 1 step, alleys allowed', () => {
    const m = toKanjoTurn(setup('race-moktar', { askari_2: 'moi-ronald' }));
    const dests = askariOptions(publicView(m), 'askari_2').map((o) => o.to).sort();
    const expected = links('moi-ronald')
      .filter((l) => askariCanEnter('FOOT', l.to))
      .map((l) => l.to)
      .sort();
    expect(dests).toEqual(expected);
    expect(dests).toContain('alley-cross');
  });
});

describe('win conditions', () => {
  it('ESCAPED: hawker reaches a stage', () => {
    const m = setup('kimathi-ronald');
    const end = applyHawkerMove(m, 'stage-khoja');
    expect(end.outcome).toMatchObject({ winner: 'HAWKER', reason: 'ESCAPED' });
  });

  it('CAUGHT: an askari lands on the hawker', () => {
    const m = toKanjoTurn(setup('tom-kenyatta', { askari_2: 'tom-ronald' }));
    const end = applyAskariMove(m, 'askari_2', 'tom-kenyatta');
    expect(end.outcome).toMatchObject({ winner: 'KANJO', reason: 'CAUGHT' });
  });

  it('a miss removes that node from the belief', () => {
    const m = toKanjoTurn(setup('alley-cross', { askari_2: 'tom-ronald' }));
    m.belief = ['tom-kenyatta', 'alley-cross'];
    const next = applyAskariMove(m, 'askari_2', 'tom-kenyatta');
    expect(next.outcome).toBeNull();
    expect(next.belief).toEqual(['alley-cross']);
  });

  it('TIME_UP: squad wins when the last round ends', () => {
    const m = toKanjoTurn(setup('race-moktar'));
    m.round = RULES.maxRounds;
    expect(endKanjoTurn(m).outcome).toMatchObject({ winner: 'KANJO', reason: 'TIME_UP' });
  });

  it('CORNERED: squad wins if the hawker has no legal move', () => {
    // Hawker in Cross Lane; both ends blocked by askaris.
    const m = toKanjoTurn(setup('alley-cross', { askari_1: 'moi-ronald', askari_2: 'tom-river' }));
    expect(endKanjoTurn(m).outcome).toMatchObject({ winner: 'KANJO', reason: 'CORNERED' });
  });
});

describe('hidden information', () => {
  it('publicView strips the secret', () => {
    const pub = publicView(createMatch(mulberry32(7)));
    expect('hawkerNode' in pub).toBe(false);
  });

  it('reveal rounds expose the hawker and collapse the belief', () => {
    const m = setup('latema-river');
    m.round = RULES.revealEvery;
    m.belief = ['latema-river', 'accra-ronald'];
    const next = applyHawkerMove(m, 'latema-ronald');
    expect(isRevealRound(m.round)).toBe(true);
    expect(next.belief).toEqual(['latema-ronald']);
    expect(next.lastSeen).toEqual({ node: 'latema-ronald', round: m.round });
  });

  it('non-reveal rounds only publish HOW the hawker moved', () => {
    const m = setup('latema-river');
    m.round = 1;
    const next = applyHawkerMove(m, 'alley-mfangano');
    expect(next.trail.at(-1)).toEqual({ round: 1, via: 'ALLEY', revealedAt: null });
  });

  it('advanceBelief follows only links of the announced kind', () => {
    const b = advanceBelief(['tom-river'], 'ALLEY', []);
    expect(b.sort()).toEqual(['alley-cross', 'alley-kirinyaga'].filter((x) => links('tom-river').some((l) => l.to === x)).sort());
  });

  it('INVARIANT: across 300 AI games the true hawker node is always inside the belief', () => {
    for (let seed = 1; seed <= 300; seed++) {
      simulateMatch(seed, (s) => {
        if (s.phase !== 'GAME_OVER') expect(s.belief).toContain(s.hawkerNode);
      });
    }
  });

  it('INVARIANT: squad AI decisions do not depend on the secret', () => {
    const m = createMatch(mulberry32(3));
    const afterMove = applyHawkerMove(m, chooseHawkerMove(m, mulberry32(1)));
    const twin = { ...afterMove, hawkerNode: afterMove.belief.at(-1)! }; // same public info, different truth
    const a = chooseSquadOrders(publicView(afterMove), mulberry32(9));
    const b = chooseSquadOrders(publicView(twin), mulberry32(9));
    expect(a).toEqual(b);
  });
});

describe('AI sanity', () => {
  it('hawker AI always takes an open stage when one is adjacent', () => {
    const m = setup('kimathi-ronald');
    expect(chooseHawkerMove(m, mulberry32(1))).toBe('stage-khoja');
  });

  it('every simulated game ends with an outcome', () => {
    for (let seed = 1; seed <= 100; seed++) expect(simulateMatch(seed).outcome).not.toBeNull();
  });
});
