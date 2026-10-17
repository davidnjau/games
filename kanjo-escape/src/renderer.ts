// ─────────────────────────────────────────────────────────────
// renderer.ts — draws the city, pieces and effects each frame.
// Owns only visual state: tweens, the reveal radar, hover.
// ─────────────────────────────────────────────────────────────

import { EDGES, NODES } from './game/map';
import type { MatchState, NodeId, Side } from './game/types';

// ── Map units → pixels ───────────────────────────────────────
export const UNIT = 44;
const MIN_X = -2.0;
const MIN_Y = -1.6;
export const VIEW_W = Math.round(16 * UNIT);
export const VIEW_H = Math.round(17.2 * UNIT);

export const toPx = (x: number, y: number) => ({ x: (x - MIN_X) * UNIT, y: (y - MIN_Y) * UNIT });
export const toMap = (px: number, py: number) => ({ x: px / UNIT + MIN_X, y: py / UNIT + MIN_Y });

/** Nearest node to a map-space point, if close enough to count as a tap on it. */
export function nodeAt(px: number, py: number): NodeId | null {
  const p = toMap(px, py);
  let best: NodeId | null = null;
  let bestD = Infinity;
  for (const n of Object.values(NODES)) {
    const reach = n.kind === 'STAGE' || n.kind === 'DEPOT' ? 1.2 : 0.7;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < reach && d < bestD) {
      best = n.id;
      bestD = d;
    }
  }
  return best;
}

const C = {
  ground: '#0B0F14',
  blockBase: '#0E141B',
  blockEdge: 'rgba(255, 255, 255, 0.06)',
  road: '#262F3A',
  lane: 'rgba(255, 205, 110, 0.45)',
  crosswalk: 'rgba(233, 227, 211, 0.4)',
  alley: '#C9853E',
  junction: '#3A4554',
  stage: '#1FAE74',
  stageText: '#052416',
  depot: '#E8590C',
  depotText: '#2A0E02',
  hawker: '#FFB020',
  kanjo: '#4FC3F7',
  radar: '#FF6B1A',
  label: '#E9E3D3',
  badgeText: '#0B0F14',
};

/** Building roof tones — a muted skyline palette, picked deterministically per block. */
const ROOFS = ['#2F6F6B', '#5C3A52', '#2E4A36', '#3A5A82', '#4A3A5E', '#6B4A3A'];
const hashCell = (i: number, j: number) => (i * 7 + j * 13) % ROOFS.length;

export interface View {
  state: MatchState;
  human: Side;
  showHawker: boolean; // human is the hawker, or game over
  showIntel: boolean;
  hover: NodeId | null;
  targets: NodeId[]; // highlighted destinations
  targetColor: 'hawker' | 'kanjo';
  selectedUnit: string | null;
  reducedMotion: boolean;
}

interface Tween {
  path: { x: number; y: number }[];
  start: number;
  dur: number;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private tweens = new Map<string, Tween>();
  private radar: { node: NodeId; start: number } | null = null;
  private flash: { node: NodeId; start: number; color: string } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private icons: Record<'hawker' | 'truck' | 'askari', HTMLImageElement>,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = VIEW_W * dpr;
    this.canvas.height = VIEW_H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Animation triggers ─────────────────────────────────────

  /** Slide a piece along a list of nodes. */
  animate(pieceId: string, path: NodeId[], now: number): void {
    if (path.length < 2) return;
    const pts = path.map((id) => toPx(NODES[id].x, NODES[id].y));
    this.tweens.set(pieceId, { path: pts, start: now, dur: 230 * (path.length - 1) });
  }

  reveal(node: NodeId, now: number): void {
    this.radar = { node, start: now };
  }

  pulse(node: NodeId, now: number, color = C.kanjo): void {
    this.flash = { node, start: now, color };
  }

  isAnimating(now: number): boolean {
    for (const t of this.tweens.values()) if (now - t.start < t.dur) return true;
    return false;
  }

  private piecePos(id: string, node: NodeId, now: number) {
    const tw = this.tweens.get(id);
    const home = toPx(NODES[node].x, NODES[node].y);
    if (!tw) return home;
    const t = Math.min(1, (now - tw.start) / tw.dur);
    if (t >= 1) {
      this.tweens.delete(id);
      return home;
    }
    const segs = tw.path.length - 1;
    const f = ease(t) * segs;
    const i = Math.min(segs - 1, Math.floor(f));
    const k = f - i;
    const a = tw.path[i];
    const b = tw.path[i + 1];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  // ── Frame ──────────────────────────────────────────────────

  draw(v: View, now: number): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = C.ground;
    roundRect(ctx, 0, 0, VIEW_W, VIEW_H, 18);
    ctx.fill();

    this.drawBuildings();
    this.drawEdges();
    this.drawCrosswalks();
    this.drawNodes(v);
    this.drawTargets(v, now);
    if (v.showIntel && v.state.phase !== 'GAME_OVER') this.drawBelief(v);
    this.drawLastSeen(v);
    this.drawRadar(now);
    this.drawFlash(now);
    this.drawPieces(v, now);
  }

  /** City blocks drawn as flat-topped "3D" buildings: a shadow base, a lifted roof, and window dots. */
  private drawBuildings(): void {
    const { ctx } = this;
    const xs = [...new Set(Object.values(NODES).filter((n) => n.kind === 'JUNCTION').map((n) => n.x))].sort((a, b) => a - b);
    const ys = [...new Set(Object.values(NODES).filter((n) => n.kind === 'JUNCTION').map((n) => n.y))].sort((a, b) => a - b);
    const inset = 0.34;
    const lift = Math.max(3, UNIT * 0.08);
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) {
        const a = toPx(xs[i] + inset, ys[j] + inset);
        const b = toPx(xs[i + 1] - inset, ys[j + 1] - inset);
        const w = b.x - a.x;
        const h = b.y - a.y;

        // Shadow base: the full footprint, sitting "under" the roof.
        ctx.fillStyle = C.blockBase;
        roundRect(ctx, a.x, a.y + lift, w, h, 6);
        ctx.fill();

        // Roof: lifted up-left, tinted from a small skyline palette.
        ctx.fillStyle = ROOFS[hashCell(i, j)];
        roundRect(ctx, a.x, a.y, w, h, 6);
        ctx.fill();
        ctx.strokeStyle = C.blockEdge;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Windows: a small fixed dot grid, stable across frames.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        const cols = 3;
        const rows = 2;
        const pad = Math.min(w, h) * 0.22;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const wx = a.x + pad + (c * (w - pad * 2)) / (cols - 1);
            const wy = a.y + pad + (r * (h - pad * 2)) / (rows - 1);
            ctx.beginPath();
            ctx.arc(wx, wy, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  /** A short strip of pale ticks across each junction, like a zebra crossing. */
  private drawCrosswalks(): void {
    const { ctx } = this;
    ctx.strokeStyle = C.crosswalk;
    ctx.lineWidth = 2;
    for (const n of Object.values(NODES)) {
      if (n.kind !== 'JUNCTION') continue;
      const link = EDGES.find((e) => (e.a === n.id || e.b === n.id) && e.kind === 'ROAD');
      if (!link) continue;
      const other = NODES[link.a === n.id ? link.b : link.a];
      const dx = other.x - n.x;
      const dy = other.y - n.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const p = toPx(n.x + ux * 0.3, n.y + uy * 0.3);
      for (let k = -1; k <= 1; k++) {
        const ox = px * k * UNIT * 0.1;
        const oy = py * k * UNIT * 0.1;
        ctx.beginPath();
        ctx.moveTo(p.x + ox - ux * UNIT * 0.06, p.y + oy - uy * UNIT * 0.06);
        ctx.lineTo(p.x + ox + ux * UNIT * 0.06, p.y + oy + uy * UNIT * 0.06);
        ctx.stroke();
      }
    }
  }

  private drawEdges(): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    // Roads first (wide), then lane markings, then alleys on top.
    for (const pass of ['road', 'lane', 'alley'] as const) {
      for (const e of EDGES) {
        if ((pass === 'alley') !== (e.kind === 'ALLEY')) continue;
        const a = toPx(NODES[e.a].x, NODES[e.a].y);
        const b = toPx(NODES[e.b].x, NODES[e.b].y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (pass === 'road') {
          ctx.strokeStyle = C.road;
          ctx.lineWidth = UNIT * 0.42;
          ctx.setLineDash([]);
        } else if (pass === 'lane') {
          ctx.strokeStyle = C.lane;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 8]);
        } else {
          ctx.strokeStyle = C.alley;
          ctx.lineWidth = 3;
          ctx.setLineDash([3, 5]);
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  private drawNodes(v: View): void {
    const { ctx } = this;
    for (const n of Object.values(NODES)) {
      const p = toPx(n.x, n.y);
      const hover = v.hover === n.id;
      if (n.kind === 'JUNCTION') {
        ctx.fillStyle = hover ? '#55657A' : C.junction;
        ctx.beginPath();
        ctx.arc(p.x, p.y, UNIT * 0.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (n.kind === 'ALLEY') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = hover ? '#E8A65C' : C.alley;
        const s = UNIT * 0.26;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        const isStage = n.kind === 'STAGE';
        const label = isStage ? `${n.label.toUpperCase()} STAGE ↗` : '✚ KANJO HQ';
        ctx.font = `600 ${isStage ? 12 : 11}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        const w = Math.max(UNIT * 2.1, ctx.measureText(label).width + 22);
        const h = UNIT * 0.72;
        ctx.fillStyle = isStage ? C.stage : C.depot;
        roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, h / 2);
        ctx.fill();
        if (hover) {
          ctx.strokeStyle = C.label;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.fillStyle = isStage ? C.stageText : C.depotText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, p.x, p.y + 1);
      }
    }
  }

  /** Numbered badges on every legal destination — the same numbers used by the sidebar move list. */
  private drawTargets(v: View, now: number): void {
    const { ctx } = this;
    const color = v.targetColor === 'hawker' ? C.hawker : C.kanjo;
    const pulse = v.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 240);
    v.targets.forEach((id, i) => {
      const n = NODES[id];
      const p = toPx(n.x, n.y);
      const r = UNIT * 0.28;

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35 + 0.35 * pulse;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, UNIT * (n.kind === 'STAGE' ? 0.62 : 0.46), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.badgeText;
      ctx.font = `700 ${Math.round(r)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.x, p.y + 1);
    });
  }

  private drawBelief(v: View): void {
    const { ctx } = this;
    ctx.font = `600 13px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const id of v.state.belief) {
      const n = NODES[id];
      const p = toPx(n.x + 0.32, n.y - 0.32);
      ctx.fillStyle = 'rgba(255, 107, 26, 0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1A0A02';
      ctx.fillText('?', p.x, p.y + 1);
    }
  }

  private drawLastSeen(v: View): void {
    const seen = v.state.lastSeen;
    if (!seen || v.state.phase === 'GAME_OVER') return;
    if (v.showHawker && seen.node === v.state.hawkerNode) return;
    const { ctx } = this;
    const n = NODES[seen.node];
    const p = toPx(n.x, n.y);
    ctx.globalAlpha = 0.45;
    this.drawIcon(this.icons.hawker, p.x, p.y, UNIT * 0.8, C.radar);
    ctx.globalAlpha = 1;
    ctx.font = `600 11px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.fillStyle = C.radar;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`R${seen.round}`, p.x, p.y + UNIT * 0.46);
  }

  private drawRadar(now: number): void {
    if (!this.radar) return;
    const t = (now - this.radar.start) / 2200;
    if (t > 1) {
      this.radar = null;
      return;
    }
    const { ctx } = this;
    const n = NODES[this.radar.node];
    const p = toPx(n.x, n.y);
    for (let i = 0; i < 3; i++) {
      const k = (t * 3 + i / 3) % 1;
      ctx.strokeStyle = C.radar;
      ctx.globalAlpha = (1 - k) * (1 - t * 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, UNIT * (0.4 + k * 2.2), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawFlash(now: number): void {
    if (!this.flash) return;
    const t = (now - this.flash.start) / 600;
    if (t > 1) {
      this.flash = null;
      return;
    }
    const { ctx } = this;
    const n = NODES[this.flash.node];
    const p = toPx(n.x, n.y);
    ctx.strokeStyle = this.flash.color;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, UNIT * (0.45 + t * 0.6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawPieces(v: View, now: number): void {
    const { state } = v;
    const radarOn = this.radar !== null;
    if (v.showHawker || radarOn) {
      const node = radarOn && !v.showHawker ? this.radar!.node : state.hawkerNode;
      const p = this.piecePos('hawker', node, now);
      this.drawIcon(this.icons.hawker, p.x, p.y, UNIT * 0.92, C.hawker);
      this.drawBadge(p.x + UNIT * 0.32, p.y + UNIT * 0.32, 'H', C.hawker);
    }
    state.askaris.forEach((a, i) => {
      const p = this.piecePos(a.id, a.node, now);
      const dim = state.phase === 'KANJO_TURN' && a.moved;
      this.ctx.globalAlpha = dim ? 0.55 : 1;
      const selected = v.selectedUnit === a.id;
      if (selected) {
        this.ctx.strokeStyle = C.kanjo;
        this.ctx.lineWidth = 3;
        roundRect(this.ctx, p.x - UNIT * 0.6, p.y - UNIT * 0.6, UNIT * 1.2, UNIT * 1.2, 14);
        this.ctx.stroke();
      }
      this.drawIcon(a.kind === 'TRUCK' ? this.icons.truck : this.icons.askari, p.x, p.y, UNIT * 0.92, C.kanjo);
      this.drawBadge(p.x + UNIT * 0.32, p.y + UNIT * 0.32, String(i + 1).padStart(2, '0'), C.kanjo);
      this.ctx.globalAlpha = 1;
    });
  }

  /** A small corner badge linking a map piece to its row in the sidebar list. */
  private drawBadge(x: number, y: number, text: string, bg: string): void {
    const { ctx } = this;
    const r = UNIT * 0.19;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.ground;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.badgeText;
    ctx.font = `700 ${Math.round(r * 1.05)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  private drawIcon(img: HTMLImageElement, x: number, y: number, size: number, ring: string): void {
    const { ctx } = this;
    ctx.save();
    roundRect(ctx, x - size / 2, y - size / 2, size, size, size * 0.22);
    ctx.clip();
    if (img.complete && img.naturalWidth) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    else {
      ctx.fillStyle = ring;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2.5;
    roundRect(ctx, x - size / 2, y - size / 2, size, size, size * 0.22);
    ctx.stroke();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
