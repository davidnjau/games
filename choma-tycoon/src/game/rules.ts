// ─────────────────────────────────────────────────────────────
// rules.ts — the whole game brain. Every function is pure:
// (state, input) => new state. No DOM, no canvas, no wall-clock
// time, no Math.random (RNG is injected) — so it's unit-testable
// in milliseconds and the renderer never has to guess what
// happened.
// ─────────────────────────────────────────────────────────────

import {
  ADDON_INGREDIENTS,
  RULES,
  type Customer,
  type DishId,
  type DishRecipe,
  type FeedbackCode,
  type GameState,
  type Ingredient,
} from './types';

export type Rng = () => number;

/** Deterministic PRNG so tests (and replays) are reproducible. */
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

export const DISHES: Readonly<Record<DishId, DishRecipe>> = {
  MAYAI_PASUA: { id: 'MAYAI_PASUA', label: 'Mayai Pasua', base: ['EGG', 'KACHUMBARI'], points: 10 },
  SMOKIE_PASUA: { id: 'SMOKIE_PASUA', label: 'Smokie Pasua', base: ['SMOKIE', 'KACHUMBARI'], points: 12 },
  COMBO_PLATE: { id: 'COMBO_PLATE', label: 'Combo Plate', base: ['EGG', 'SMOKIE', 'KACHUMBARI'], points: 20 },
  MAHINDI_CHOMA: { id: 'MAHINDI_CHOMA', label: 'Mahindi Choma', base: ['MAIZE', 'LIME_CHILLI'], points: 10 },
  MUTURA: { id: 'MUTURA', label: 'Mutura', base: ['MUTURA_MEAT', 'KACHUMBARI'], points: 12 },
};

const DISH_IDS: readonly DishId[] = Object.keys(DISHES) as DishId[];

const randInt = (rng: Rng, min: number, max: number) => Math.floor(min + rng() * (max - min + 1));
const randBetween = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
const clampScore = (n: number) => Math.max(0, n);
const uid = (rng: Rng) => Math.floor(rng() * 1e9).toString(36);

export const difficultyLevel = (score: number): number =>
  Math.min(RULES.maxDifficultyLevel, Math.floor(score / RULES.scorePerLevel));

/** Patience drains faster, and starts lower, as difficulty rises. */
const patienceMultiplier = (level: number): number => Math.max(0.55, 1 - level * 0.09);

const spawnIntervalFor = (level: number, rng: Rng): number => {
  const shrink = 1 - level * 0.12;
  return randBetween(rng, RULES.spawnIntervalMin, RULES.spawnIntervalMax) * Math.max(0.45, shrink);
};

const nextRaidDelay = (rng: Rng): number => randInt(rng, RULES.raidIntervalMin, RULES.raidIntervalMax);

/** Higher difficulty → more likely to get the Combo Plate and a sauce addon. */
function pickDish(level: number, rng: Rng): DishId {
  if (level >= 2 && rng() < 0.15 + level * 0.06) return 'COMBO_PLATE';
  return DISH_IDS.filter((id) => id !== 'COMBO_PLATE')[randInt(rng, 0, DISH_IDS.length - 2)];
}

function spawnCustomer(level: number, rng: Rng): Customer {
  const dish = pickDish(level, rng);
  const recipe = DISHES[dish];
  const addons: Ingredient[] = [];
  const addonChance = 0.1 + level * 0.1;
  for (const addon of ADDON_INGREDIENTS) if (rng() < addonChance) addons.push(addon);
  const sequence = [...recipe.base, ...addons];
  const basePatience = 10_000 - (sequence.length - 2) * 700;
  const patienceMax = Math.round(basePatience * patienceMultiplier(level));
  return { id: uid(rng), dish, sequence, patienceMax, patience: patienceMax };
}

const FEEDBACK_KIND: Record<FeedbackCode, 'GOOD' | 'BAD'> = {
  INGREDIENT_OK: 'GOOD',
  ORDER_READY: 'GOOD',
  WRONG_INGREDIENT: 'BAD',
  SERVED: 'GOOD',
  ANGRY_LEAVE: 'BAD',
  RAID_FINE: 'BAD',
  RAID_SAFE: 'GOOD',
};

function withFeedback(state: GameState, code: FeedbackCode): Pick<GameState, 'feedback' | 'feedbackSeq'> {
  const feedbackSeq = state.feedbackSeq + 1;
  return { feedback: { kind: FEEDBACK_KIND[code], code, key: feedbackSeq }, feedbackSeq };
}

// ── Setup ────────────────────────────────────────────────────

export function createGame(highScore: number, rng: Rng = Math.random): GameState {
  return {
    phase: 'PLAYING',
    score: 0,
    highScore,
    timeLeft: RULES.matchDuration,
    customers: [],
    selectedCustomer: null,
    tray: [],
    nextSpawnIn: spawnIntervalFor(0, rng),
    raid: { phase: 'NONE', elapsed: 0, holdProgress: 0, nextRaidIn: nextRaidDelay(rng) },
    feedback: null,
    feedbackSeq: 0,
  };
}

// ── The clock ────────────────────────────────────────────────

/**
 * Advance the game by `dtMs`. `holding` is whether the player currently
 * has a pointer down on the "pack up & hide" button — the only input
 * that needs to be sampled continuously rather than as a discrete click.
 */
export function tick(state: GameState, dtMs: number, rng: Rng, holding: boolean): GameState {
  if (state.phase !== 'PLAYING') return state;

  const timeLeft = state.timeLeft - dtMs;
  if (timeLeft <= 0) {
    return { ...state, phase: 'GAME_OVER', timeLeft: 0, highScore: Math.max(state.highScore, state.score) };
  }

  let { score, raid, customers, selectedCustomer, tray, nextSpawnIn } = state;
  let feedbackPatch: Pick<GameState, 'feedback' | 'feedbackSeq'> | null = null;

  // ── Kanjo raid state machine ──
  if (raid.phase === 'NONE') {
    const nextRaidIn = raid.nextRaidIn - dtMs;
    raid = nextRaidIn <= 0 ? { phase: 'WARNING', elapsed: 0, holdProgress: 0, nextRaidIn: 0 } : { ...raid, nextRaidIn };
  } else if (raid.phase === 'WARNING') {
    const holdProgress = holding ? Math.min(RULES.raidHoldRequired, raid.holdProgress + dtMs) : 0;
    if (holdProgress >= RULES.raidHoldRequired) {
      raid = { phase: 'HIDING', elapsed: 0, holdProgress: 0, nextRaidIn: 0 };
    } else {
      const elapsed = raid.elapsed + dtMs;
      if (elapsed >= RULES.raidWarningDuration) {
        score = clampScore(score - RULES.raidFine);
        feedbackPatch = withFeedback(state, 'RAID_FINE');
        raid = { phase: 'NONE', elapsed: 0, holdProgress: 0, nextRaidIn: nextRaidDelay(rng) };
      } else {
        raid = { ...raid, elapsed, holdProgress };
      }
    }
  } else {
    // HIDING: operations are frozen — no spawns, no patience drain, below.
    const elapsed = raid.elapsed + dtMs;
    if (elapsed >= RULES.raidHideDuration) {
      feedbackPatch = withFeedback(state, 'RAID_SAFE');
      raid = { phase: 'NONE', elapsed: 0, holdProgress: 0, nextRaidIn: nextRaidDelay(rng) };
    } else {
      raid = { ...raid, elapsed };
    }
  }

  const frozen = raid.phase === 'HIDING';

  if (!frozen) {
    const level = difficultyLevel(score);

    nextSpawnIn -= dtMs;
    if (nextSpawnIn <= 0 && customers.length < RULES.maxCustomers) {
      customers = [...customers, spawnCustomer(level, rng)];
      nextSpawnIn = spawnIntervalFor(level, rng);
    }

    const drained = customers.map((c) => ({ ...c, patience: c.patience - dtMs }));
    const angry = drained.filter((c) => c.patience <= 0);
    if (angry.length > 0) {
      score = clampScore(score - RULES.angryPenalty * angry.length);
      if (angry.some((c) => c.id === selectedCustomer)) {
        selectedCustomer = null;
        tray = [];
      }
      feedbackPatch = withFeedback(state, 'ANGRY_LEAVE');
      customers = drained.filter((c) => c.patience > 0);
    } else {
      customers = drained;
    }
  }

  return {
    ...state,
    score,
    timeLeft,
    customers,
    selectedCustomer,
    tray,
    nextSpawnIn,
    raid,
    ...(feedbackPatch ?? {}),
  };
}

// ── Player actions ───────────────────────────────────────────

const isFrozen = (state: GameState) => state.phase !== 'PLAYING' || state.raid.phase === 'HIDING';

export function selectCustomer(state: GameState, id: string): GameState {
  if (isFrozen(state) || !state.customers.some((c) => c.id === id)) return state;
  if (state.selectedCustomer === id) return state;
  return { ...state, selectedCustomer: id, tray: [] };
}

export function addIngredient(state: GameState, ingredient: Ingredient): GameState {
  if (isFrozen(state) || !state.selectedCustomer) return state;
  const customer = state.customers.find((c) => c.id === state.selectedCustomer);
  if (!customer) return state;

  const expected = customer.sequence[state.tray.length];
  if (expected === undefined) return state;

  if (ingredient !== expected) {
    return { ...state, tray: [], ...withFeedback(state, 'WRONG_INGREDIENT') };
  }
  const tray = [...state.tray, ingredient];
  const ready = tray.length === customer.sequence.length;
  return { ...state, tray, ...withFeedback(state, ready ? 'ORDER_READY' : 'INGREDIENT_OK') };
}

export function clearTray(state: GameState): GameState {
  if (isFrozen(state)) return state;
  return { ...state, tray: [] };
}

export function serve(state: GameState): GameState {
  if (isFrozen(state) || !state.selectedCustomer) return state;
  const customer = state.customers.find((c) => c.id === state.selectedCustomer);
  if (!customer || state.tray.length !== customer.sequence.length) return state;

  const recipe = DISHES[customer.dish];
  const addonCount = customer.sequence.length - recipe.base.length;
  const score = state.score + recipe.points + addonCount * RULES.addonBonus;
  return {
    ...state,
    score,
    timeLeft: state.timeLeft + RULES.serveTimeBonus,
    customers: state.customers.filter((c) => c.id !== customer.id),
    selectedCustomer: null,
    tray: [],
    ...withFeedback(state, 'SERVED'),
  };
}
