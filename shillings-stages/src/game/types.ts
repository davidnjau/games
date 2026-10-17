export const BOARD_SIZE = 40;

export type PlayerId = number;

export type ColorGroup = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const GROUP_NAMES: Record<ColorGroup, string> = {
  0: 'Low-Tier Towns',
  1: 'Expanding Towns',
  2: 'Rift Valley & Western Hubs',
  3: 'Lakeside City',
  4: 'Coastal Tourism',
  5: 'Capital Outer Ring',
  6: 'Capital Luxury',
  7: 'Ultimate CBD Premium',
};

export const GROUP_COLORS: Record<ColorGroup, string> = {
  0: '#8b5a2b',
  1: '#9fd8ff',
  2: '#ff8fd0',
  3: '#ff9a3c',
  4: '#e8453c',
  5: '#ffd84d',
  6: '#4caf6e',
  7: '#2b5fa8',
};

export type SpaceType =
  | 'GO'
  | 'PROPERTY'
  | 'TRANSIT'
  | 'UTILITY'
  | 'TAX'
  | 'CHAMA'
  | 'HARAMBEE'
  | 'JAIL'
  | 'FREE_PARKING'
  | 'GO_TO_JAIL';

export interface PropertyRent {
  base: number;
  /** rent with 1-4 Kiosks built */
  kiosk: [number, number, number, number];
  /** rent with the top-tier Plot/Flat/Skyscraper */
  plot: number;
}

export interface Space {
  id: number;
  name: string;
  type: SpaceType;
  group?: ColorGroup;
  price?: number;
  rent?: PropertyRent;
  /** cost to build one Kiosk/Plot level, PROPERTY only */
  buildCost?: number;
  /** TAX only: flat fee option */
  taxFlat?: number;
  /** TAX only: percent-of-assets option, if the space offers a choice */
  taxPercent?: number;
}

/** Build level: 0 unimproved, 1-4 Kiosk count, 5 Plot/Flat/Skyscraper. Also used
 * (always at level 0) for Transit/Utility spaces, which share ownership/mortgage
 * but are never improvable. */
export type BuildLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface PropertyState {
  owner: PlayerId | null;
  level: BuildLevel;
  mortgaged: boolean;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  freePassCards: { chama: boolean; harambee: boolean };
  bankrupt: boolean;
}

export type GamePhase =
  | 'AWAITING_JAIL_CHOICE'
  | 'AWAITING_ROLL'
  | 'AWAITING_PROPERTY_DECISION'
  | 'AWAITING_TAX_CHOICE'
  | 'AWAITING_END_TURN'
  | 'TRADE_PENDING'
  | 'GAME_OVER';

export type EventKind = 'INFO' | 'GOOD' | 'BAD';

export type EventCode =
  | 'ROLLED'
  | 'ROLLED_DOUBLES'
  | 'PASSED_GO'
  | 'LANDED_UNOWNED'
  | 'BOUGHT_PROPERTY'
  | 'DECLINED_PROPERTY'
  | 'PAID_RENT'
  | 'COLLECTED_RENT'
  | 'OWN_PROPERTY'
  | 'BUILT_KIOSK'
  | 'BUILT_PLOT'
  | 'SOLD_BUILDING'
  | 'BUILDING_BANK_EMPTY'
  | 'MORTGAGED'
  | 'UNMORTGAGED'
  | 'DREW_HARAMBEE'
  | 'DREW_CHAMA'
  | 'TAX_AUDIT_PENDING'
  | 'PAID_TAX'
  | 'SENT_TO_JAIL'
  | 'STUCK_IN_JAIL'
  | 'LEFT_JAIL_FINE'
  | 'LEFT_JAIL_DOUBLES'
  | 'LEFT_JAIL_CARD'
  | 'FORCED_OUT_OF_JAIL'
  | 'TRADE_PROPOSED'
  | 'TRADE_ACCEPTED'
  | 'TRADE_DECLINED'
  | 'BANKRUPT'
  | 'GAME_OVER';

export interface GameEvent {
  key: number;
  kind: EventKind;
  code: EventCode;
  data?: Record<string, string | number>;
}

export interface TradeOffer {
  from: PlayerId;
  to: PlayerId;
  offerCash: number;
  offerProperties: number[];
  requestCash: number;
  requestProperties: number[];
}

export interface GameState {
  players: Player[];
  /** indexed by space id 0-39; null for non-ownable spaces */
  properties: (PropertyState | null)[];
  currentTurn: PlayerId;
  phase: GamePhase;
  dice: [number, number] | null;
  doublesCount: number;
  chamaDeck: number[];
  chamaDiscard: number[];
  harambeeDeck: number[];
  harambeeDiscard: number[];
  pendingTrade: TradeOffer | null;
  winner: PlayerId | null;
  /** events produced by the most recent action only (not cumulative) */
  events: GameEvent[];
  eventSeq: number;
}

export const RULES = {
  startingCash: 150_000,
  goSalary: 20_000,
  jailFine: 5_000,
  maxJailTurns: 3,
  buildingBankKiosks: 32,
  buildingBankPlots: 12,
  mortgageRate: 0.5,
  unmortgageInterestRate: 0.1,
  taxAuditFlat: 20_000,
  taxAuditPercent: 0.1,
  fuelLevyFlat: 10_000,
  transitRent: [2_500, 5_000, 10_000, 20_000] as [number, number, number, number],
  utilityMultiplier: { one: 4, both: 10 },
} as const;

export type Rng = () => number;
