// ─────────────────────────────────────────────────────────────
// layout.ts — converts between GAME space (cells, grooves) and
// SCREEN space (pixels on the canvas). The rules never see pixels
// and the renderer never sees rules; this file is the bridge.
// ─────────────────────────────────────────────────────────────

import { BOARD_SIZE, GROOVE_COUNT, type Position, type Roadblock } from './game/types';

export const CELL = 56; // junction size in px
export const GAP = 14; // groove width in px
export const PAD = 18; // border around the board
export const STEP = CELL + GAP; // distance from one junction to the next

/** Logical canvas size. The canvas is scaled for sharp rendering on retina screens. */
export const BOARD_PX = PAD * 2 + BOARD_SIZE * CELL + GROOVE_COUNT * GAP;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const cellOrigin = (p: Position) => ({ x: PAD + p.x * STEP, y: PAD + p.y * STEP });

export const cellCenter = (p: Position) => ({
  x: PAD + p.x * STEP + CELL / 2,
  y: PAD + p.y * STEP + CELL / 2,
});

/** Where a roadblock is drawn: a strip filling the groove across two cells. */
export function roadblockRect(rb: Roadblock): Rect {
  const o = cellOrigin(rb);
  return rb.orientation === 'HORIZONTAL'
    ? { x: o.x, y: o.y + CELL, w: CELL * 2 + GAP, h: GAP }
    : { x: o.x + CELL, y: o.y, w: GAP, h: CELL * 2 + GAP };
}

/** Which junction is under this pixel? null if off the board. */
export function pixelToCell(px: number, py: number): Position | null {
  const x = Math.floor((px - PAD + GAP / 2) / STEP);
  const y = Math.floor((py - PAD + GAP / 2) / STEP);
  if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return null;
  return { x, y };
}

/**
 * Which groove is nearest this pixel, and which way should the spikes lie?
 * We snap to the closest groove intersection, then compare how far the
 * pointer is from it horizontally vs vertically: if you're further along
 * the x-axis you're sitting in a horizontal groove, and vice versa.
 */
export function pixelToGroove(px: number, py: number): Roadblock {
  const clamp = (n: number) => Math.max(0, Math.min(GROOVE_COUNT - 1, n));
  const x = clamp(Math.round((px - PAD - CELL - GAP / 2) / STEP));
  const y = clamp(Math.round((py - PAD - CELL - GAP / 2) / STEP));
  const cx = PAD + x * STEP + CELL + GAP / 2;
  const cy = PAD + y * STEP + CELL + GAP / 2;
  const orientation = Math.abs(px - cx) >= Math.abs(py - cy) ? 'HORIZONTAL' : 'VERTICAL';
  return { x, y, orientation };
}
