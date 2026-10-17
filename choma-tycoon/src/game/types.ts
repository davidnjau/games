// ─────────────────────────────────────────────────────────────
// types.ts — the vocabulary of Choma Tycoon.
// ─────────────────────────────────────────────────────────────

export type Ingredient =
  | 'EGG'
  | 'KACHUMBARI'
  | 'SMOKIE'
  | 'MAIZE'
  | 'LIME_CHILLI'
  | 'MUTURA_MEAT'
  | 'TOMATO_SAUCE'
  | 'CHILLI_SAUCE';

export const ADDON_INGREDIENTS: readonly Ingredient[] = ['TOMATO_SAUCE', 'CHILLI_SAUCE'];

export type DishId = 'MAYAI_PASUA' | 'SMOKIE_PASUA' | 'COMBO_PLATE' | 'MAHINDI_CHOMA' | 'MUTURA';

export interface DishRecipe {
  id: DishId;
  label: string;
  base: readonly Ingredient[];
  points: number;
}

export interface Customer {
  id: string;
  dish: DishId;
  /** The exact ingredient order required — base recipe, then any addons. */
  sequence: readonly Ingredient[];
  patienceMax: number;
  patience: number;
}

export type RaidPhase = 'NONE' | 'WARNING' | 'HIDING';

export interface RaidState {
  phase: RaidPhase;
  elapsed: number;
  /** Continuous hold time on the hide button, ms. Resets to 0 the instant it's released. */
  holdProgress: number;
  /** Counts down while phase is NONE; hitting 0 starts the next WARNING. */
  nextRaidIn: number;
}

export type FeedbackKind = 'GOOD' | 'BAD';

export type FeedbackCode =
  | 'INGREDIENT_OK'
  | 'ORDER_READY'
  | 'WRONG_INGREDIENT'
  | 'SERVED'
  | 'ANGRY_LEAVE'
  | 'RAID_FINE'
  | 'RAID_SAFE';

export interface Feedback {
  kind: FeedbackKind;
  code: FeedbackCode;
  /** Bumped on every feedback event so the UI can re-trigger a CSS animation on repeat codes. */
  key: number;
}

export type Phase = 'MENU' | 'PLAYING' | 'GAME_OVER';

export interface GameState {
  phase: Phase;
  score: number;
  highScore: number;
  timeLeft: number;
  customers: Customer[];
  selectedCustomer: string | null;
  tray: Ingredient[];
  nextSpawnIn: number;
  raid: RaidState;
  feedback: Feedback | null;
  feedbackSeq: number;
}

export const RULES = {
  matchDuration: 60_000,
  maxCustomers: 3,
  serveTimeBonus: 3_000,
  angryPenalty: 10,
  raidFine: 20,
  raidWarningDuration: 5_000,
  raidHoldRequired: 3_000,
  raidHideDuration: 3_000,
  raidIntervalMin: 30_000,
  raidIntervalMax: 45_000,
  spawnIntervalMin: 1_800,
  spawnIntervalMax: 3_800,
  addonBonus: 5,
  maxDifficultyLevel: 5,
  scorePerLevel: 40,
};
