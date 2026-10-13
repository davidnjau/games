// ─────────────────────────────────────────────────────────────
// main.ts — the conductor.
//
//   input (pointer/keys) ──► rules (pure)  ──► new MatchState
//                                               │
//   requestAnimationFrame loop ◄── renderer ◄───┘   + HUD/DOM updates
//
// This file holds the current state, turns player intent into
// rule calls, and keeps the screen in step.
// ─────────────────────────────────────────────────────────────

import './style.css';
import manyangaUrl from './assets/icons/manyanga.svg';
import chapaaUrl from './assets/icons/chapaa.svg';
import cabUrl from './assets/icons/cab.svg';

import {
  activePlayer,
  addPos,
  applyMove,
  applyRoadblock,
  createMatch,
  isLegalMove,
  legalMoves,
  samePos,
  setMode,
  shortestRouteLength,
  validateRoadblock,
} from './game/rules';
import { SPIKES_PER_PLAYER, type MatchState, type PlayerId, type Position, type Roadblock, type VehicleType } from './game/types';
import { BOARD_PX, pixelToCell, pixelToGroove } from './layout';
import { Renderer } from './renderer';
import { Sound } from './audio';
import { S, VEHICLES } from './strings';
import { OnlineClient, type LobbyInfo, type ServerMessage } from './net';

// ── Assets ───────────────────────────────────────────────────

const ICONS: Record<VehicleType, string> = { MANYANGA: manyangaUrl, CHAPAA: chapaaUrl, UBER: cabUrl };
const VEHICLE_ORDER: VehicleType[] = ['MANYANGA', 'CHAPAA', 'UBER'];

function loadImage(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}
const images = Object.fromEntries(
  VEHICLE_ORDER.map((v) => [v, loadImage(ICONS[v])]),
) as Record<VehicleType, HTMLImageElement>;

// ── DOM handles ──────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ui = {
  turn: $('turn'),
  sound: $<HTMLButtonElement>('sound'),
  panels: { 1: $('panel-1'), 2: $('panel-2') } as Record<PlayerId, HTMLElement>,
  toast: $('toast'),
  select: $('select'),
  selectTitle: $('select-title'),
  pickers: $('pickers'),
  start: $<HTMLButtonElement>('start'),
  win: $('win'),
  winIcon: $<HTMLImageElement>('win-icon'),
  winTitle: $('win-title'),
  winSub: $('win-sub'),
  rematch: $<HTMLButtonElement>('rematch'),
  change: $<HTMLButtonElement>('change'),
  drive: $<HTMLButtonElement>('btn-drive'),
  spikes: $<HTMLButtonElement>('btn-spikes'),
  undo: $<HTMLButtonElement>('btn-undo'),
  hint: $('hint'),
};

// ── Game state (the single source of truth) ─────────────────

let picks: Record<PlayerId, VehicleType> = { 1: 'MANYANGA', 2: 'UBER' };
let match: MatchState = { ...createMatch(picks[1], picks[2]), phase: 'SELECT_VEHICLES' };
let history: MatchState[] = []; // previous states, for undo
let moves: Position[] = []; // legal moves cache for the current state

// Transient UI state (not part of the game itself)
let hoverCell: Position | null = null;
let preview: { rb: Roadblock; valid: boolean } | null = null;
let winShown = false;
let toastTimer = 0;

const renderer = new Renderer(canvas, images);
renderer.sync(match, performance.now(), true); // seed pawn tweens before the first frame draws
const sound = new Sound();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

// ── Online play ──────────────────────────────────────────────
// `?online` swaps the local hot-seat loop for a relay server
// (server/index.ts): moves go out as intent, and the only state we
// render is whatever the server echoes back.
//
// In production (`npm run build` + `npm run start`) the relay and the
// static page are served from the same host:port, so the default below
// just reconnects to wherever this page came from. Local dev runs them
// as two separate processes (`npm run dev` on 5173, `npm run server` on
// 8080) — pass `?online=ws://localhost:8080` to point at the relay.

const params = new URLSearchParams(location.search);
const ONLINE = params.has('online');
const SAME_ORIGIN_WS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
const SERVER_URL = params.get('online') || SAME_ORIGIN_WS;

let myPlayerId: PlayerId | null = null;
let onlineClient: OnlineClient | null = null;
let lobby: LobbyInfo = { picks: { 1: null, 2: null }, ready: { 1: false, 2: false } };

try {
  sound.muted = localStorage.getItem('matatu-rush:muted') === '1';
} catch {
  /* storage blocked — default to sound on */
}

/** Every state change goes through here. */
function commit(next: MatchState, opts: { record?: boolean; instant?: boolean } = {}): void {
  if (opts.record ?? true) history.push(match);
  match = next;
  moves = match.phase === 'CHOOSE_ACTION' ? legalMoves(match) : [];
  preview = null;
  renderer.sync(match, performance.now(), opts.instant);
  renderHud();
}

// ── Actions ──────────────────────────────────────────────────

function startMatch(): void {
  sound.unlock();
  history = [];
  winShown = false;
  ui.select.hidden = true;
  ui.win.hidden = true;
  commit(createMatch(picks[1], picks[2]), { record: false, instant: true });
  sound.horn();
}

function openVehicleSelect(): void {
  ui.win.hidden = true;
  winShown = false;
  history = [];
  commit({ ...createMatch(picks[1], picks[2]), phase: 'SELECT_VEHICLES' }, { record: false, instant: true });
  renderPickers();
  ui.select.hidden = false;
  ui.start.focus();
}

function tryDrive(to: Position): void {
  if (ONLINE && match.currentTurn !== myPlayerId) {
    toast(S.notYourTurn);
    sound.error();
    return;
  }
  if (isLegalMove(match, to)) {
    if (ONLINE) onlineClient!.move(to);
    else commit(applyMove(match, to));
    sound.horn();
  } else if (!samePos(to, activePlayer(match).position)) {
    toast(S.invalidMove);
    sound.error();
  }
}

function tryDropSpikes(rb: Roadblock): void {
  if (ONLINE && match.currentTurn !== myPlayerId) {
    toast(S.notYourTurn);
    sound.error();
    return;
  }
  const check = validateRoadblock(match, rb);
  if (check.ok) {
    if (ONLINE) onlineClient!.spike(rb);
    else commit(applyRoadblock(match, rb));
    sound.spikes();
  } else {
    toast(S.rejection[check.reason]);
    sound.error();
    preview = { rb, valid: false };
  }
}

function changeMode(mode: MatchState['mode']): void {
  if (match.phase !== 'CHOOSE_ACTION') return;
  if (ONLINE && match.currentTurn !== myPlayerId) {
    toast(S.notYourTurn);
    sound.error();
    return;
  }
  if (mode === 'SPIKES' && activePlayer(match).spikesRemaining === 0) {
    toast(S.rejection.NO_SPIKES);
    sound.error();
    return;
  }
  sound.click();
  commit(setMode(match, mode), { record: false });
}

function undo(): void {
  const prev = history.pop();
  if (!prev) return;
  ui.win.hidden = true;
  winShown = false;
  commit(prev, { record: false });
}

// ── Input ────────────────────────────────────────────────────

/** Screen pixels → board pixels (the canvas is CSS-scaled). */
function toBoard(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * BOARD_PX,
    y: ((e.clientY - r.top) / r.height) * BOARD_PX,
  };
}

const busy = () => match.phase !== 'CHOOSE_ACTION' || renderer.isAnimating(performance.now());

canvas.addEventListener('pointermove', (e) => {
  if (match.phase !== 'CHOOSE_ACTION' || e.pointerType === 'touch') return;
  const p = toBoard(e);
  hoverCell = pixelToCell(p.x, p.y);
  if (match.mode === 'SPIKES') {
    const rb = pixelToGroove(p.x, p.y);
    preview = { rb, valid: validateRoadblock(match, rb).ok };
  }
});

canvas.addEventListener('pointerleave', (e) => {
  hoverCell = null;
  if (e.pointerType !== 'touch') preview = null;
});

canvas.addEventListener('pointerdown', (e) => {
  if (busy()) return;
  sound.unlock();
  const p = toBoard(e);

  if (match.mode === 'DRIVE') {
    const cell = pixelToCell(p.x, p.y);
    if (cell) tryDrive(cell);
    return;
  }

  const rb = pixelToGroove(p.x, p.y);
  // Touch has no hover, so the first tap previews and a second tap confirms.
  const confirmed = preview && samePos(preview.rb, rb) && preview.rb.orientation === rb.orientation;
  if (e.pointerType === 'touch' && !confirmed) {
    preview = { rb, valid: validateRoadblock(match, rb).ok };
    return;
  }
  tryDropSpikes(rb);
});

const ARROWS: Record<string, Position> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (key === 'z') return undo();
  if (busy()) return;
  if (key === 'd' || key === 'escape') return changeMode('DRIVE');
  if (key === 's') return changeMode(match.mode === 'SPIKES' ? 'DRIVE' : 'SPIKES');

  const dir = ARROWS[e.key];
  if (dir && match.mode === 'DRIVE') {
    e.preventDefault();
    const pos = activePlayer(match).position;
    const one = addPos(pos, dir);
    const two = addPos(one, dir); // straight overtake
    tryDrive(isLegalMove(match, one) ? one : isLegalMove(match, two) ? two : one);
  }
});

ui.drive.addEventListener('click', () => changeMode('DRIVE'));
ui.spikes.addEventListener('click', () => changeMode(match.mode === 'SPIKES' ? 'DRIVE' : 'SPIKES'));
ui.undo.addEventListener('click', undo);
ui.start.addEventListener('click', () => {
  sound.unlock();
  if (ONLINE) onlineClient?.ready();
  else startMatch();
});
ui.rematch.addEventListener('click', () => (ONLINE ? onlineClient?.rematch() : startMatch()));
ui.change.addEventListener('click', () => (ONLINE ? onlineClient?.rematch() : openVehicleSelect()));
ui.sound.addEventListener('click', () => {
  sound.unlock();
  sound.muted = !sound.muted;
  try {
    localStorage.setItem('matatu-rush:muted', sound.muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  renderHud();
  sound.click();
});
window.addEventListener('resize', () => renderer.resize());

// ── HUD rendering (DOM) ──────────────────────────────────────

const nameOf = (id: PlayerId): string => {
  const v = match.players[id - 1].vehicleType;
  const twin = match.players[0].vehicleType === match.players[1].vehicleType;
  return twin ? `${VEHICLES[v].name} ${id}` : VEHICLES[v].name;
};

function renderHud(): void {
  const playing = match.phase === 'CHOOSE_ACTION';
  const me = activePlayer(match);

  const turnLabel = ONLINE && me.id === myPlayerId ? S.yourTurn : S.turn(nameOf(me.id));
  ui.turn.innerHTML = playing
    ? `<span class="dot" style="background:${me.color}"></span><span>${turnLabel}</span><span class="round">${S.turnCount(match.turnNumber)}</span>`
    : '';

  for (const p of match.players) {
    const steps = shortestRouteLength(p.position, p.targetStageY, match.roadblocks);
    const pips = Array.from({ length: SPIKES_PER_PLAYER }, (_, i) =>
      `<span class="pip${i < p.spikesRemaining ? '' : ' used'}"></span>`,
    ).join('');
    const panel = ui.panels[p.id];
    panel.classList.toggle('is-turn', playing && p.id === match.currentTurn);
    const label = ONLINE && p.id === myPlayerId ? `${S.driver(p.id)} (${S.you})` : S.driver(p.id);
    panel.innerHTML = `
      <div class="panel-head">
        <img src="${ICONS[p.vehicleType]}" alt="" />
        <div><div class="panel-label">${label}</div><div class="panel-name">${nameOf(p.id)}</div></div>
      </div>
      <div class="stat"><span class="stat-label">${S.spikesLeft}</span>
        <span class="stat-value">${p.spikesRemaining}</span><div class="pips">${pips}</div></div>
      <div class="stat"><span class="stat-label">${S.stepsToStage}</span>
        <span class="stat-value">${steps}</span></div>`;
  }

  ui.drive.setAttribute('aria-pressed', String(playing && match.mode === 'DRIVE'));
  ui.spikes.setAttribute('aria-pressed', String(playing && match.mode === 'SPIKES'));
  ui.drive.disabled = !playing;
  ui.spikes.disabled = !playing || me.spikesRemaining === 0;
  ui.undo.disabled = history.length === 0 || match.phase === 'SELECT_VEHICLES';
  ui.drive.querySelector('span')!.textContent = S.drive;
  ui.spikes.querySelector('span')!.textContent = S.spikes;
  ui.undo.querySelector('span')!.textContent = S.undo;
  ui.sound.textContent = sound.muted ? S.soundOff : S.soundOn;
  ui.hint.textContent = !playing
    ? ''
    : match.mode === 'DRIVE'
      ? S.driveHint
      : coarsePointer
        ? S.spikesHintTouch
        : S.spikesHint;
}

function renderPickers(): void {
  ui.selectTitle.textContent = S.pickTitle;
  ui.start.textContent = S.start;
  ui.pickers.innerHTML = '';
  for (const id of [1, 2] as PlayerId[]) {
    const wrap = document.createElement('div');
    wrap.className = 'picker';
    const color = match.players[id - 1].color;
    wrap.innerHTML = `<div class="picker-label" style="color:${color}">${S.driver(id)}</div><div class="picker-options"></div>`;
    const opts = wrap.querySelector('.picker-options')!;
    for (const v of VEHICLE_ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option';
      b.id = `pick-${id}-${v.toLowerCase()}`;
      b.style.setProperty('--pc', color);
      b.setAttribute('aria-pressed', String(picks[id] === v));
      b.innerHTML = `<img src="${ICONS[v]}" alt="" /><span class="option-name">${VEHICLES[v].name}</span><span class="option-tag">${VEHICLES[v].tagline}</span>`;
      b.addEventListener('click', () => {
        sound.unlock();
        sound.click();
        picks = { ...picks, [id]: v };
        commit({ ...createMatch(picks[1], picks[2]), phase: 'SELECT_VEHICLES' }, { record: false, instant: true });
        renderPickers();
        document.getElementById(b.id)?.focus();
      });
      opts.appendChild(b);
    }
    ui.pickers.appendChild(wrap);
  }
}

function connectOnline(): void {
  ui.win.hidden = true;
  ui.select.hidden = false;
  onlineClient = new OnlineClient(SERVER_URL, handleServerMessage);
  renderLobby();
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'assigned':
      myPlayerId = msg.playerId;
      renderLobby();
      break;
    case 'lobby':
      lobby = { picks: msg.picks, ready: msg.ready };
      if (match.phase !== 'SELECT_VEHICLES') {
        toast(S.opponentLeft);
        history = [];
        winShown = false;
        ui.win.hidden = true;
        commit({ ...createMatch(picks[1], picks[2]), phase: 'SELECT_VEHICLES' }, { record: false, instant: true });
      }
      ui.select.hidden = false;
      renderLobby();
      break;
    case 'state': {
      const firstMatch = match.phase === 'SELECT_VEHICLES';
      ui.select.hidden = true;
      ui.win.hidden = true;
      winShown = false;
      commit(msg.match, { record: false, instant: firstMatch });
      break;
    }
    case 'error':
      toast(msg.message);
      break;
  }
}

function renderLobby(): void {
  if (myPlayerId === null) {
    ui.selectTitle.textContent = S.connecting;
    ui.pickers.innerHTML = '';
    ui.start.hidden = true;
    return;
  }

  const iAmReady = lobby.ready[myPlayerId];
  ui.selectTitle.textContent = iAmReady ? S.readyWaiting : S.pickTitle;
  ui.pickers.innerHTML = '';

  for (const id of [1, 2] as PlayerId[]) {
    const mine = id === myPlayerId;
    const wrap = document.createElement('div');
    wrap.className = 'picker';
    const color = match.players[id - 1].color;
    const tag = mine ? ` (${S.you})` : lobby.ready[id] ? ' ✓' : '';
    wrap.innerHTML = `<div class="picker-label" style="color:${color}">${S.driver(id)}${tag}</div><div class="picker-options"></div>`;
    const opts = wrap.querySelector('.picker-options')!;
    for (const v of VEHICLE_ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option';
      b.style.setProperty('--pc', color);
      b.disabled = !mine || iAmReady;
      b.setAttribute('aria-pressed', String(lobby.picks[id] === v));
      b.innerHTML = `<img src="${ICONS[v]}" alt="" /><span class="option-name">${VEHICLES[v].name}</span><span class="option-tag">${VEHICLES[v].tagline}</span>`;
      if (mine) {
        b.addEventListener('click', () => {
          sound.unlock();
          sound.click();
          onlineClient!.pickVehicle(v);
        });
      }
      opts.appendChild(b);
    }
    ui.pickers.appendChild(wrap);
  }

  ui.start.hidden = false;
  ui.start.textContent = iAmReady ? S.readyWaiting : S.ready;
  ui.start.disabled = iAmReady || !lobby.picks[myPlayerId];
}

function showWin(): void {
  winShown = true;
  const w = match.winner!;
  ui.winIcon.src = ICONS[match.players[w - 1].vehicleType];
  ui.winTitle.textContent = S.win;
  ui.winSub.textContent = S.winSub(nameOf(w));
  ui.rematch.textContent = S.rematch;
  ui.change.textContent = S.changeRides;
  ui.win.hidden = false;
  ui.rematch.focus();
  sound.victory();
}

function toast(msg: string): void {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove('show'), 1800);
}

// ── The game loop ────────────────────────────────────────────

function frame(now: number): void {
  renderer.draw({ state: match, legalMoves: moves, hoverCell, preview, reducedMotion }, now);
  if (match.phase === 'GAME_OVER' && !winShown && !renderer.isAnimating(now)) showWin();
  requestAnimationFrame(frame);
}

// ── Boot ─────────────────────────────────────────────────────
// If the page is hot-reloaded inside a Claude artifact viewer, carry
// the running match across instead of starting over.

interface Snapshot {
  match?: MatchState;
  history?: MatchState[];
  picks?: Record<PlayerId, VehicleType>;
}
const hot = (window as any).claude?.hot;
hot?.snapshot?.((): Snapshot => ({ match, history, picks }));

function bootLocal(data: Snapshot = {}): void {
  if (data.picks) picks = data.picks;
  if (data.match && data.match.phase !== 'SELECT_VEHICLES') {
    history = data.history ?? [];
    commit(data.match, { record: false, instant: true });
    ui.select.hidden = true;
  } else {
    openVehicleSelect();
  }
}

if (ONLINE) connectOnline();
else hot?.ready ? hot.ready(bootLocal) : bootLocal(hot?.data ?? {});
requestAnimationFrame(frame);
