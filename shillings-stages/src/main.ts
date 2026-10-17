import { Sound } from './audio';
import {
  buildKiosk,
  buyProperty,
  createGame,
  declineBuyProperty,
  endTurn,
  mortgageProperty,
  payJailFine,
  proposeTrade,
  respondTrade,
  resolveTaxAudit,
  rollDice,
  sellKiosk,
  unmortgageProperty,
  useJailFreeCard,
} from './game/rules';
import type { EventCode, GameEvent, GameState, PlayerId, TradeOffer } from './game/types';
import { OnlineClient, type ServerMessage } from './net';
import { Renderer, type OnlineLobbyHandlers, type OnlineLobbySeat, type RenderHandlers, type SetupHandlers, type TradeDraft } from './renderer';
import './style.css';

const MUTED_KEY = 'shillings-stages:muted';

const sound = new Sound();
function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}
function saveMuted(): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

let muted = loadMuted();
sound.muted = muted;

const renderer = new Renderer();

// ── Online play ──────────────────────────────────────────────
// `?online` swaps the local hot-seat loop for a relay server
// (server/relay.ts): every action goes out as intent, dice are rolled
// server-side, and the only state rendered is whatever the server
// echoes back. Same-origin by default (works under the root unified
// server or this game's own standalone server); pass
// `?online=ws://localhost:8080/ws/shillings-stages` to point a local
// dev client (Vite on 5173) at a relay running elsewhere.
const params = new URLSearchParams(location.search);
const ONLINE = params.has('online');
const SAME_ORIGIN_WS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/shillings-stages`;
const SERVER_URL = params.get('online') || SAME_ORIGIN_WS;

let onlineClient: OnlineClient | null = null;
let mySeatId: PlayerId | null = null;
let myPlayerId: PlayerId | null = null;
let onlineSeats: OnlineLobbySeat[] = [];

let selectedPlayerCount = 2;
let state: GameState = createGame(2, Math.random);
let tradeDraft: TradeDraft | null = null;

const SOUND_FOR_CODE: Partial<Record<EventCode, keyof Sound>> = {
  ROLLED: 'roll',
  ROLLED_DOUBLES: 'roll',
  PASSED_GO: 'cashGood',
  COLLECTED_RENT: 'cashGood',
  BOUGHT_PROPERTY: 'buy',
  BUILT_KIOSK: 'buy',
  BUILT_PLOT: 'buy',
  PAID_RENT: 'cashBad',
  PAID_TAX: 'cashBad',
  SOLD_BUILDING: 'cashBad',
  MORTGAGED: 'cashGood',
  UNMORTGAGED: 'cashBad',
  DREW_CHAMA: 'card',
  DREW_HARAMBEE: 'card',
  SENT_TO_JAIL: 'jail',
  STUCK_IN_JAIL: 'jail',
  LEFT_JAIL_FINE: 'freed',
  LEFT_JAIL_DOUBLES: 'freed',
  LEFT_JAIL_CARD: 'freed',
  FORCED_OUT_OF_JAIL: 'freed',
  TRADE_ACCEPTED: 'buy',
  BANKRUPT: 'bankrupt',
  GAME_OVER: 'win',
};

function playSoundsForEvents(events: GameEvent[]): void {
  for (const e of events) {
    const method = SOUND_FOR_CODE[e.code];
    if (method) (sound[method] as () => void)();
  }
}

function render(): void {
  renderer.render(state, handlers, tradeDraft, muted, ONLINE ? myPlayerId : null);
}

function commit(next: GameState): void {
  state = next;
  playSoundsForEvents(next.events);
  render();
}

function safely(action: () => GameState): void {
  try {
    commit(action());
  } catch (err) {
    console.error(err);
    render();
  }
}

const setupHandlers: SetupHandlers = {
  onSelectCount(n) {
    selectedPlayerCount = n;
    renderer.renderSetup(selectedPlayerCount, setupHandlers);
  },
  onStart() {
    sound.unlock();
    state = createGame(selectedPlayerCount, Math.random);
    renderer.showGame();
    render();
  },
};

function connectOnline(): void {
  onlineClient = new OnlineClient(SERVER_URL, handleServerMessage);
  renderer.renderOnlineLobby(mySeatId, onlineSeats, onlineLobbyHandlers);
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'assigned':
      mySeatId = msg.seatId;
      renderer.renderOnlineLobby(mySeatId, onlineSeats, onlineLobbyHandlers);
      break;
    case 'lobby':
      onlineSeats = msg.seats;
      myPlayerId = null;
      renderer.showLobby();
      renderer.renderOnlineLobby(mySeatId, onlineSeats, onlineLobbyHandlers);
      break;
    case 'youAre':
      myPlayerId = msg.playerId;
      break;
    case 'state':
      state = msg.match;
      playSoundsForEvents(state.events);
      renderer.showGame();
      render();
      break;
    case 'error':
      console.error(msg.message);
      break;
  }
}

const onlineLobbyHandlers: OnlineLobbyHandlers = {
  onToggleReady() {
    const myReady = onlineSeats.find((s) => s.id === mySeatId)?.ready ?? false;
    onlineClient!.setReady(!myReady);
  },
  onStartMatch() {
    sound.unlock();
    onlineClient!.startMatch();
  },
};

const handlers: RenderHandlers = {
  onRoll() {
    if (ONLINE) return onlineClient!.rollDice();
    safely(() => rollDice(state, Math.random));
  },
  onBuy() {
    if (ONLINE) return onlineClient!.buyProperty();
    safely(() => buyProperty(state));
  },
  onDecline() {
    if (ONLINE) return onlineClient!.declineBuyProperty();
    safely(() => declineBuyProperty(state));
  },
  onBuildKiosk(spaceId) {
    if (ONLINE) return onlineClient!.buildKiosk(spaceId);
    safely(() => buildKiosk(state, spaceId));
  },
  onSellKiosk(spaceId) {
    if (ONLINE) return onlineClient!.sellKiosk(spaceId);
    safely(() => sellKiosk(state, spaceId));
  },
  onMortgage(spaceId) {
    if (ONLINE) return onlineClient!.mortgageProperty(spaceId);
    safely(() => mortgageProperty(state, spaceId));
  },
  onUnmortgage(spaceId) {
    if (ONLINE) return onlineClient!.unmortgageProperty(spaceId);
    safely(() => unmortgageProperty(state, spaceId));
  },
  onPayJailFine() {
    if (ONLINE) return onlineClient!.payJailFine();
    safely(() => payJailFine(state));
  },
  onUseJailFreeCard(deck) {
    if (ONLINE) return onlineClient!.useJailFreeCard(deck);
    safely(() => useJailFreeCard(state, deck));
  },
  onResolveTax(choice) {
    if (ONLINE) return onlineClient!.resolveTaxAudit(choice);
    safely(() => resolveTaxAudit(state, choice));
  },
  onEndTurn() {
    if (ONLINE) return onlineClient!.endTurn();
    safely(() => endTurn(state));
  },
  onToggleSound() {
    muted = !muted;
    sound.muted = muted;
    saveMuted();
    render();
  },
  onOpenTrade() {
    const myId = ONLINE ? myPlayerId : state.currentTurn;
    const others = state.players.filter((p) => p.id !== myId && !p.bankrupt);
    if (!others.length || myId === null) return;
    tradeDraft = { to: others[0].id, offerProperty: null, offerCash: 0, requestProperty: null, requestCash: 0 };
    render();
  },
  onCancelTrade() {
    tradeDraft = null;
    render();
  },
  onChangeTradeDraft(patch) {
    if (!tradeDraft) return;
    tradeDraft = { ...tradeDraft, ...patch };
    render();
  },
  onSubmitTrade() {
    if (!tradeDraft) return;
    const from = ONLINE ? myPlayerId! : state.currentTurn;
    const offer: TradeOffer = {
      from,
      to: tradeDraft.to,
      offerCash: tradeDraft.offerCash,
      offerProperties: tradeDraft.offerProperty !== null ? [tradeDraft.offerProperty] : [],
      requestCash: tradeDraft.requestCash,
      requestProperties: tradeDraft.requestProperty !== null ? [tradeDraft.requestProperty] : [],
    };
    tradeDraft = null;
    if (ONLINE) return onlineClient!.proposeTrade(offer);
    safely(() => proposeTrade(state, offer));
  },
  onRespondTrade(accept) {
    if (ONLINE) return onlineClient!.respondTrade(accept);
    safely(() => respondTrade(state, accept));
  },
  onRestart() {
    if (ONLINE) return onlineClient!.rematch();
    renderer.renderSetup(selectedPlayerCount, setupHandlers);
    document.getElementById('setup')!.hidden = false;
    document.getElementById('game')!.hidden = true;
  },
};

if (ONLINE) connectOnline();
else renderer.renderSetup(selectedPlayerCount, setupHandlers);
