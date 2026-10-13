// ─────────────────────────────────────────────────────────────
// types.ts — the vocabulary of the game.
// Every other file speaks in these types. No logic lives here.
// ─────────────────────────────────────────────────────────────

/** Board is BOARD_SIZE x BOARD_SIZE junctions (cells). */
export const BOARD_SIZE = 9;

/** Grooves sit between cells, so there are BOARD_SIZE - 1 per axis. */
export const GROOVE_COUNT = BOARD_SIZE - 1;

/** Each driver starts with this many Kanjo Spikes. */
export const SPIKES_PER_PLAYER = 10;

export type VehicleType = 'MANYANGA' | 'CHAPAA' | 'UBER';
export type Orientation = 'HORIZONTAL' | 'VERTICAL';
export type PlayerId = 1 | 2;

/** A junction on the 9x9 grid. x = column (0 left), y = row (0 top). */
export interface Position {
  x: number;
  y: number;
}

/**
 * A Kanjo Spike barrier. It is anchored at a groove intersection (x, y),
 * where 0 <= x, y <= 7, and is two cells long.
 *
 * HORIZONTAL at (x, y): blocks travel between rows y and y+1,
 *                       for columns x and x+1.
 * VERTICAL   at (x, y): blocks travel between columns x and x+1,
 *                       for rows y and y+1.
 */
export interface Roadblock {
  x: number;
  y: number;
  orientation: Orientation;
}

export interface Player {
  id: PlayerId;
  vehicleType: VehicleType;
  position: Position;
  targetStageY: number;
  spikesRemaining: number;
  color: string;
}

/**
 * The phases of our finite state machine (see blueprint section 3).
 * SELECT_VEHICLES → CHOOSE_ACTION ⇄ (turns) → GAME_OVER
 */
export type GamePhase = 'SELECT_VEHICLES' | 'CHOOSE_ACTION' | 'GAME_OVER';

/** Which action the active driver has armed: drive the pawn or drop spikes. */
export type ActionMode = 'DRIVE' | 'SPIKES';

export interface MatchState {
  players: [Player, Player];
  currentTurn: PlayerId;
  phase: GamePhase;
  mode: ActionMode;
  roadblocks: Roadblock[];
  winner: PlayerId | null;
  turnNumber: number;
}

/** Why a spike drop was refused — the UI turns each into a Sheng message. */
export type SpikeRejection = 'NO_SPIKES' | 'OUT_OF_BOUNDS' | 'OVERLAP' | 'GRIDLOCK';

export type SpikeCheck = { ok: true } | { ok: false; reason: SpikeRejection };
