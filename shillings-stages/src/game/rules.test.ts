import { describe, expect, it } from 'vitest';
import { BOARD } from './board';
import { CHAMA_CARDS, HARAMBEE_CARDS } from './cards';
import {
  buildKiosk,
  buildingBankAvailable,
  buyProperty,
  createGame,
  declineBuyProperty,
  endTurn,
  getPlayer,
  mortgageProperty,
  payJailFine,
  proposeTrade,
  rentFor,
  respondTrade,
  resolveTaxAudit,
  rollDice,
  sellKiosk,
  totalAssets,
  unmortgageProperty,
  useJailFreeCard,
} from './rules';
import type { GameState, Rng } from './types';
import { RULES } from './types';

function mulberry32(seed: number): Rng {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fixedRng(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

/** returns an rng() value that makes rollDie() produce `n` */
function die(n: number): number {
  return (n - 0.5) / 6;
}

function newGame(playerCount = 2): GameState {
  return createGame(playerCount, mulberry32(42));
}

describe('createGame', () => {
  it('sets up starting cash, position and phase', () => {
    const state = newGame(3);
    expect(state.players).toHaveLength(3);
    for (const p of state.players) {
      expect(p.cash).toBe(RULES.startingCash);
      expect(p.position).toBe(0);
      expect(p.bankrupt).toBe(false);
    }
    expect(state.phase).toBe('AWAITING_ROLL');
    expect(state.currentTurn).toBe(1);
  });

  it('rejects out-of-range player counts', () => {
    expect(() => createGame(1, mulberry32(1))).toThrow();
    expect(() => createGame(9, mulberry32(1))).toThrow();
  });
});

describe('card decks', () => {
  it('each deck has 16 cards with exactly one jail-free and one go-to-jail card', () => {
    for (const deck of [HARAMBEE_CARDS, CHAMA_CARDS]) {
      expect(deck).toHaveLength(16);
      expect(deck.filter((c) => c.effect.type === 'GET_OUT_OF_JAIL_FREE')).toHaveLength(1);
      expect(deck.filter((c) => c.effect.type === 'GO_TO_JAIL')).toHaveLength(1);
    }
  });
});

describe('rolling and moving', () => {
  it('moves the player by the dice total and does not pay GO salary mid-board', () => {
    let state = newGame();
    state = rollDice(state, fixedRng([die(3), die(2)]));
    expect(getPlayer(state, 1).position).toBe(5);
    expect(getPlayer(state, 1).cash).toBe(RULES.startingCash);
  });

  it('pays GO salary when passing GO', () => {
    let state = newGame();
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, position: 38 } : p)) };
    state = rollDice(state, fixedRng([die(4), die(3)])); // 38 + 7 = 45 % 40 = 5, wraps
    expect(getPlayer(state, 1).position).toBe(5);
    expect(getPlayer(state, 1).cash).toBe(RULES.startingCash + RULES.goSalary);
  });

  it('sends a player to jail after three consecutive doubles', () => {
    let state = newGame();
    state = rollDice(state, fixedRng([die(5), die(5)])); // 0 + 10 = 10, Just Visiting (safe)
    expect(state.phase).toBe('AWAITING_END_TURN');
    state = endTurn(state);
    expect(state.phase).toBe('AWAITING_ROLL'); // double grants another roll, same player
    state = rollDice(state, fixedRng([die(5), die(5)])); // 10 + 10 = 20, Free Parking (safe)
    state = endTurn(state);
    // the third consecutive double sends the player to jail before any movement is resolved,
    // so these dice values never determine a landing space
    state = rollDice(state, fixedRng([die(4), die(4)]));
    const p = getPlayer(state, 1);
    expect(p.inJail).toBe(true);
    expect(p.position).toBe(10);
    expect(state.doublesCount).toBe(0);
  });
});

describe('buying and rent', () => {
  it('buys an unowned property and charges the price', () => {
    let state = newGame();
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, position: 1 } : p)), phase: 'AWAITING_PROPERTY_DECISION' };
    const price = BOARD[1].price!;
    state = buyProperty(state);
    expect(getPlayer(state, 1).cash).toBe(RULES.startingCash - price);
    expect(state.properties[1]?.owner).toBe(1);
    expect(state.phase).toBe('AWAITING_END_TURN');
  });

  it('declining leaves the property unowned', () => {
    let state = newGame();
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, position: 1 } : p)), phase: 'AWAITING_PROPERTY_DECISION' };
    state = declineBuyProperty(state);
    expect(state.properties[1]?.owner).toBeNull();
    expect(state.phase).toBe('AWAITING_END_TURN');
  });

  it('charges base rent, doubled when the owner has the full color group', () => {
    let state = newGame();
    state.properties[1] = { owner: 1, level: 0, mortgaged: false };
    expect(rentFor(state, 1, 7)).toBe(BOARD[1].rent!.base);
    state.properties[3] = { owner: 1, level: 0, mortgaged: false };
    expect(rentFor(state, 1, 7)).toBe(BOARD[1].rent!.base * 2);
  });

  it('charges kiosk and plot rent at each build level', () => {
    const state = newGame();
    state.properties[1] = { owner: 1, level: 2, mortgaged: false };
    expect(rentFor(state, 1, 7)).toBe(BOARD[1].rent!.kiosk[1]);
    state.properties[1]!.level = 5;
    expect(rentFor(state, 1, 7)).toBe(BOARD[1].rent!.plot);
  });

  it('scales transit rent with number owned', () => {
    const state = newGame();
    state.properties[5] = { owner: 1, level: 0, mortgaged: false };
    expect(rentFor(state, 5, 7)).toBe(RULES.transitRent[0]);
    state.properties[15] = { owner: 1, level: 0, mortgaged: false };
    state.properties[25] = { owner: 1, level: 0, mortgaged: false };
    expect(rentFor(state, 5, 7)).toBe(RULES.transitRent[2]);
  });

  it('charges 4x dice for one utility and 10x for both', () => {
    const state = newGame();
    state.properties[12] = { owner: 1, level: 0, mortgaged: false };
    expect(rentFor(state, 12, 7)).toBe(7 * RULES.utilityMultiplier.one);
    state.properties[28] = { owner: 1, level: 0, mortgaged: false };
    expect(rentFor(state, 12, 7)).toBe(7 * RULES.utilityMultiplier.both);
  });
});

describe('building', () => {
  function ownFullBrownGroup(state: GameState, owner = 1): GameState {
    state.properties[1] = { owner, level: 0, mortgaged: false };
    state.properties[3] = { owner, level: 0, mortgaged: false };
    return state;
  }

  it('builds up a Kiosk then a Plot, deducting cost each time', () => {
    let state = newGame();
    state = ownFullBrownGroup(state);
    state.phase = 'AWAITING_ROLL';
    const before = getPlayer(state, 1).cash;
    state = buildKiosk(state, 1);
    expect(state.properties[1]?.level).toBe(1);
    expect(getPlayer(state, 1).cash).toBe(before - BOARD[1].buildCost!);
    for (let i = 0; i < 3; i++) state = buildKiosk(state, 1);
    expect(state.properties[1]?.level).toBe(4);
    state = buildKiosk(state, 1);
    expect(state.properties[1]?.level).toBe(5);
  });

  it('refuses to build without the full unmortgaged group', () => {
    let state = newGame();
    state.properties[1] = { owner: 1, level: 0, mortgaged: false };
    state.properties[3] = { owner: 1, level: 0, mortgaged: true };
    state.phase = 'AWAITING_ROLL';
    expect(() => buildKiosk(state, 1)).toThrow();
  });

  it('refunds half the build cost on sell', () => {
    let state = newGame();
    state = ownFullBrownGroup(state);
    state.phase = 'AWAITING_ROLL';
    state = buildKiosk(state, 1);
    const cashAfterBuild = getPlayer(state, 1).cash;
    state = sellKiosk(state, 1);
    expect(state.properties[1]?.level).toBe(0);
    expect(getPlayer(state, 1).cash).toBe(cashAfterBuild + BOARD[1].buildCost! * 0.5);
  });

  it('reports building bank availability', () => {
    const state = newGame();
    const { kiosksAvailable, plotsAvailable } = buildingBankAvailable(state);
    expect(kiosksAvailable).toBe(RULES.buildingBankKiosks);
    expect(plotsAvailable).toBe(RULES.buildingBankPlots);
  });
});

describe('mortgage', () => {
  it('mortgages for half price and unmortgages at a 10% markup', () => {
    let state = newGame();
    state.properties[1] = { owner: 1, level: 0, mortgaged: false };
    state.phase = 'AWAITING_ROLL';
    const before = getPlayer(state, 1).cash;
    state = mortgageProperty(state, 1);
    const half = BOARD[1].price! * 0.5;
    expect(getPlayer(state, 1).cash).toBe(before + half);
    expect(state.properties[1]?.mortgaged).toBe(true);
    state = unmortgageProperty(state, 1);
    expect(getPlayer(state, 1).cash).toBeCloseTo(before + half - half * 1.1, 5);
    expect(state.properties[1]?.mortgaged).toBe(false);
  });
});

describe('jail', () => {
  it('escapes via paying the fine', () => {
    let state = newGame();
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, inJail: true, position: 10 } : p)), phase: 'AWAITING_JAIL_CHOICE' };
    state = payJailFine(state);
    expect(getPlayer(state, 1).inJail).toBe(false);
    expect(getPlayer(state, 1).cash).toBe(RULES.startingCash - RULES.jailFine);
    expect(state.phase).toBe('AWAITING_ROLL');
  });

  it('escapes via rolling doubles, and does not grant an extra turn', () => {
    let state = newGame();
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, inJail: true, position: 10 } : p)), phase: 'AWAITING_JAIL_CHOICE' };
    state = rollDice(state, fixedRng([die(3), die(3)]));
    expect(getPlayer(state, 1).inJail).toBe(false);
    expect(state.doublesCount).toBe(0);
  });

  it('is forced out after three failed turns', () => {
    let state = newGame();
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, inJail: true, position: 10, jailTurns: 2 } : p)), phase: 'AWAITING_JAIL_CHOICE' };
    // not a double, so this is the third failed attempt; forced out, then moves 10 + 10 = 20 (Free Parking, safe)
    state = rollDice(state, fixedRng([die(4), die(6)]));
    expect(getPlayer(state, 1).inJail).toBe(false);
    expect(getPlayer(state, 1).cash).toBe(RULES.startingCash - RULES.jailFine);
  });

  it('uses a free pass card to escape', () => {
    let state = newGame();
    state = {
      ...state,
      players: state.players.map((p) => (p.id === 1 ? { ...p, inJail: true, position: 10, freePassCards: { chama: true, harambee: false } } : p)),
      phase: 'AWAITING_JAIL_CHOICE',
    };
    state = useJailFreeCard(state, 'CHAMA');
    expect(getPlayer(state, 1).inJail).toBe(false);
    expect(getPlayer(state, 1).freePassCards.chama).toBe(false);
    expect(state.phase).toBe('AWAITING_ROLL');
  });
});

describe('tax audit', () => {
  it('lets the player choose the cheaper option', () => {
    let state = newGame();
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, position: 4, cash: 1_000_000 } : p)), phase: 'AWAITING_TAX_CHOICE' };
    const before = getPlayer(state, 1).cash;
    const flatState = resolveTaxAudit(state, 'FLAT');
    expect(getPlayer(flatState, 1).cash).toBe(before - RULES.taxAuditFlat);

    const percentState = resolveTaxAudit(state, 'PERCENT');
    expect(getPlayer(percentState, 1).cash).toBe(before - Math.round(totalAssets(state, 1) * RULES.taxAuditPercent));
  });
});

describe('bankruptcy', () => {
  it('bankrupts a player to the bank when a flat tax exceeds their liquidatable assets', () => {
    let state = newGame(2);
    state.properties[1] = { owner: 1, level: 0, mortgaged: false };
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, cash: 50, position: 32 } : p)) };
    state = rollDice(state, fixedRng([die(3), die(3)])); // 32 + 6 = 38, Fuel Levy (flat KES 10,000)
    const p1 = getPlayer(state, 1);
    expect(p1.bankrupt).toBe(true);
    expect(p1.cash).toBe(0);
    expect(state.properties[1]?.owner).toBeNull();
    // only one active player remains in a 2-player game
    expect(state.winner).toBe(2);
    expect(state.phase).toBe('GAME_OVER');
  });

  it('transfers remaining properties to the rent-collecting player when liquidation is not enough', () => {
    let state = newGame(3);
    state.properties[3] = { owner: 1, level: 0, mortgaged: false }; // Kakamega Hub, player 1's only asset
    state.properties[11] = { owner: 2, level: 5, mortgaged: false }; // Eldoret CBD at Plot tier, rent 75,000
    state = { ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, cash: 50, position: 0 } : p)) };
    state = rollDice(state, fixedRng([die(5), die(6)])); // 0 + 11 = 11
    const p1 = getPlayer(state, 1);
    expect(p1.bankrupt).toBe(true);
    expect(p1.cash).toBe(0);
    expect(state.properties[3]?.owner).toBe(2);
    expect(state.winner).toBeNull(); // player 3 is still in the game
  });
});

describe('trade', () => {
  it('accepts a trade and swaps cash and properties', () => {
    let state = newGame();
    state.properties[1] = { owner: 1, level: 0, mortgaged: false };
    state.properties[6] = { owner: 2, level: 0, mortgaged: false };
    state.phase = 'AWAITING_END_TURN';
    state = proposeTrade(state, { from: 1, to: 2, offerCash: 1_000, offerProperties: [1], requestCash: 0, requestProperties: [6] });
    expect(state.phase).toBe('TRADE_PENDING');
    state = respondTrade(state, true);
    expect(state.properties[1]?.owner).toBe(2);
    expect(state.properties[6]?.owner).toBe(1);
    expect(getPlayer(state, 1).cash).toBe(RULES.startingCash - 1_000);
    expect(getPlayer(state, 2).cash).toBe(RULES.startingCash + 1_000);
  });

  it('leaves state unchanged on decline', () => {
    let state = newGame();
    state.properties[1] = { owner: 1, level: 0, mortgaged: false };
    state.properties[6] = { owner: 2, level: 0, mortgaged: false };
    state.phase = 'AWAITING_END_TURN';
    state = proposeTrade(state, { from: 1, to: 2, offerCash: 0, offerProperties: [1], requestCash: 0, requestProperties: [6] });
    state = respondTrade(state, false);
    expect(state.properties[1]?.owner).toBe(1);
    expect(state.properties[6]?.owner).toBe(2);
  });
});
