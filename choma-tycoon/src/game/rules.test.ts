import { describe, expect, it } from 'vitest';
import { DISHES, addIngredient, clearTray, createGame, mulberry32, serve, selectCustomer, tick } from './rules';
import { RULES, type GameState } from './types';

const rng = () => mulberry32(42);

/** A game with one customer ordering Mayai Pasua (EGG, KACHUMBARI), already selected. */
function withOneCustomer(): GameState {
  let s = createGame(0, rng());
  s = { ...s, customers: [{ id: 'c1', dish: 'MAYAI_PASUA', sequence: DISHES.MAYAI_PASUA.base, patienceMax: 9000, patience: 9000 }] };
  return selectCustomer(s, 'c1');
}

describe('order assembly', () => {
  it('advances the tray on each correct ingredient, in sequence', () => {
    let s = withOneCustomer();
    s = addIngredient(s, 'EGG');
    expect(s.tray).toEqual(['EGG']);
    s = addIngredient(s, 'KACHUMBARI');
    expect(s.tray).toEqual(['EGG', 'KACHUMBARI']);
  });

  it('resets the tray and emits BAD feedback on a wrong ingredient', () => {
    let s = withOneCustomer();
    s = addIngredient(s, 'EGG');
    s = addIngredient(s, 'SMOKIE'); // wrong — KACHUMBARI expected next
    expect(s.tray).toEqual([]);
    expect(s.feedback?.kind).toBe('BAD');
  });

  it('does nothing if no customer is selected', () => {
    const s = createGame(0, rng());
    const s2 = addIngredient(s, 'EGG');
    expect(s2.tray).toEqual([]);
  });

  it('clearTray empties an in-progress tray', () => {
    let s = withOneCustomer();
    s = addIngredient(s, 'EGG');
    s = clearTray(s);
    expect(s.tray).toEqual([]);
  });

  it('switching selected customer clears the tray', () => {
    let s = withOneCustomer();
    s = { ...s, customers: [...s.customers, { id: 'c2', dish: 'MUTURA', sequence: DISHES.MUTURA.base, patienceMax: 9000, patience: 9000 }] };
    s = addIngredient(s, 'EGG');
    s = selectCustomer(s, 'c2');
    expect(s.tray).toEqual([]);
    expect(s.selectedCustomer).toBe('c2');
  });
});

describe('serving', () => {
  it('only serves once the tray exactly matches the order', () => {
    let s = withOneCustomer();
    const before = serve(s); // tray incomplete
    expect(before.customers).toHaveLength(1);

    s = addIngredient(s, 'EGG');
    s = addIngredient(s, 'KACHUMBARI');
    s = serve(s);
    expect(s.customers).toHaveLength(0);
    expect(s.score).toBe(DISHES.MAYAI_PASUA.points);
    expect(s.selectedCustomer).toBeNull();
    expect(s.tray).toEqual([]);
  });

  it('awards a time bonus on serve', () => {
    let s = withOneCustomer();
    const startTime = s.timeLeft;
    s = addIngredient(s, 'EGG');
    s = addIngredient(s, 'KACHUMBARI');
    s = serve(s);
    expect(s.timeLeft).toBe(startTime + RULES.serveTimeBonus);
  });

  it('awards an addon bonus for sauces in the sequence', () => {
    let s = createGame(0, rng());
    s = { ...s, customers: [{ id: 'c1', dish: 'MUTURA', sequence: [...DISHES.MUTURA.base, 'CHILLI_SAUCE'], patienceMax: 9000, patience: 9000 }] };
    s = selectCustomer(s, 'c1');
    for (const ing of ['MUTURA_MEAT', 'KACHUMBARI', 'CHILLI_SAUCE'] as const) s = addIngredient(s, ing);
    s = serve(s);
    expect(s.score).toBe(DISHES.MUTURA.points + RULES.addonBonus);
  });
});

describe('customer patience', () => {
  it('removes a customer and applies a penalty once patience drains to zero', () => {
    let s = createGame(0, rng());
    s = { ...s, score: 50, customers: [{ id: 'c1', dish: 'MAYAI_PASUA', sequence: DISHES.MAYAI_PASUA.base, patienceMax: 1000, patience: 1000 }] };
    s = tick(s, 1500, rng(), false);
    expect(s.customers).toHaveLength(0);
    expect(s.score).toBe(50 - RULES.angryPenalty);
  });

  it('never drops score below zero from penalties', () => {
    let s = createGame(0, rng());
    s = { ...s, score: 5, customers: [{ id: 'c1', dish: 'MAYAI_PASUA', sequence: DISHES.MAYAI_PASUA.base, patienceMax: 1000, patience: 1000 }] };
    s = tick(s, 1500, rng(), false);
    expect(s.score).toBe(0);
  });

  it('deselects and clears the tray if the selected customer leaves angry', () => {
    let s = createGame(0, rng());
    s = { ...s, customers: [{ id: 'c1', dish: 'MAYAI_PASUA', sequence: DISHES.MAYAI_PASUA.base, patienceMax: 1000, patience: 1000 }] };
    s = selectCustomer(s, 'c1');
    s = addIngredient(s, 'EGG');
    s = tick(s, 1500, rng(), false);
    expect(s.selectedCustomer).toBeNull();
    expect(s.tray).toEqual([]);
  });
});

describe('the clock', () => {
  it('ends the game and locks in the high score when time runs out', () => {
    let s = createGame(3, rng());
    s = { ...s, score: 40 };
    s = tick(s, RULES.matchDuration + 1, rng(), false);
    expect(s.phase).toBe('GAME_OVER');
    expect(s.timeLeft).toBe(0);
    expect(s.highScore).toBe(40);
  });

  it('keeps the previous high score if the new score is lower', () => {
    let s = createGame(100, rng());
    s = tick(s, RULES.matchDuration + 1, rng(), false);
    expect(s.highScore).toBe(100);
  });

  it('does nothing once the game is over', () => {
    let s = createGame(0, rng());
    s = tick(s, RULES.matchDuration + 1, rng(), false);
    const after = tick(s, 1000, rng(), false);
    expect(after).toBe(s);
  });
});

describe('Kanjo raid', () => {
  it('enters WARNING once nextRaidIn elapses', () => {
    let s = createGame(0, rng());
    s = { ...s, raid: { ...s.raid, nextRaidIn: 500 } };
    s = tick(s, 600, rng(), false);
    expect(s.raid.phase).toBe('WARNING');
  });

  it('transitions to HIDING once held continuously for the required duration', () => {
    let s = createGame(0, rng());
    s = { ...s, raid: { phase: 'WARNING', elapsed: 0, holdProgress: 0, nextRaidIn: 0 } };
    s = tick(s, RULES.raidHoldRequired, rng(), true);
    expect(s.raid.phase).toBe('HIDING');
  });

  it('resets hold progress the instant the button is released', () => {
    let s = createGame(0, rng());
    s = { ...s, raid: { phase: 'WARNING', elapsed: 0, holdProgress: 0, nextRaidIn: 0 } };
    s = tick(s, RULES.raidHoldRequired - 200, rng(), true);
    expect(s.raid.holdProgress).toBeGreaterThan(0);
    s = tick(s, 50, rng(), false);
    expect(s.raid.holdProgress).toBe(0);
  });

  it('fines the player if the warning window expires without a successful hide', () => {
    let s = createGame(0, rng());
    s = { ...s, score: 50, raid: { phase: 'WARNING', elapsed: 0, holdProgress: 0, nextRaidIn: 0 } };
    s = tick(s, RULES.raidWarningDuration + 1, rng(), false);
    expect(s.raid.phase).toBe('NONE');
    expect(s.score).toBe(50 - RULES.raidFine);
  });

  it('freezes spawns and patience drain while HIDING', () => {
    let s = createGame(0, rng());
    s = {
      ...s,
      customers: [{ id: 'c1', dish: 'MAYAI_PASUA', sequence: DISHES.MAYAI_PASUA.base, patienceMax: 1000, patience: 1000 }],
      nextSpawnIn: 100,
      raid: { phase: 'HIDING', elapsed: 0, holdProgress: 0, nextRaidIn: 0 },
    };
    s = tick(s, 2000, rng(), false);
    expect(s.customers[0].patience).toBe(1000);
    expect(s.customers).toHaveLength(1);
  });

  it('returns to NONE and reschedules after the hide duration passes', () => {
    let s = createGame(0, rng());
    s = { ...s, raid: { phase: 'HIDING', elapsed: 0, holdProgress: 0, nextRaidIn: 0 } };
    s = tick(s, RULES.raidHideDuration + 1, rng(), false);
    expect(s.raid.phase).toBe('NONE');
    expect(s.raid.nextRaidIn).toBeGreaterThan(0);
  });
});

describe('spawning', () => {
  it('never exceeds the max customer slots', () => {
    let s = createGame(0, rng());
    for (let i = 0; i < 200; i++) {
      s = tick(s, 400, rng(), false);
      expect(s.customers.length).toBeLessThanOrEqual(RULES.maxCustomers);
    }
  });
});
