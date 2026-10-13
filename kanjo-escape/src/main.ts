// ─────────────────────────────────────────────────────────────
// main.ts — the conductor: menu, turns, AI pacing, input, HUD.
//
// Turn flow (one round):
//   HAWKER_TURN  → hawker moves in secret (human taps, or AI thinks)
//                  reveal round? radar + whistle, belief collapses
//   KANJO_TURN   → each askari moves or holds (human, or AI one by one)
//                  landing on the hawker = caught
//   endKanjoTurn → next round, or TIME_UP / CORNERED
// ─────────────────────────────────────────────────────────────

import './style.css';
import hawkerUrl from './assets/icons/hawker.svg';
import truckUrl from './assets/icons/truck.svg';
import askariUrl from './assets/icons/askari.svg';

import { chooseHawkerMove, chooseSquadOrders } from './game/ai';
import { NODES } from './game/map';
import {
  applyAskariMove,
  applyHawkerMove,
  askariOptions,
  createMatch,
  endKanjoTurn,
  hawkerMoves,
  holdAskari,
  isRevealRound,
  publicView,
  roundsUntilReveal,
} from './game/rules';
import { RULES, type Askari, type MatchState, type NodeId, type Side } from './game/types';
import { Renderer, VIEW_H, VIEW_W, nodeAt } from './renderer';
import { Sound } from './audio';
import { S, outcomeText } from './strings';

// ── Assets & DOM ─────────────────────────────────────────────

const ICON_URL = { hawker: hawkerUrl, truck: truckUrl, askari: askariUrl };
const loadImg = (src: string) => Object.assign(new Image(), { src });
const icons = { hawker: loadImg(hawkerUrl), truck: loadImg(truckUrl), askari: loadImg(askariUrl) };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ui = {
  menu: $('menu'),
  game: $('game'),
  sideChip: $('side-chip'),
  sound: $<HTMLButtonElement>('sound'),
  toMenu: $<HTMLButtonElement>('to-menu'),
  status: $('status'),
  round: $('round'),
  reveal: $('reveal'),
  trail: $('trail'),
  squad: $('squad'),
  squadActions: $('squad-actions'),
  hold: $<HTMLButtonElement>('hold'),
  endTurn: $<HTMLButtonElement>('end-turn'),
  intel: $<HTMLInputElement>('intel'),
  place: $('place'),
  toast: $('toast'),
  end: $('end'),
  endIcon: $<HTMLImageElement>('end-icon'),
  endTitle: $('end-title'),
  endSub: $('end-sub'),
  rematch: $<HTMLButtonElement>('rematch'),
  endMenu: $<HTMLButtonElement>('end-menu'),
};

// ── State ────────────────────────────────────────────────────

let human: Side = 'HAWKER';
let match: MatchState = createMatch();
let selected: string | null = null;
let hover: NodeId | null = null;
let busy = false; // true while the AI acts or a reveal plays — input is ignored
let gameToken = 0; // bumps on every new game so stale AI timers stop
let toastTimer = 0;

const renderer = new Renderer(canvas, icons);
const sound = new Sound();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

try {
  sound.muted = localStorage.getItem('kanjo-escape:muted') === '1';
} catch {
  /* storage unavailable */
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const unitName = (a: Askari) => (a.id === 'askari_2' ? S.foot : `${S.truck} ${a.id === 'askari_1' ? 1 : 2}`);

// ── Game flow ────────────────────────────────────────────────

function startGame(side: Side): void {
  sound.unlock();
  human = side;
  match = createMatch();
  selected = null;
  busy = false;
  gameToken++;
  ui.menu.hidden = true;
  ui.game.hidden = false;
  ui.end.hidden = true;
  ui.toMenu.hidden = false;
  ui.sideChip.hidden = false;
  ui.sideChip.className = `side-chip ${side === 'HAWKER' ? 'hawker' : 'kanjo'}`;
  ui.sideChip.textContent = side === 'HAWKER' ? 'Hawker' : 'Kanjo';
  ui.intel.checked = true;
  renderHud();
  if (side === 'KANJO') void hawkerAiTurn();
}

function openMenu(): void {
  gameToken++;
  busy = false;
  ui.game.hidden = true;
  ui.menu.hidden = false;
  ui.toMenu.hidden = true;
  ui.sideChip.hidden = true;
}

/** Called after every hawker move (human or AI): reveal, then hand over or finish. */
async function afterHawkerMove(from: NodeId, token: number): Promise<boolean> {
  const now = performance.now();
  if (human === 'HAWKER') renderer.animate('hawker', [from, match.hawkerNode], now);
  sound.step();
  renderHud();

  if (match.phase === 'GAME_OVER') {
    await finish(token);
    return false;
  }
  const last = match.trail[match.trail.length - 1];
  if (last.revealedAt) {
    await wait(250);
    if (token !== gameToken) return false;
    renderer.reveal(last.revealedAt, performance.now());
    sound.whistle();
    toast(S.waleWale);
    renderHud();
    await wait(1300);
  } else if (human === 'KANJO') {
    toast(S.hawkerMovedVia(last.via), true);
  }
  return token === gameToken;
}

async function hawkerAiTurn(): Promise<void> {
  const token = gameToken;
  busy = true;
  renderHud();
  await wait(750);
  if (token !== gameToken) return;
  const from = match.hawkerNode;
  match = applyHawkerMove(match, chooseHawkerMove(match));
  if (!(await afterHawkerMove(from, token))) return;
  busy = false;
  selected = firstReadyUnit();
  renderHud();
}

async function humanHawkerMove(to: NodeId): Promise<void> {
  if (!hawkerMoves(match).some((m) => m.to === to)) {
    toast(S.cantGo);
    sound.error();
    return;
  }
  const token = gameToken;
  busy = true;
  const from = match.hawkerNode;
  match = applyHawkerMove(match, to);
  await wait(240);
  if (!(await afterHawkerMove(from, token))) return;
  await kanjoAiTurn(token);
}

async function kanjoAiTurn(token: number): Promise<void> {
  busy = true;
  renderHud();
  await wait(500);
  const orders = chooseSquadOrders(publicView(match)); // ← the AI only ever sees public info
  for (const o of orders) {
    if (token !== gameToken) return;
    if (o.to) {
      moveAskari(o.unitId, o.to);
      if (match.phase === 'GAME_OVER') return finish(token);
      await wait(560);
    } else {
      match = holdAskari(match, o.unitId);
    }
  }
  if (token !== gameToken) return;
  endRound(token);
}

/** Shared by human and AI squad moves. */
function moveAskari(unitId: string, to: NodeId): void {
  const opt = askariOptions(match, unitId).find((o) => o.to === to)!;
  const unit = match.askaris.find((a) => a.id === unitId)!;
  renderer.animate(unitId, opt.path, performance.now());
  match = applyAskariMove(match, unitId, to);
  if (unit.kind === 'TRUCK') sound.engine();
  else sound.step();
  if (match.phase !== 'GAME_OVER') {
    setTimeout(() => {
      renderer.pulse(to, performance.now());
      if (human === 'KANJO') sound.miss();
    }, opt.path.length * 230);
  }
  renderHud();
}

function endRound(token: number): void {
  match = endKanjoTurn(match);
  selected = null;
  if (match.phase === 'GAME_OVER') {
    void finish(token);
    return;
  }
  busy = false;
  renderHud();
  if (human === 'KANJO') void hawkerAiTurn();
}

async function finish(token: number): Promise<void> {
  busy = true;
  renderHud();
  while (renderer.isAnimating(performance.now())) await wait(60);
  await wait(350);
  if (token !== gameToken) return;
  const o = match.outcome!;
  const place = NODES[o.node].label;
  const text = outcomeText(human, o.winner, o.reason, o.reason === 'ESCAPED' ? NODES[o.node].label : place);
  ui.endIcon.src = o.winner === 'HAWKER' ? ICON_URL.hawker : ICON_URL.truck;
  ui.endTitle.textContent = text.title;
  ui.endTitle.className = `end-title ${text.won ? 'won' : 'lost'}`;
  ui.endSub.textContent = text.sub;
  ui.rematch.textContent = S.rematch;
  ui.endMenu.textContent = S.menu;
  ui.end.hidden = false;
  ui.rematch.focus();
  if (o.winner === 'HAWKER') sound.escape();
  else sound.caught();
}

// ── Human Kanjo actions ──────────────────────────────────────

const firstReadyUnit = () => match.askaris.find((a) => !a.moved)?.id ?? null;
const humanKanjoActive = () => human === 'KANJO' && match.phase === 'KANJO_TURN' && !busy;

function humanAskariMove(to: NodeId): void {
  if (!selected) {
    toast(S.selectUnit);
    return;
  }
  if (!askariOptions(match, selected).some((o) => o.to === to)) {
    toast(S.cantGo);
    sound.error();
    return;
  }
  moveAskari(selected, to);
  if (match.phase === 'GAME_OVER') {
    void finish(gameToken);
    return;
  }
  selected = firstReadyUnit();
  renderHud();
  if (!selected) {
    busy = true;
    const token = gameToken;
    setTimeout(() => token === gameToken && endRound(token), 900);
  }
}

function holdSelected(): void {
  if (!humanKanjoActive() || !selected) return;
  sound.click();
  match = holdAskari(match, selected);
  selected = firstReadyUnit();
  renderHud();
  if (!selected) endRound(gameToken);
}

function endTurnNow(): void {
  if (!humanKanjoActive()) return;
  sound.click();
  endRound(gameToken);
}

// ── Input ────────────────────────────────────────────────────

function toBoard(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H };
}

canvas.addEventListener('pointermove', (e) => {
  const p = toBoard(e);
  hover = nodeAt(p.x, p.y);
  canvas.style.cursor = hover && currentTargets().includes(hover) ? 'pointer' : 'default';
  renderPlace();
});
canvas.addEventListener('pointerleave', () => {
  hover = null;
  renderPlace();
});

canvas.addEventListener('pointerup', (e) => {
  if (busy || match.phase === 'GAME_OVER') return;
  sound.unlock();
  const p = toBoard(e);
  const node = nodeAt(p.x, p.y);
  if (!node) return;
  hover = node;
  renderPlace();

  if (human === 'HAWKER' && match.phase === 'HAWKER_TURN') {
    if (node !== match.hawkerNode) void humanHawkerMove(node);
    return;
  }
  if (humanKanjoActive()) {
    const unitHere = match.askaris.find((a) => a.node === node);
    if (unitHere && !unitHere.moved) {
      selected = unitHere.id;
      sound.click();
      renderHud();
      return;
    }
    if (unitHere && unitHere.moved) return;
    humanAskariMove(node);
  }
});

window.addEventListener('keydown', (e) => {
  if (!humanKanjoActive() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['1', '2', '3'].includes(e.key)) {
    const a = match.askaris[Number(e.key) - 1];
    if (a && !a.moved) {
      selected = a.id;
      renderHud();
    }
  } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
    endTurnNow();
  } else if (e.key.toLowerCase() === 'h') {
    holdSelected();
  }
});

$('pick-hawker').addEventListener('click', () => startGame('HAWKER'));
$('pick-kanjo').addEventListener('click', () => startGame('KANJO'));
ui.toMenu.addEventListener('click', openMenu);
ui.endMenu.addEventListener('click', openMenu);
ui.rematch.addEventListener('click', () => startGame(human));
ui.hold.addEventListener('click', holdSelected);
ui.endTurn.addEventListener('click', endTurnNow);
ui.intel.addEventListener('change', () => sound.click());
ui.sound.addEventListener('click', () => {
  sound.unlock();
  sound.muted = !sound.muted;
  try {
    localStorage.setItem('kanjo-escape:muted', sound.muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  ui.sound.textContent = S.sound(!sound.muted);
  sound.click();
});
window.addEventListener('resize', () => renderer.resize());

// ── HUD ──────────────────────────────────────────────────────

function currentTargets(): NodeId[] {
  if (busy) return [];
  if (human === 'HAWKER' && match.phase === 'HAWKER_TURN') return hawkerMoves(match).map((m) => m.to);
  if (humanKanjoActive() && selected) return askariOptions(match, selected).map((o) => o.to);
  return [];
}

function renderHud(): void {
  // Status line
  let text = '';
  let tone = '';
  if (match.phase === 'GAME_OVER') {
    const o = match.outcome!;
    const t = outcomeText(human, o.winner, o.reason, NODES[o.node].label);
    text = t.title;
    tone = o.winner === human ? 'hawker' : 'alert';
  } else if (match.phase === 'HAWKER_TURN') {
    if (human === 'HAWKER') {
      text = isRevealRound(match.round) ? S.hawkerTurnReveal : S.hawkerTurn;
      tone = isRevealRound(match.round) ? 'alert' : 'hawker';
    } else {
      text = S.hawkerHiding;
      tone = 'hawker';
    }
  } else if (human === 'KANJO' && !busy) {
    text = S.kanjoTurnYou;
    tone = 'kanjo';
  } else {
    text = S.aiThinking;
    tone = 'kanjo';
  }
  const seen = match.trail[match.trail.length - 1]?.revealedAt;
  if (seen && match.phase === 'KANJO_TURN') {
    text = `${S.waleWale} ${NODES[seen].label}`;
    tone = 'alert';
  }
  ui.status.textContent = text || ' ';
  ui.status.className = `status ${tone}`;

  // Clock
  ui.round.textContent = S.round(match.round, RULES.maxRounds);
  // During the hawker's turn, a reveal "this round" happens right after they move.
  // Once they've moved, count from the next round instead.
  const next =
    match.phase === 'HAWKER_TURN' ? roundsUntilReveal(match.round) : roundsUntilReveal(match.round + 1) + 1;
  ui.reveal.textContent = match.phase === 'GAME_OVER' ? '' : S.nextReveal(next);

  // Trail log
  ui.trail.innerHTML = '';
  for (let r = 1; r <= RULES.maxRounds; r++) {
    const li = document.createElement('li');
    const entry = match.trail.find((t) => t.round === r);
    const classes: string[] = [];
    if (isRevealRound(r)) classes.push('reveal-round');
    if (r === match.round && match.phase !== 'GAME_OVER') classes.push('current');
    let v = '';
    if (entry) {
      classes.push(entry.revealedAt ? 'seen' : entry.via === 'ALLEY' ? 'alley' : 'road');
      v = entry.via === 'ALLEY' ? 'ALLEY' : 'BAR.';
      li.title = entry.revealedAt ? NODES[entry.revealedAt].label : v;
    }
    li.className = classes.join(' ');
    li.innerHTML = `<span class="n">${r}</span><span class="v">${v}</span>`;
    ui.trail.appendChild(li);
  }

  // Squad
  ui.squad.innerHTML = '';
  match.askaris.forEach((a, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `unit${a.moved && match.phase === 'KANJO_TURN' ? ' moved' : ''}`;
    b.setAttribute('aria-pressed', String(selected === a.id && humanKanjoActive()));
    b.disabled = !(humanKanjoActive() && !a.moved);
    const range = a.kind === 'TRUCK' ? `${RULES.truckRange} hatua · barabara` : `${RULES.footRange} hatua · alleys sawa`;
    b.innerHTML = `<img src="${a.kind === 'TRUCK' ? ICON_URL.truck : ICON_URL.askari}" alt="" />
      <span><span class="unit-name">${unitName(a)}</span>${human === 'KANJO' ? `<kbd>${i + 1}</kbd>` : ''}<br /><span class="unit-meta">${range} · ${NODES[a.node].label}</span></span>
      <span class="unit-state">${match.phase === 'KANJO_TURN' ? (a.moved ? S.moved : S.ready) : ''}</span>`;
    b.addEventListener('click', () => {
      selected = a.id;
      sound.click();
      renderHud();
    });
    ui.squad.appendChild(b);
  });
  ui.squadActions.hidden = human !== 'KANJO';
  ui.hold.textContent = S.hold;
  ui.endTurn.textContent = S.endTurn;
  ui.hold.disabled = !(humanKanjoActive() && selected);
  ui.endTurn.disabled = !humanKanjoActive();
  ui.sound.textContent = S.sound(!sound.muted);
  renderPlace();
}

function renderPlace(): void {
  ui.place.textContent = hover ? NODES[hover].label : ' ';
}

function toast(msg: string, info = false): void {
  ui.toast.textContent = msg;
  ui.toast.className = `toast show${info ? ' info' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.className = 'toast'), 1800);
}

// ── Static copy & menu ───────────────────────────────────────

function fillStaticText(): void {
  $('tagline').textContent = S.tagline;
  const hawkerCard = $('pick-hawker');
  hawkerCard.querySelector('.side-name')!.textContent = S.playHawker;
  hawkerCard.querySelector('.side-sub')!.textContent = S.playHawkerSub;
  const kanjoCard = $('pick-kanjo');
  kanjoCard.querySelector('.side-name')!.textContent = S.playKanjo;
  kanjoCard.querySelector('.side-sub')!.textContent = S.playKanjoSub;
  document.querySelectorAll<HTMLImageElement>('img[data-icon]').forEach((img) => {
    img.src = ICON_URL[img.dataset.icon as keyof typeof ICON_URL];
  });
  $('rules-title').textContent = S.rulesTitle;
  $('rules-list').innerHTML = S.rules.map((r) => `<li>${r}</li>`).join('');
  $('trail-title').textContent = S.trail;
  $('squad-title').textContent = S.squad;
  $('intel-label').textContent = S.intel;
  $('intel-hint').textContent = S.intelHint;
  ui.toMenu.textContent = S.menu;
  ui.sound.textContent = S.sound(!sound.muted);
}

// ── Game loop ────────────────────────────────────────────────

function frame(now: number): void {
  if (!ui.game.hidden) {
    renderer.draw(
      {
        state: match,
        human,
        showHawker: human === 'HAWKER' || match.phase === 'GAME_OVER',
        showIntel: ui.intel.checked,
        hover,
        targets: currentTargets(),
        targetColor: human === 'HAWKER' ? 'hawker' : 'kanjo',
        selectedUnit: humanKanjoActive() ? selected : null,
        reducedMotion,
      },
      now,
    );
  }
  requestAnimationFrame(frame);
}

// Dev-only hook for automated play-tests (stripped from production builds).
if (import.meta.env.DEV) {
  (window as any).__kanjo = { get match() { return match; }, get busy() { return busy; }, hawkerMoves: () => hawkerMoves(match), askariOptions: (id: string) => askariOptions(match, id) };
}

fillStaticText();
openMenu();
requestAnimationFrame(frame);
