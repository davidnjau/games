// ─────────────────────────────────────────────────────────────
// main.ts — the conductor: menu, turns, AI pacing, input, HUD.
//
// Turn flow (one round):
//   HAWKER_TURN    → hawker moves in secret (human taps, or AI thinks)
//                    reveal round? radar + whistle, belief collapses
//   KANJO_TURN     → each askari moves or holds (human, or AI one by one)
//                    landing on the hawker → BAIL_DECISION
//   BAIL_DECISION  → hawker (if human, and able to afford it) pays bail or
//                    gives up; otherwise auto-declines straight to GAME_OVER
//   endKanjoTurn   → next round, or TIME_UP / CORNERED
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
  bailCost,
  coinsForEscape,
  createMatch,
  declineBail,
  endKanjoTurn,
  hawkerMoves,
  holdAskari,
  isRevealRound,
  payBail,
  publicView,
  roundsUntilReveal,
} from './game/rules';
import {
  RULES,
  type Askari,
  type Difficulty,
  type MatchState,
  type NodeId,
  type PublicState,
  type Side,
} from './game/types';
import { OnlineClient, type SeatRole, type ServerMessage, type WalletSnapshot } from './net';
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
  modeChipText: $('mode-chip-text'),
  sectorTag: $('sector-tag'),
  sectorPlace: $('sector-place'),
  sectorStatus: $('sector-status'),
  coords: $('coords'),
  mapLegend: $('map-legend'),
  layers: $<HTMLButtonElement>('layers'),
  fullscreen: $<HTMLButtonElement>('fullscreen'),
  opPanelLabel: $('op-panel-label'),
  toggleHawker: $('toggle-hawker'),
  toggleKanjo: $('toggle-kanjo'),
  diffChip: $('diff-chip'),
  diffEasy: $<HTMLButtonElement>('diff-easy'),
  diffNormal: $<HTMLButtonElement>('diff-normal'),
  diffHard: $<HTMLButtonElement>('diff-hard'),
  missionLabel: $('mission-label'),
  missionTitle: $('mission-title'),
  missionDesc: $('mission-desc'),
  progressTitle: $('progress-title'),
  status: $('status'),
  round: $('round'),
  reveal: $('reveal'),
  trail: $('trail'),
  squadTitle: $('squad-title'),
  squadCount: $('squad-count'),
  squad: $('squad'),
  squadActions: $('squad-actions'),
  hold: $<HTMLButtonElement>('hold'),
  endTurn: $<HTMLButtonElement>('end-turn'),
  intel: $<HTMLInputElement>('intel'),
  movesTitle: $('moves-title'),
  movesCount: $('moves-count'),
  moves: $('moves'),
  flavor: $('flavor'),
  place: $('place'),
  toast: $('toast'),
  end: $('end'),
  endIcon: $<HTMLImageElement>('end-icon'),
  endTitle: $('end-title'),
  endSub: $('end-sub'),
  rematch: $<HTMLButtonElement>('rematch'),
  endMenu: $<HTMLButtonElement>('end-menu'),
  coinChip: $('coin-chip'),
  buyCard: $<HTMLButtonElement>('buy-card'),
  bail: $('bail'),
  bailIcon: $<HTMLImageElement>('bail-icon'),
  bailTitle: $('bail-title'),
  bailSub: $('bail-sub'),
  bailPay: $<HTMLButtonElement>('bail-pay'),
  bailCard: $<HTMLButtonElement>('bail-card'),
  bailGiveup: $<HTMLButtonElement>('bail-giveup'),
  lobby: $('lobby'),
  lobbyDiffRow: $('lobby-diff-row'),
  lobbyDiffEasy: $<HTMLButtonElement>('lobby-diff-easy'),
  lobbyDiffNormal: $<HTMLButtonElement>('lobby-diff-normal'),
  lobbyDiffHard: $<HTMLButtonElement>('lobby-diff-hard'),
  lobbyReady: $<HTMLButtonElement>('lobby-ready'),
  lobbyHint: $('lobby-hint'),
  roleHawker: $<HTMLButtonElement>('role-hawker'),
  roleAskari1: $<HTMLButtonElement>('role-askari-1'),
  roleAskari2: $<HTMLButtonElement>('role-askari-2'),
  roleAskari3: $<HTMLButtonElement>('role-askari-3'),
};

// ── State ────────────────────────────────────────────────────

const DIFFICULTIES: Difficulty[] = ['EASY', 'NORMAL', 'HARD'];

interface Wallet {
  coins: number;
  hasJailFreeCard: boolean;
}

let human: Side = 'HAWKER';
let difficulty: Difficulty = 'NORMAL';
let match: MatchState = createMatch();
let selected: string | null = null;
let hover: NodeId | null = null;
let busy = false; // true while the AI acts or a reveal plays — input is ignored
let gameToken = 0; // bumps on every new game so stale AI timers stop
let toastTimer = 0;
let wallet: Wallet = { coins: 0, hasJailFreeCard: false };

// Online multiplayer (?online in the URL, same pattern as matatu-rush). The
// relay is authoritative: in online mode main.ts only sends intent via
// onlineClient and waits for the `state` echo — see net.ts and server/relay.ts.
const params = new URLSearchParams(location.search);
const ONLINE = params.has('online');
const SAME_ORIGIN_WS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/kanjo-escape`;
const SERVER_URL = params.get('online') || SAME_ORIGIN_WS;
const ROLES: SeatRole[] = ['HAWKER', 'ASKARI_1', 'ASKARI_2', 'ASKARI_3'];
const ROLE_UNIT_ID: Partial<Record<SeatRole, string>> = {
  ASKARI_1: 'askari_1',
  ASKARI_2: 'askari_2',
  ASKARI_3: 'askari_3',
};

let onlineClient: OnlineClient | null = null;
let myRole: SeatRole | null = null;
let myUnitId: string | null = null; // my askari id online; stays null locally or when I'm the hawker
let lobbySeats: Record<SeatRole, { taken: boolean; ready: boolean }> = Object.fromEntries(
  ROLES.map((r) => [r, { taken: false, ready: false }]),
) as Record<SeatRole, { taken: boolean; ready: boolean }>;

/** Online-only restriction: can I select/move this unit? Locally every unit is mine. */
const isMyAskariUnit = (id: string) => !ONLINE || myUnitId === id;

const renderer = new Renderer(canvas, icons);
const sound = new Sound();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

try {
  sound.muted = localStorage.getItem('kanjo-escape:muted') === '1';
} catch {
  /* storage unavailable */
}

try {
  const saved = localStorage.getItem('kanjo-escape:difficulty');
  if (DIFFICULTIES.includes(saved as Difficulty)) difficulty = saved as Difficulty;
} catch {
  /* storage unavailable */
}

try {
  const raw = localStorage.getItem('kanjo-escape:wallet');
  const parsed = raw ? JSON.parse(raw) : null;
  if (typeof parsed?.coins === 'number') wallet.coins = parsed.coins;
  if (typeof parsed?.hasJailFreeCard === 'boolean') wallet.hasJailFreeCard = parsed.hasJailFreeCard;
} catch {
  /* storage unavailable or corrupt */
}

function saveWallet(): void {
  try {
    localStorage.setItem('kanjo-escape:wallet', JSON.stringify(wallet));
  } catch {
    /* ignore */
  }
}

function renderWalletChip(): void {
  ui.coinChip.textContent = S.coins(wallet.coins);
  ui.buyCard.textContent = wallet.hasJailFreeCard ? S.cardOwned : S.buyCard(RULES.jailFreeCardCost);
  ui.buyCard.disabled = wallet.hasJailFreeCard || wallet.coins < RULES.jailFreeCardCost;
}

// ── Online lobby ─────────────────────────────────────────────
//
// The server is authoritative here: every mutation below (pickRole,
// hawkerMove, askariMove, bailDecision...) sends intent and waits for the
// `state`/`lobby` echo instead of calling rules.ts locally.

function connectOnline(): void {
  onlineClient = new OnlineClient(SERVER_URL, handleServerMessage);
  showLobbyScreen();
}

function showLobbyScreen(): void {
  ui.game.hidden = true;
  ui.end.hidden = true;
  ui.bail.hidden = true;
  ui.menu.hidden = true;
  ui.lobby.hidden = false;
  ui.toMenu.hidden = true;
  ui.sideChip.hidden = true;
  ui.diffChip.hidden = true;
  renderLobby();
}

function renderLobby(): void {
  const roleButtons: Record<SeatRole, HTMLButtonElement> = {
    HAWKER: ui.roleHawker,
    ASKARI_1: ui.roleAskari1,
    ASKARI_2: ui.roleAskari2,
    ASKARI_3: ui.roleAskari3,
  };
  for (const role of ROLES) {
    const btn = roleButtons[role];
    const seat = lobbySeats[role];
    const mine = myRole === role;
    btn.querySelector('.role-name')!.textContent = S.roleName(role);
    btn.querySelector('.role-state')!.textContent = mine
      ? seat.ready
        ? S.youReady
        : S.youPicked
      : seat.taken
        ? seat.ready
          ? S.seatReady
          : S.seatTaken
        : S.seatOpen;
    btn.className = `role-card${mine ? ' mine' : ''}${seat.taken && !mine ? ' taken' : ''}`;
    btn.disabled = seat.taken && !mine;
  }
  const diffButtons: Record<Difficulty, HTMLButtonElement> = {
    EASY: ui.lobbyDiffEasy,
    NORMAL: ui.lobbyDiffNormal,
    HARD: ui.lobbyDiffHard,
  };
  for (const d of DIFFICULTIES) {
    diffButtons[d].textContent = S.difficulty(d);
    diffButtons[d].className = `diff-opt${d === difficulty ? ' active' : ''}`;
  }
  ui.lobbyDiffRow.hidden = myRole !== 'HAWKER';
  ui.lobbyReady.disabled = !myRole;
  ui.lobbyReady.textContent = S.lobbyReady;
}

function fillLobbyStaticText(): void {
  $('lobby-tagline').textContent = S.lobbyTagline;
  $('lobby-diff-label').textContent = S.difficultyLabel;
  ui.lobbyHint.textContent = S.lobbyHint;
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'assigned':
      myRole = msg.role;
      myUnitId = myRole ? (ROLE_UNIT_ID[myRole] ?? null) : null;
      renderLobby();
      break;
    case 'lobby':
      lobbySeats = msg.seats;
      difficulty = msg.difficulty;
      if (!ui.game.hidden) {
        toast(S.opponentLeft, true);
        showLobbyScreen();
      } else {
        renderLobby();
      }
      break;
    case 'state':
      onOnlineState(msg.match, msg.wallet);
      break;
    case 'error':
      toast(msg.message);
      break;
  }
}

/**
 * Adapts a Kanjo-seat's PublicState into the MatchState shape the rest of
 * this file expects, so none of the existing rendering/HUD code needs a
 * second code path. The placeholder secret fields are never read: renderer.ts's
 * `showHawker` flag (false whenever `human !== 'HAWKER'`) is the only gate
 * between a piece's real position and the screen, and it's unaffected by this.
 */
function asLocalMatch(state: MatchState | PublicState): MatchState {
  if ('hawkerNode' in state) return state;
  return { ...state, hawkerNode: '', trafficDelay: false, pendingCapture: null, bailsUsed: 0 };
}

function enterOnlineGame(): void {
  human = myRole === 'HAWKER' ? 'HAWKER' : 'KANJO';
  selected = null;
  gameToken++;
  ui.lobby.hidden = true;
  ui.menu.hidden = true;
  ui.end.hidden = true;
  ui.game.hidden = false;
  ui.toMenu.hidden = false;
  ui.diffChip.hidden = false;
  ui.sideChip.hidden = false;
  ui.sideChip.className = `side-chip ${human === 'HAWKER' ? 'hawker' : 'kanjo'}`;
  ui.sideChip.textContent = myRole ? S.roleName(myRole) : '';
  ui.intel.checked = true;
  ui.layers.className = 'tool-btn active';
  ui.toggleHawker.className = `side-toggle-opt${human === 'HAWKER' ? ' active' : ''}`;
  ui.toggleKanjo.className = `side-toggle-opt kanjo${human === 'KANJO' ? ' active' : ''}`;
  ui.missionTitle.textContent = S.missionTitle(human);
  ui.missionDesc.textContent = S.missionDesc(human);
  ui.squadTitle.textContent = human === 'HAWKER' ? S.onYourTail : S.yourSquad;
  ui.endTurn.hidden = true; // no single "end turn" online — other seats act independently
}

function onOnlineState(incoming: MatchState | PublicState, walletSnapshot?: WalletSnapshot): void {
  const enteringGame = ui.game.hidden;
  if (enteringGame) enterOnlineGame();

  const prevPhase = match.phase;
  const prevTrailLen = match.trail.length;
  const coinsBefore = wallet.coins;
  match = asLocalMatch(incoming);

  if (walletSnapshot) {
    wallet = { ...walletSnapshot };
    saveWallet();
    renderWalletChip();
  }

  if (!enteringGame && match.trail.length > prevTrailLen) {
    sound.step();
    const last = match.trail.at(-1)!;
    if (last.revealedAt) {
      renderer.reveal(last.revealedAt, performance.now());
      sound.whistle();
      toast(S.waleWale);
    } else if (last.trafficked) {
      sound.traffic();
      toast(S.traffic, true);
    } else if (human === 'KANJO') {
      toast(S.hawkerMovedVia(last.via), true);
    }
  }

  if (match.phase === 'BAIL_DECISION') {
    busy = myRole !== 'HAWKER';
    if (prevPhase !== 'BAIL_DECISION' && myRole === 'HAWKER') showBailPrompt(bailCost(match));
  } else {
    ui.bail.hidden = true;
    busy = match.phase === 'GAME_OVER';
    if (prevPhase === 'BAIL_DECISION' && match.phase !== 'GAME_OVER') {
      // Bail was paid (declining instead leads straight to GAME_OVER, handled below).
      sound.bail();
      toast(S.bailed, true);
    }
  }

  if (prevPhase !== 'GAME_OVER' && match.phase === 'GAME_OVER') {
    const earned = walletSnapshot ? Math.max(0, walletSnapshot.coins - coinsBefore) : 0;
    populateEndOverlay(match.outcome!, earned);
  }

  if (match.phase !== 'KANJO_TURN' || !selected || !match.askaris.some((a) => a.id === selected && !a.moved)) {
    selected = myUnitId && match.askaris.some((a) => a.id === myUnitId && !a.moved) ? myUnitId : null;
  }

  renderHud();
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const unitName = (a: Askari) => (a.id === 'askari_2' ? S.foot : `${S.truck} ${a.id === 'askari_1' ? 1 : 2}`);

// ── Game flow ────────────────────────────────────────────────

function setDifficulty(d: Difficulty): void {
  difficulty = d;
  try {
    localStorage.setItem('kanjo-escape:difficulty', d);
  } catch {
    /* ignore */
  }
  renderDifficultyPicker();
}

function renderDifficultyPicker(): void {
  const buttons: Record<Difficulty, HTMLButtonElement> = {
    EASY: ui.diffEasy,
    NORMAL: ui.diffNormal,
    HARD: ui.diffHard,
  };
  for (const d of DIFFICULTIES) {
    buttons[d].textContent = S.difficulty(d);
    buttons[d].className = `diff-opt${d === difficulty ? ' active' : ''}`;
  }
  ui.diffChip.textContent = S.difficulty(difficulty);
}

function startGame(side: Side): void {
  sound.unlock();
  human = side;
  match = createMatch(Math.random, difficulty);
  selected = null;
  busy = false;
  gameToken++;
  ui.menu.hidden = true;
  ui.game.hidden = false;
  ui.end.hidden = true;
  ui.toMenu.hidden = false;
  ui.diffChip.hidden = false;
  ui.sideChip.hidden = false;
  ui.sideChip.className = `side-chip ${side === 'HAWKER' ? 'hawker' : 'kanjo'}`;
  ui.sideChip.textContent = side === 'HAWKER' ? 'Hawker' : 'Kanjo';
  ui.intel.checked = true;
  ui.layers.className = 'tool-btn active';
  ui.toggleHawker.className = `side-toggle-opt${side === 'HAWKER' ? ' active' : ''}`;
  ui.toggleKanjo.className = `side-toggle-opt kanjo${side === 'KANJO' ? ' active' : ''}`;
  ui.missionTitle.textContent = S.missionTitle(side);
  ui.missionDesc.textContent = S.missionDesc(side);
  ui.squadTitle.textContent = side === 'HAWKER' ? S.onYourTail : S.yourSquad;
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
  ui.diffChip.hidden = true;
  ui.bail.hidden = true;
  renderWalletChip();
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
  } else if (last.trafficked) {
    await wait(150);
    if (token !== gameToken) return false;
    sound.traffic();
    toast(S.traffic, true);
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
  if (ONLINE) {
    onlineClient!.hawkerMove(to); // server echoes the new state; see onOnlineState
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
      if (match.phase === 'BAIL_DECISION') return handleCapture(token);
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
  if (match.phase !== 'BAIL_DECISION' && match.phase !== 'GAME_OVER') {
    setTimeout(() => {
      renderer.pulse(to, performance.now());
      if (human === 'KANJO') sound.miss();
    }, opt.path.length * 230);
  }
  renderHud();
}

/** A catch just happened: resolve it immediately if the hawker can't bail, else ask. */
async function handleCapture(token: number): Promise<void> {
  const cost = bailCost(match);
  const canBail = human === 'HAWKER' && (wallet.coins >= cost || wallet.hasJailFreeCard);
  if (!canBail) {
    match = declineBail(match);
    void finish(token);
    return;
  }
  busy = true;
  renderHud();
  while (renderer.isAnimating(performance.now())) await wait(60);
  if (token !== gameToken) return;
  showBailPrompt(cost);
}

function showBailPrompt(cost: number): void {
  busy = true;
  const place = match.pendingCapture ? NODES[match.pendingCapture.node].label : '';
  ui.bailIcon.src = ICON_URL.truck;
  ui.bailTitle.textContent = S.bailPrompt;
  ui.bailSub.textContent = S.bailSub(place);
  ui.bailPay.textContent = S.payBail(cost);
  ui.bailPay.disabled = wallet.coins < cost;
  ui.bailCard.hidden = !wallet.hasJailFreeCard;
  ui.bailCard.textContent = S.useCard;
  ui.bailGiveup.textContent = S.giveUp;
  ui.bail.hidden = false;
  renderHud();
}

function resolveBail(choice: 'pay' | 'card' | 'decline'): void {
  if (match.phase !== 'BAIL_DECISION') return;
  ui.bail.hidden = true;
  if (ONLINE) {
    // The relay owns the wallet online — it validates, deducts, and echoes
    // the new balance via the next `state` message's `wallet` field.
    onlineClient!.bailDecision(choice);
    return;
  }
  const token = gameToken;
  if (choice === 'decline') {
    match = declineBail(match);
    void finish(token);
    return;
  }
  if (choice === 'pay') wallet.coins -= bailCost(match);
  else wallet.hasJailFreeCard = false;
  saveWallet();
  renderWalletChip();
  sound.bail();
  toast(S.bailed, true);
  match = payBail(match);
  afterRoundEnds(token);
}

/**
 * What happens once a squad turn is over — called after `endKanjoTurn` AND
 * after a successful bail (`payBail` ends in the exact same three shapes:
 * TIME_UP, a traffic bonus round, or a normal handoff to the hawker).
 */
function afterRoundEnds(token: number): void {
  selected = null;
  if (match.phase === 'GAME_OVER') {
    void finish(token);
    return;
  }
  if (match.phase === 'KANJO_TURN') {
    // Traffic held the hawker back: the squad gets a bonus round before the hawker moves again.
    if (human === 'KANJO') {
      busy = false;
      selected = firstReadyUnit();
      renderHud();
    } else {
      void kanjoAiTurn(token);
    }
    return;
  }
  busy = false;
  renderHud();
  if (human === 'KANJO') void hawkerAiTurn();
}

function endRound(token: number): void {
  match = endKanjoTurn(match);
  afterRoundEnds(token);
}

/** Populates and shows the end-of-match overlay. Shared by local play (via `finish`) and online play (via `onOnlineState`), which differ only in how `coinsJustEarned` gets computed. */
function populateEndOverlay(o: NonNullable<MatchState['outcome']>, coinsJustEarned: number): void {
  const place = NODES[o.node].label;
  const text = outcomeText(human, o.winner, o.reason, o.reason === 'ESCAPED' ? NODES[o.node].label : place);
  ui.endIcon.src = o.winner === 'HAWKER' ? ICON_URL.hawker : ICON_URL.truck;
  ui.endTitle.textContent = text.title;
  ui.endTitle.className = `end-title ${text.won ? 'won' : 'lost'}`;
  ui.endSub.textContent = coinsJustEarned > 0 ? `${text.sub} ${S.coinsEarned(coinsJustEarned)}` : text.sub;
  ui.rematch.textContent = S.rematch;
  ui.endMenu.textContent = S.menu;
  ui.end.hidden = false;
  ui.rematch.focus();
  if (o.winner === 'HAWKER') sound.escape();
  else sound.caught();
}

async function finish(token: number): Promise<void> {
  busy = true;
  renderHud();
  while (renderer.isAnimating(performance.now())) await wait(60);
  await wait(350);
  if (token !== gameToken) return;
  const o = match.outcome!;
  let earned = 0;
  if (o.reason === 'ESCAPED' && human === 'HAWKER') {
    earned = coinsForEscape(match.round, match.rules);
    wallet.coins += earned;
    saveWallet();
    renderWalletChip();
  }
  populateEndOverlay(o, earned);
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
  if (ONLINE) {
    onlineClient!.askariMove(to); // server echoes the new state; see onOnlineState
    return;
  }
  moveAskari(selected, to);
  if (match.phase === 'BAIL_DECISION') {
    void handleCapture(gameToken);
    return;
  }
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
  if (ONLINE) {
    onlineClient!.holdAskari();
    return;
  }
  match = holdAskari(match, selected);
  selected = firstReadyUnit();
  renderHud();
  if (!selected) endRound(gameToken);
}

function endTurnNow(): void {
  if (ONLINE || !humanKanjoActive()) return; // no single "end turn" online — see enterOnlineGame
  sound.click();
  endRound(gameToken);
}

// ── Shared destination handling (canvas tap or sidebar move pill) ─────

function chooseNode(node: NodeId): void {
  if (busy || match.phase === 'GAME_OVER') return;
  sound.unlock();
  hover = node;
  renderPlace();

  if (human === 'HAWKER' && match.phase === 'HAWKER_TURN') {
    if (node !== match.hawkerNode) void humanHawkerMove(node);
    return;
  }
  if (humanKanjoActive()) {
    const unitHere = match.askaris.find((a) => a.node === node);
    if (unitHere && !unitHere.moved && isMyAskariUnit(unitHere.id)) {
      selected = unitHere.id;
      sound.click();
      renderHud();
      return;
    }
    if (unitHere) return; // moved already, or (online) someone else's unit
    humanAskariMove(node);
  }
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
  const p = toBoard(e);
  const node = nodeAt(p.x, p.y);
  if (node) chooseNode(node);
});

window.addEventListener('keydown', (e) => {
  if (!humanKanjoActive() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['1', '2', '3'].includes(e.key)) {
    const a = match.askaris[Number(e.key) - 1];
    if (a && !a.moved && isMyAskariUnit(a.id)) {
      selected = a.id;
      renderHud();
    }
  } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
    endTurnNow();
  } else if (e.key.toLowerCase() === 'h') {
    holdSelected();
  }
});

ui.diffEasy.addEventListener('click', () => {
  sound.click();
  setDifficulty('EASY');
});
ui.diffNormal.addEventListener('click', () => {
  sound.click();
  setDifficulty('NORMAL');
});
ui.diffHard.addEventListener('click', () => {
  sound.click();
  setDifficulty('HARD');
});
ui.buyCard.addEventListener('click', () => {
  if (wallet.hasJailFreeCard || wallet.coins < RULES.jailFreeCardCost) return;
  wallet.coins -= RULES.jailFreeCardCost;
  wallet.hasJailFreeCard = true;
  saveWallet();
  renderWalletChip();
  sound.click();
});
ui.bailPay.addEventListener('click', () => resolveBail('pay'));
ui.bailCard.addEventListener('click', () => resolveBail('card'));
ui.bailGiveup.addEventListener('click', () => resolveBail('decline'));
$('pick-hawker').addEventListener('click', () => startGame('HAWKER'));
$('pick-kanjo').addEventListener('click', () => startGame('KANJO'));
ui.toMenu.addEventListener('click', () => (ONLINE ? location.reload() : openMenu()));
ui.endMenu.addEventListener('click', () => (ONLINE ? location.reload() : openMenu()));
ui.rematch.addEventListener('click', () => {
  if (ONLINE) {
    onlineClient!.rematch();
    return;
  }
  startGame(human);
});
ui.hold.addEventListener('click', holdSelected);
ui.endTurn.addEventListener('click', endTurnNow);

const ROLE_BUTTONS: Record<SeatRole, HTMLButtonElement> = {
  HAWKER: ui.roleHawker,
  ASKARI_1: ui.roleAskari1,
  ASKARI_2: ui.roleAskari2,
  ASKARI_3: ui.roleAskari3,
};
for (const role of ROLES) {
  // The button is already `disabled` in renderLobby() for seats someone else holds.
  ROLE_BUTTONS[role].addEventListener('click', () => {
    if (!onlineClient) return;
    sound.click();
    onlineClient.pickRole(role);
  });
}
ui.lobbyDiffEasy.addEventListener('click', () => {
  sound.click();
  onlineClient?.setDifficulty('EASY');
});
ui.lobbyDiffNormal.addEventListener('click', () => {
  sound.click();
  onlineClient?.setDifficulty('NORMAL');
});
ui.lobbyDiffHard.addEventListener('click', () => {
  sound.click();
  onlineClient?.setDifficulty('HARD');
});
ui.lobbyReady.addEventListener('click', () => {
  sound.click();
  if (myRole === 'HAWKER') onlineClient?.sendWallet(wallet.coins, wallet.hasJailFreeCard);
  onlineClient?.ready();
});
ui.intel.addEventListener('change', () => {
  sound.click();
  ui.layers.className = `tool-btn${ui.intel.checked ? ' active' : ''}`;
});
ui.layers.addEventListener('click', () => {
  ui.intel.checked = !ui.intel.checked;
  ui.intel.dispatchEvent(new Event('change'));
});
ui.fullscreen.addEventListener('click', () => {
  sound.click();
  if (document.fullscreenElement) void document.exitFullscreen();
  else void canvas.closest('.board-wrap')!.requestFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  ui.fullscreen.className = `tool-btn${document.fullscreenElement ? ' active' : ''}`;
});
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
  } else if (match.phase === 'BAIL_DECISION') {
    text = S.bailPrompt;
    tone = 'alert';
  } else if (match.phase === 'HAWKER_TURN') {
    if (human === 'HAWKER') {
      const revealing = isRevealRound(match.round, match.rules.revealEvery);
      text = revealing ? S.hawkerTurnReveal : S.hawkerTurn;
      tone = revealing ? 'alert' : 'hawker';
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
  ui.flavor.textContent = text || ' ';

  // Sector line
  const over = match.phase === 'GAME_OVER';
  ui.sectorStatus.textContent = over ? S.operationClosed : S.liveOperation;
  ui.sectorStatus.className = `sector-status${over ? ' over' : ''}`;

  // Clock
  ui.round.textContent = S.round(match.round, match.rules.maxRounds);
  // During the hawker's turn, a reveal "this round" happens right after they move.
  // Once they've moved, count from the next round instead.
  const next =
    match.phase === 'HAWKER_TURN'
      ? roundsUntilReveal(match.round, match.rules.revealEvery)
      : roundsUntilReveal(match.round + 1, match.rules.revealEvery) + 1;
  ui.reveal.textContent = match.phase === 'GAME_OVER' ? '' : S.nextReveal(next);

  // Trail log
  ui.trail.innerHTML = '';
  for (let r = 1; r <= match.rules.maxRounds; r++) {
    const li = document.createElement('li');
    const entry = match.trail.find((t) => t.round === r);
    const classes: string[] = [];
    if (isRevealRound(r, match.rules.revealEvery)) classes.push('reveal-round');
    if (r === match.round && match.phase !== 'GAME_OVER') classes.push('current');
    let v = '';
    if (entry) {
      classes.push(entry.revealedAt ? 'seen' : entry.via === 'ALLEY' ? 'alley' : 'road');
      if (entry.trafficked) classes.push('traffic');
      v = entry.via === 'ALLEY' ? 'ALLEY' : 'BAR.';
      li.title = entry.revealedAt ? NODES[entry.revealedAt].label : entry.trafficked ? `${v} · ${S.traffic}` : v;
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
    b.disabled = !(humanKanjoActive() && !a.moved && isMyAskariUnit(a.id));
    const range =
      a.kind === 'TRUCK'
        ? `${match.rules.truckRange} hatua · barabara`
        : `${match.rules.footRange} hatua · alleys sawa`;
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
  ui.squadCount.textContent = S.unitsCount(match.askaris.length);
  ui.squadActions.hidden = human !== 'KANJO';
  ui.hold.textContent = S.hold;
  ui.endTurn.textContent = S.endTurn;
  ui.hold.disabled = !(humanKanjoActive() && selected);
  ui.endTurn.disabled = !humanKanjoActive();
  ui.sound.textContent = S.sound(!sound.muted);

  // Available moves
  const targets = currentTargets();
  ui.movesCount.textContent = S.optionsCount(targets.length);
  ui.moves.innerHTML = '';
  if (targets.length === 0) {
    const p = document.createElement('p');
    p.className = 'moves-empty';
    p.textContent =
      match.phase === 'GAME_OVER'
        ? S.gameOverMoves
        : match.phase === 'BAIL_DECISION'
          ? S.bailPrompt
          : humanKanjoActive()
            ? S.noMovesYet
            : S.aiTurnMoves;
    ui.moves.appendChild(p);
  } else {
    targets.forEach((id, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'move-pill';
      b.innerHTML = `<span class="pin">${i + 1}</span> ${NODES[id].label}`;
      b.addEventListener('click', () => chooseNode(id));
      ui.moves.appendChild(b);
    });
  }

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
  $('diff-label').textContent = S.difficultyLabel;
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
  $('intel-label').textContent = S.intel;
  $('intel-hint').textContent = S.intelHint;
  ui.toMenu.textContent = S.menu;
  ui.sound.textContent = S.sound(!sound.muted);

  $('brand-sub').textContent = S.brandSub;
  ui.modeChipText.textContent = ONLINE ? S.modeChipOnline : S.modeChip;
  ui.sectorTag.textContent = S.sectorTag;
  $('sector-place').textContent = S.sectorLine;
  ui.coords.textContent = S.coords;
  ui.mapLegend.innerHTML = `
    <span><i class="lg road"></i>${S.legendRoad}</span>
    <span><i class="lg alley"></i>${S.legendAlley}</span>
    <span><i class="lg stage"></i>${S.legendStage}</span>
    <span><i class="lg possible"></i>${S.legendPossible}</span>`;
  ui.layers.title = S.layers;
  ui.fullscreen.title = S.fullscreen;
  ui.opPanelLabel.textContent = S.opPanelLabel;
  ui.toggleHawker.textContent = S.sideHawker;
  ui.toggleKanjo.textContent = S.sideKanjo;
  ui.missionLabel.textContent = S.missionLabel;
  ui.progressTitle.textContent = S.operationProgress;
  ui.movesTitle.textContent = S.availableMoves;
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
renderDifficultyPicker();
renderWalletChip();
if (ONLINE) {
  fillLobbyStaticText();
  connectOnline();
} else {
  openMenu();
}
requestAnimationFrame(frame);
