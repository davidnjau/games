// ─────────────────────────────────────────────────────────────
// renderer.ts — draws one frame of the game onto a <canvas>.
//
// The renderer is called ~60 times a second by the game loop.
// It owns only VISUAL state (where a pawn appears mid-animation,
// when a spike started popping in). The real truth lives in
// MatchState; the renderer chases it smoothly.
// ─────────────────────────────────────────────────────────────

import type { MatchState, PlayerId, Position, Roadblock, VehicleType } from './game/types';
import { BOARD_SIZE } from './game/types';
import { BOARD_PX, CELL, GAP, PAD, STEP, cellCenter, cellOrigin, roadblockRect } from './layout';

export interface ViewModel {
  state: MatchState;
  legalMoves: Position[];
  hoverCell: Position | null;
  preview: { rb: Roadblock; valid: boolean } | null;
  reducedMotion: boolean;
}

const MOVE_MS = 220;
const SPIKE_MS = 260;

const C = {
  asphalt: '#121821',
  groove: '#0B1017',
  junction: '#1D2633',
  junctionHover: '#273446',
  laneMark: 'rgba(242, 233, 210, 0.07)',
  spikeBase: '#0A0D12',
  spikeTooth: '#F2C744',
  spikeBad: '#FF4D6D',
};

interface Tween {
  from: { x: number; y: number };
  to: { x: number; y: number };
  start: number;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private tweens = new Map<PlayerId, Tween>();
  private spikeBirth = new Map<string, number>();

  constructor(
    private canvas: HTMLCanvasElement,
    private images: Record<VehicleType, HTMLImageElement>,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  /** Back the canvas with enough real pixels for a crisp image on HiDPI screens. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = BOARD_PX * dpr;
    this.canvas.height = BOARD_PX * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Tell the renderer about a new MatchState. It compares with what it
   * last saw and starts animations for anything that changed.
   */
  sync(state: MatchState, now: number, instant = false): void {
    for (const p of state.players) {
      const target = cellCenter(p.position);
      const tw = this.tweens.get(p.id);
      if (!tw || instant) {
        this.tweens.set(p.id, { from: target, to: target, start: now });
      } else if (tw.to.x !== target.x || tw.to.y !== target.y) {
        this.tweens.set(p.id, { from: this.pawnPixel(p.id, now), to: target, start: now });
      }
    }
    const live = new Set(state.roadblocks.map(spikeKey));
    for (const k of live) if (!this.spikeBirth.has(k)) this.spikeBirth.set(k, instant ? -1e9 : now);
    for (const k of [...this.spikeBirth.keys()]) if (!live.has(k)) this.spikeBirth.delete(k);
  }

  isAnimating(now: number): boolean {
    for (const tw of this.tweens.values()) if (now - tw.start < MOVE_MS) return true;
    return false;
  }

  private pawnPixel(id: PlayerId, now: number) {
    const tw = this.tweens.get(id)!;
    const t = Math.min(1, (now - tw.start) / MOVE_MS);
    const k = ease(t);
    return { x: tw.from.x + (tw.to.x - tw.from.x) * k, y: tw.from.y + (tw.to.y - tw.from.y) * k };
  }

  // ── The frame ──────────────────────────────────────────────

  draw(view: ViewModel, now: number): void {
    const { ctx } = this;
    const { state } = view;

    ctx.clearRect(0, 0, BOARD_PX, BOARD_PX);
    this.drawRoadNetwork();
    this.drawStages(state);
    this.drawJunctions(view);
    if (state.phase === 'CHOOSE_ACTION' && state.mode === 'DRIVE') this.drawLegalMoves(view, now);
    for (const rb of state.roadblocks) this.drawSpikes(rb, now, 'placed');
    if (view.preview) this.drawSpikes(view.preview.rb, now, view.preview.valid ? 'preview' : 'bad');
    this.drawPawns(view, now);
  }

  private drawRoadNetwork(): void {
    const { ctx } = this;
    ctx.fillStyle = C.groove;
    roundRect(ctx, 0, 0, BOARD_PX, BOARD_PX, 18);
    ctx.fill();

    // Faint dashed lane markings running down the middle of every groove.
    ctx.strokeStyle = C.laneMark;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    for (let i = 0; i < BOARD_SIZE - 1; i++) {
      const g = PAD + i * STEP + CELL + GAP / 2;
      ctx.beginPath();
      ctx.moveTo(g, PAD);
      ctx.lineTo(g, BOARD_PX - PAD);
      ctx.moveTo(PAD, g);
      ctx.lineTo(BOARD_PX - PAD, g);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Tint each driver's destination row in their colour. */
  private drawStages(state: MatchState): void {
    const { ctx } = this;
    for (const p of state.players) {
      const y = PAD + p.targetStageY * STEP - 4;
      ctx.fillStyle = hexA(p.color, 0.1);
      roundRect(ctx, PAD - 6, y, BOARD_PX - PAD * 2 + 12, CELL + 8, 12);
      ctx.fill();
      ctx.strokeStyle = hexA(p.color, 0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawJunctions(view: ViewModel): void {
    const { ctx } = this;
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const o = cellOrigin({ x, y });
        const hover = view.hoverCell && view.hoverCell.x === x && view.hoverCell.y === y;
        ctx.fillStyle = hover && view.state.mode === 'DRIVE' ? C.junctionHover : C.junction;
        roundRect(ctx, o.x, o.y, CELL, CELL, 9);
        ctx.fill();
      }
    }
  }

  private drawLegalMoves(view: ViewModel, now: number): void {
    const { ctx } = this;
    const me = view.state.players[view.state.currentTurn - 1];
    const pulse = view.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
    for (const m of view.legalMoves) {
      const c = cellCenter(m);
      ctx.fillStyle = hexA(me.color, 0.12 + 0.1 * pulse);
      roundRect(ctx, c.x - CELL / 2 + 3, c.y - CELL / 2 + 3, CELL - 6, CELL - 6, 8);
      ctx.fill();
      ctx.strokeStyle = hexA(me.color, 0.75);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = me.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** A Kanjo Spike strip: dark base with yellow teeth along both edges. */
  private drawSpikes(rb: Roadblock, now: number, kind: 'placed' | 'preview' | 'bad'): void {
    const { ctx } = this;
    const r = roadblockRect(rb);
    let scale = 1;
    if (kind === 'placed') {
      const born = this.spikeBirth.get(spikeKey(rb)) ?? -1e9;
      const t = Math.min(1, (now - born) / SPIKE_MS);
      scale = 0.6 + 0.4 * ease(t) + 0.08 * Math.sin(Math.PI * t);
    }
    const tooth = kind === 'bad' ? C.spikeBad : C.spikeTooth;

    ctx.save();
    ctx.globalAlpha = kind === 'placed' ? 1 : 0.65;
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(scale, scale);
    const horiz = rb.orientation === 'HORIZONTAL';
    const len = horiz ? r.w : r.h;
    const thick = (horiz ? r.h : r.w) + 4;
    if (!horiz) ctx.rotate(Math.PI / 2);

    ctx.fillStyle = C.spikeBase;
    roundRect(ctx, -len / 2, -thick / 2, len, thick, 4);
    ctx.fill();
    ctx.strokeStyle = tooth;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = tooth;
    const n = Math.floor(len / 9);
    const w = len / n;
    for (let i = 0; i < n; i++) {
      const x0 = -len / 2 + i * w;
      ctx.beginPath();
      ctx.moveTo(x0 + 1, -thick / 2 + 1.5);
      ctx.lineTo(x0 + w / 2, 0);
      ctx.lineTo(x0 + w - 1, -thick / 2 + 1.5);
      ctx.moveTo(x0 + 1, thick / 2 - 1.5);
      ctx.lineTo(x0 + w / 2, 0);
      ctx.lineTo(x0 + w - 1, thick / 2 - 1.5);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPawns(view: ViewModel, now: number): void {
    const { ctx } = this;
    const { state } = view;
    // Draw the waiting driver first so the active one sits on top when they meet.
    const isActive = (id: PlayerId) => (id === state.currentTurn ? 1 : 0);
    const order = [...state.players].sort((a, b) => isActive(a.id) - isActive(b.id));
    for (const p of order) {
      const pos = this.pawnPixel(p.id, now);
      const size = CELL - 8;
      const active = state.phase === 'CHOOSE_ACTION' && p.id === state.currentTurn;

      if (active) {
        const pulse = view.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 200);
        ctx.strokeStyle = hexA(p.color, 0.25 + 0.35 * pulse);
        ctx.lineWidth = 3;
        roundRect(ctx, pos.x - size / 2 - 6, pos.y - size / 2 - 6, size + 12, size + 12, 16);
        ctx.stroke();
      }

      ctx.save();
      roundRect(ctx, pos.x - size / 2, pos.y - size / 2, size, size, 11);
      ctx.clip();
      const img = this.images[p.vehicleType];
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, pos.x - size / 2, pos.y - size / 2, size, size);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(pos.x - size / 2, pos.y - size / 2, size, size);
      }
      ctx.restore();

      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3;
      roundRect(ctx, pos.x - size / 2, pos.y - size / 2, size, size, 11);
      ctx.stroke();
    }
  }
}

// ── Drawing helpers ──────────────────────────────────────────

const spikeKey = (rb: Roadblock) => `${rb.x},${rb.y},${rb.orientation}`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** "#FFCC00" + 0.3 → "rgba(255,204,0,0.3)" */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

