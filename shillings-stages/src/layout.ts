// layout.ts — the only place that converts a board space index (0-39) into a
// screen position. `spaceGridPosition` is the logical board coordinate (an
// 11x11 square loop); `spaceIsoPosition` projects that into the isometric
// screen space the canvas renderer actually draws, so swapping projections
// later never touches game/rules.ts.

import { BOARD_SIZE } from './game/types';

export interface GridPosition {
  row: number;
  col: number;
}

/**
 * Classic Monopoly-style orientation: space 0 (GO) sits bottom-right, the
 * board runs counter-clockwise on screen (which is the player's clockwise
 * path), corners at 0/10/20/30.
 */
export function spaceGridPosition(index: number): GridPosition {
  if (index === 0) return { row: 11, col: 11 };
  if (index <= 9) return { row: 11, col: 11 - index };
  if (index === 10) return { row: 11, col: 1 };
  if (index <= 19) return { row: 21 - index, col: 1 };
  if (index === 20) return { row: 1, col: 1 };
  if (index <= 29) return { row: 1, col: index - 19 };
  if (index === 30) return { row: 1, col: 11 };
  return { row: index - 29, col: 11 };
}

// ── Isometric projection ────────────────────────────────────────────────
// 2:1 diamond tiling: a tile is exactly ISO_TILE_W x ISO_TILE_H, so tiles
// one row/col apart share an edge with no gaps — the 40-space loop reads as
// one continuous street with no separate "road" tiles needed.
export const ISO_TILE_W = 96;
export const ISO_TILE_H = 52;

export interface IsoPoint {
  x: number;
  y: number;
}

export function isoProject(row: number, col: number): IsoPoint {
  return {
    x: (col - row) * (ISO_TILE_W / 2),
    y: (col + row) * (ISO_TILE_H / 2),
  };
}

export interface IsoTile extends IsoPoint {
  /** Painter's-algorithm draw order — lower depth is farther back, draws first. */
  depth: number;
}

export function spaceIsoPosition(index: number): IsoTile {
  const { row, col } = spaceGridPosition(index);
  const { x, y } = isoProject(row, col);
  return { x, y, depth: row + col };
}

export interface IsoBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Bounding box of every tile center. The board is fixed, so this is the same every call. */
export function computeIsoBounds(): IsoBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const { x, y } = spaceIsoPosition(i);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/** The screen point where the board's visual center sits (e.g. for a logo). */
export function isoCenter(): IsoPoint {
  return isoProject(6, 6);
}

/** Sizes a canvas's backing store for HiDPI and returns a context already scaled to CSS pixels. */
export function setupHiDPICanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
