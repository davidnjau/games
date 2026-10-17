import { BOARD, groupSpaceIds, TRANSIT_SPACE_IDS, UTILITY_SPACE_IDS } from './board';
import { CHAMA_CARDS, HARAMBEE_CARDS, type CardEffect } from './cards';
import {
  BOARD_SIZE,
  RULES,
  type BuildLevel,
  type EventCode,
  type EventKind,
  type GameEvent,
  type GamePhase,
  type GameState,
  type Player,
  type PlayerId,
  type PropertyState,
  type Rng,
  type Space,
  type TradeOffer,
} from './types';

const TOKEN_COLORS = ['#ffc23c', '#e8453c', '#4caf6e', '#3ea0ff', '#b16fe0', '#ff8fd0', '#9fd8ff', '#8b5a2b'];

// ── Setup ─────────────────────────────────────────────────────────────────

export function createGame(playerCount: number, rng: Rng, names?: string[]): GameState {
  if (playerCount < 2 || playerCount > 8) throw new Error('Players must be between 2 and 8');
  const players: Player[] = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: i + 1,
      name: names?.[i] ?? `Player ${i + 1}`,
      color: TOKEN_COLORS[i % TOKEN_COLORS.length],
      cash: RULES.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      freePassCards: { chama: false, harambee: false },
      bankrupt: false,
    });
  }
  const properties: (PropertyState | null)[] = BOARD.map((space) =>
    space.type === 'PROPERTY' || space.type === 'TRANSIT' || space.type === 'UTILITY'
      ? { owner: null, level: 0, mortgaged: false }
      : null
  );
  return {
    players,
    properties,
    currentTurn: players[0].id,
    phase: 'AWAITING_ROLL',
    dice: null,
    doublesCount: 0,
    chamaDeck: shuffle(CHAMA_CARDS.map((_, i) => i), rng),
    chamaDiscard: [],
    harambeeDeck: shuffle(HARAMBEE_CARDS.map((_, i) => i), rng),
    harambeeDiscard: [],
    pendingTrade: null,
    winner: null,
    events: [],
    eventSeq: 0,
  };
}

// ── Public queries (pure, no state mutation) ──────────────────────────────

export function getPlayer(state: GameState, id: PlayerId): Player {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error(`No such player: ${id}`);
  return player;
}

export function rentFor(state: GameState, spaceId: number, diceTotal: number): number {
  const space = BOARD[spaceId];
  const ps = state.properties[spaceId];
  if (!ps || ps.owner === null) return 0;
  if (space.type === 'PROPERTY') {
    const rent = space.rent!;
    if (ps.level === 0) {
      const ownsFullGroup = groupSpaceIds(space.group!).every((id) => state.properties[id]?.owner === ps.owner);
      return ownsFullGroup ? rent.base * 2 : rent.base;
    }
    if (ps.level <= 4) return rent.kiosk[ps.level - 1];
    return rent.plot;
  }
  if (space.type === 'TRANSIT') {
    const ownedCount = TRANSIT_SPACE_IDS.filter((id) => state.properties[id]?.owner === ps.owner).length;
    return RULES.transitRent[ownedCount - 1];
  }
  if (space.type === 'UTILITY') {
    const ownsBoth = UTILITY_SPACE_IDS.every((id) => state.properties[id]?.owner === ps.owner);
    return diceTotal * (ownsBoth ? RULES.utilityMultiplier.both : RULES.utilityMultiplier.one);
  }
  return 0;
}

export function totalAssets(state: GameState, playerId: PlayerId): number {
  const player = getPlayer(state, playerId);
  let total = player.cash;
  for (const space of BOARD) {
    const ps = state.properties[space.id];
    if (ps && ps.owner === playerId) {
      total += space.price ?? 0;
      if (space.buildCost) total += ps.level * space.buildCost;
    }
  }
  return total;
}

export function buildingBankAvailable(state: GameState): { kiosksAvailable: number; plotsAvailable: number } {
  let kiosksUsed = 0;
  let plotsUsed = 0;
  for (const ps of state.properties) {
    if (!ps) continue;
    if (ps.level >= 1 && ps.level <= 4) kiosksUsed += ps.level;
    else if (ps.level === 5) plotsUsed += 1;
  }
  return {
    kiosksAvailable: RULES.buildingBankKiosks - kiosksUsed,
    plotsAvailable: RULES.buildingBankPlots - plotsUsed,
  };
}

export function canBuildOn(state: GameState, spaceId: number): boolean {
  const space = BOARD[spaceId];
  if (space.type !== 'PROPERTY') return false;
  const ps = state.properties[spaceId];
  if (!ps || ps.owner === null || ps.mortgaged || ps.level >= 5) return false;
  return groupSpaceIds(space.group!).every(
    (id) => state.properties[id]?.owner === ps.owner && !state.properties[id]?.mortgaged
  );
}

export function mortgageValue(space: Space): number {
  return (space.price ?? 0) * RULES.mortgageRate;
}

export function unmortgageCost(space: Space): number {
  return mortgageValue(space) * (1 + RULES.unmortgageInterestRate);
}

// ── Actions ───────────────────────────────────────────────────────────────

export function rollDice(state: GameState, rng: Rng): GameState {
  const player = getPlayer(state, state.currentTurn);
  const canRoll = state.phase === 'AWAITING_ROLL' || (state.phase === 'AWAITING_JAIL_CHOICE' && player.inJail);
  if (!canRoll) throw new Error('Not awaiting a roll');

  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const p = getPlayer(next, player.id);
  const d1 = rollDie(rng);
  const d2 = rollDie(rng);
  const isDouble = d1 === d2;
  next.dice = [d1, d2];

  if (p.inJail) {
    bus.push('INFO', 'ROLLED', { d1, d2 });
    if (isDouble) {
      p.inJail = false;
      p.jailTurns = 0;
      next.doublesCount = 0;
      bus.push('GOOD', 'LEFT_JAIL_DOUBLES', {});
      moveTo(next, p.id, (p.position + d1 + d2) % BOARD_SIZE, bus);
      resolveLanding(next, p.id, d1 + d2, bus, rng);
    } else {
      p.jailTurns += 1;
      if (p.jailTurns >= RULES.maxJailTurns) {
        chargePlayer(next, p.id, RULES.jailFine, 'bank', bus);
        if (!p.bankrupt) {
          p.inJail = false;
          p.jailTurns = 0;
          bus.push('BAD', 'FORCED_OUT_OF_JAIL', {});
          moveTo(next, p.id, (p.position + d1 + d2) % BOARD_SIZE, bus);
          resolveLanding(next, p.id, d1 + d2, bus, rng);
        } else {
          setPhase(next, 'AWAITING_END_TURN');
        }
      } else {
        bus.push('BAD', 'STUCK_IN_JAIL', { turns: p.jailTurns });
        setPhase(next, 'AWAITING_END_TURN');
      }
    }
  } else {
    bus.push('INFO', isDouble ? 'ROLLED_DOUBLES' : 'ROLLED', { d1, d2 });
    next.doublesCount = isDouble ? state.doublesCount + 1 : 0;
    if (next.doublesCount === 3) {
      sendToJail(next, p.id, bus);
      setPhase(next, 'AWAITING_END_TURN');
    } else {
      moveTo(next, p.id, (p.position + d1 + d2) % BOARD_SIZE, bus);
      resolveLanding(next, p.id, d1 + d2, bus, rng);
    }
  }

  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function buyProperty(state: GameState): GameState {
  if (state.phase !== 'AWAITING_PROPERTY_DECISION') throw new Error('No property decision pending');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const space = BOARD[player.position];
  if (!space.price) throw new Error('Space is not purchasable');
  if (player.cash < space.price) throw new Error('Not enough cash');
  player.cash -= space.price;
  next.properties[space.id] = { owner: player.id, level: 0, mortgaged: false };
  bus.push('GOOD', 'BOUGHT_PROPERTY', { name: space.name, price: space.price });
  setPhase(next, 'AWAITING_END_TURN');
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function declineBuyProperty(state: GameState): GameState {
  if (state.phase !== 'AWAITING_PROPERTY_DECISION') throw new Error('No property decision pending');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const space = BOARD[getPlayer(next, next.currentTurn).position];
  bus.push('INFO', 'DECLINED_PROPERTY', { name: space.name });
  setPhase(next, 'AWAITING_END_TURN');
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function resolveTaxAudit(state: GameState, choice: 'FLAT' | 'PERCENT'): GameState {
  if (state.phase !== 'AWAITING_TAX_CHOICE') throw new Error('No tax choice pending');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const space = BOARD[player.position];
  const flat = space.taxFlat!;
  const percentAmount = Math.round(totalAssets(next, player.id) * space.taxPercent!);
  const amount = choice === 'FLAT' ? flat : percentAmount;
  chargePlayer(next, player.id, amount, 'bank', bus);
  bus.push('BAD', 'PAID_TAX', { amount });
  setPhase(next, 'AWAITING_END_TURN');
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

function assertManageable(phase: GamePhase): void {
  if (phase !== 'AWAITING_ROLL' && phase !== 'AWAITING_END_TURN') {
    throw new Error('Cannot manage properties right now');
  }
}

export function buildKiosk(state: GameState, spaceId: number): GameState {
  assertManageable(state.phase);
  const space = BOARD[spaceId];
  if (space.type !== 'PROPERTY') throw new Error('Not a property');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const ps = next.properties[spaceId]!;
  if (ps.owner !== player.id) throw new Error('You do not own this property');
  if (ps.mortgaged) throw new Error('Property is mortgaged');
  if (ps.level >= 5) throw new Error('Already at maximum development');
  const ownsFullGroup = groupSpaceIds(space.group!).every(
    (id) => next.properties[id]?.owner === player.id && !next.properties[id]?.mortgaged
  );
  if (!ownsFullGroup) throw new Error('Must own the entire unmortgaged color group');
  const cost = space.buildCost!;
  if (player.cash < cost) throw new Error('Not enough cash');
  const buildingPlot = ps.level === 4;
  const { kiosksAvailable, plotsAvailable } = buildingBankAvailable(next);
  if ((buildingPlot && plotsAvailable < 1) || (!buildingPlot && kiosksAvailable < 1)) {
    bus.push('BAD', 'BUILDING_BANK_EMPTY', { name: space.name });
    next.events = bus.list;
    next.eventSeq = bus.seq;
    return next;
  }
  player.cash -= cost;
  ps.level = (ps.level + 1) as BuildLevel;
  bus.push('GOOD', ps.level === 5 ? 'BUILT_PLOT' : 'BUILT_KIOSK', { name: space.name, level: ps.level });
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function sellKiosk(state: GameState, spaceId: number): GameState {
  assertManageable(state.phase);
  const space = BOARD[spaceId];
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const ps = next.properties[spaceId]!;
  if (ps.owner !== player.id) throw new Error('You do not own this property');
  if (ps.level <= 0) throw new Error('No buildings to sell');
  const refund = space.buildCost! * 0.5;
  ps.level = (ps.level - 1) as BuildLevel;
  player.cash += refund;
  bus.push('INFO', 'SOLD_BUILDING', { name: space.name, level: ps.level });
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function mortgageProperty(state: GameState, spaceId: number): GameState {
  assertManageable(state.phase);
  const space = BOARD[spaceId];
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const ps = next.properties[spaceId]!;
  if (ps.owner !== player.id) throw new Error('You do not own this property');
  if (ps.level > 0) throw new Error('Sell buildings before mortgaging');
  if (ps.mortgaged) throw new Error('Already mortgaged');
  ps.mortgaged = true;
  const amount = mortgageValue(space);
  player.cash += amount;
  bus.push('INFO', 'MORTGAGED', { name: space.name, amount });
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function unmortgageProperty(state: GameState, spaceId: number): GameState {
  assertManageable(state.phase);
  const space = BOARD[spaceId];
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const ps = next.properties[spaceId]!;
  if (ps.owner !== player.id) throw new Error('You do not own this property');
  if (!ps.mortgaged) throw new Error('Not mortgaged');
  const cost = unmortgageCost(space);
  if (player.cash < cost) throw new Error('Not enough cash');
  player.cash -= cost;
  ps.mortgaged = false;
  bus.push('INFO', 'UNMORTGAGED', { name: space.name, amount: cost });
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function payJailFine(state: GameState): GameState {
  if (state.phase !== 'AWAITING_JAIL_CHOICE') throw new Error('Not in jail');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  chargePlayer(next, player.id, RULES.jailFine, 'bank', bus);
  if (!player.bankrupt) {
    player.inJail = false;
    player.jailTurns = 0;
    bus.push('GOOD', 'LEFT_JAIL_FINE', {});
    setPhase(next, 'AWAITING_ROLL');
  } else {
    setPhase(next, 'AWAITING_END_TURN');
  }
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function useJailFreeCard(state: GameState, deck: 'CHAMA' | 'HARAMBEE'): GameState {
  if (state.phase !== 'AWAITING_JAIL_CHOICE') throw new Error('Not in jail');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const has = deck === 'CHAMA' ? player.freePassCards.chama : player.freePassCards.harambee;
  if (!has) throw new Error('No free pass card held');
  if (deck === 'CHAMA') player.freePassCards.chama = false;
  else player.freePassCards.harambee = false;
  const cards = deck === 'CHAMA' ? CHAMA_CARDS : HARAMBEE_CARDS;
  const cardIndex = cards.findIndex((c) => c.effect.type === 'GET_OUT_OF_JAIL_FREE');
  if (deck === 'CHAMA') next.chamaDiscard.push(cardIndex);
  else next.harambeeDiscard.push(cardIndex);
  player.inJail = false;
  player.jailTurns = 0;
  bus.push('GOOD', 'LEFT_JAIL_CARD', {});
  setPhase(next, 'AWAITING_ROLL');
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function proposeTrade(state: GameState, offer: TradeOffer): GameState {
  if (state.phase !== 'AWAITING_END_TURN') throw new Error('Cannot propose a trade right now');
  if (offer.from !== state.currentTurn) throw new Error('Only the current player can propose a trade');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  for (const id of offer.offerProperties) {
    if (next.properties[id]?.owner !== offer.from) throw new Error('You do not own an offered property');
  }
  for (const id of offer.requestProperties) {
    if (next.properties[id]?.owner !== offer.to) throw new Error('Target does not own a requested property');
  }
  next.pendingTrade = {
    ...offer,
    offerProperties: [...offer.offerProperties],
    requestProperties: [...offer.requestProperties],
  };
  next.phase = 'TRADE_PENDING';
  bus.push('INFO', 'TRADE_PROPOSED', { to: getPlayer(next, offer.to).name });
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function respondTrade(state: GameState, accept: boolean): GameState {
  if (state.phase !== 'TRADE_PENDING' || !state.pendingTrade) throw new Error('No trade pending');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const trade = next.pendingTrade!;
  if (accept) {
    const fromP = getPlayer(next, trade.from);
    const toP = getPlayer(next, trade.to);
    if (fromP.cash < trade.offerCash || toP.cash < trade.requestCash) {
      bus.push('BAD', 'TRADE_DECLINED', {});
    } else {
      fromP.cash = fromP.cash - trade.offerCash + trade.requestCash;
      toP.cash = toP.cash - trade.requestCash + trade.offerCash;
      for (const id of trade.offerProperties) {
        const ps = next.properties[id];
        if (ps) ps.owner = trade.to;
      }
      for (const id of trade.requestProperties) {
        const ps = next.properties[id];
        if (ps) ps.owner = trade.from;
      }
      bus.push('GOOD', 'TRADE_ACCEPTED', {});
    }
  } else {
    bus.push('INFO', 'TRADE_DECLINED', {});
  }
  next.pendingTrade = null;
  setPhase(next, 'AWAITING_END_TURN');
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

export function endTurn(state: GameState): GameState {
  if (state.phase !== 'AWAITING_END_TURN') throw new Error('Not awaiting end of turn');
  const next = cloneState(state);
  const bus = createEventBus(state.eventSeq);
  const player = getPlayer(next, next.currentTurn);
  const rollsAgain = next.doublesCount > 0 && next.doublesCount < 3 && !player.bankrupt && !player.inJail;
  next.dice = null;
  if (rollsAgain) {
    setPhase(next, 'AWAITING_ROLL');
  } else {
    next.doublesCount = 0;
    const nextId = nextActivePlayer(next, next.currentTurn);
    next.currentTurn = nextId;
    const np = getPlayer(next, nextId);
    setPhase(next, np.inJail ? 'AWAITING_JAIL_CHOICE' : 'AWAITING_ROLL');
  }
  next.events = bus.list;
  next.eventSeq = bus.seq;
  return next;
}

// ── Internal helpers ────────────────────────────────────────────────────

interface EventBus {
  push(kind: EventKind, code: EventCode, data?: Record<string, string | number>): void;
  readonly list: GameEvent[];
  readonly seq: number;
}

function createEventBus(startSeq: number): EventBus {
  const events: GameEvent[] = [];
  let seq = startSeq;
  return {
    push(kind, code, data) {
      events.push({ key: seq++, kind, code, data });
    },
    get list() {
      return events;
    },
    get seq() {
      return seq;
    },
  };
}

function cloneState(state: GameState): GameState {
  return {
    players: state.players.map((p) => ({ ...p, freePassCards: { ...p.freePassCards } })),
    properties: state.properties.map((p) => (p ? { ...p } : null)),
    currentTurn: state.currentTurn,
    phase: state.phase,
    dice: state.dice ? ([...state.dice] as [number, number]) : null,
    doublesCount: state.doublesCount,
    chamaDeck: [...state.chamaDeck],
    chamaDiscard: [...state.chamaDiscard],
    harambeeDeck: [...state.harambeeDeck],
    harambeeDiscard: [...state.harambeeDiscard],
    pendingTrade: state.pendingTrade
      ? {
          ...state.pendingTrade,
          offerProperties: [...state.pendingTrade.offerProperties],
          requestProperties: [...state.pendingTrade.requestProperties],
        }
      : null,
    winner: state.winner,
    events: [],
    eventSeq: state.eventSeq,
  };
}

function setPhase(next: GameState, phase: GamePhase): void {
  next.phase = next.winner !== null ? 'GAME_OVER' : phase;
}

function rollDie(rng: Rng): number {
  return 1 + Math.floor(rng() * 6);
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function moveTo(next: GameState, playerId: PlayerId, spaceId: number, bus: EventBus): void {
  const player = getPlayer(next, playerId);
  const oldPos = player.position;
  const passedGo = spaceId < oldPos;
  player.position = spaceId;
  if (passedGo) {
    player.cash += RULES.goSalary;
    bus.push('GOOD', 'PASSED_GO', { amount: RULES.goSalary });
  }
}

function sendToJail(next: GameState, playerId: PlayerId, bus: EventBus): void {
  const player = getPlayer(next, playerId);
  player.position = 10;
  player.inJail = true;
  player.jailTurns = 0;
  next.doublesCount = 0;
  bus.push('BAD', 'SENT_TO_JAIL', {});
}

function nextActivePlayer(next: GameState, fromId: PlayerId): PlayerId {
  const ids = next.players.map((p) => p.id);
  const idx = ids.indexOf(fromId);
  for (let i = 1; i <= ids.length; i++) {
    const candidate = next.players[(idx + i) % ids.length];
    if (!candidate.bankrupt) return candidate.id;
  }
  throw new Error('No active players remain');
}

function nearestSpace(ids: number[], from: number): number {
  for (let i = 1; i <= BOARD_SIZE; i++) {
    const candidate = (from + i) % BOARD_SIZE;
    if (ids.includes(candidate)) return candidate;
  }
  throw new Error('No such space on the board');
}

function liquidate(next: GameState, player: Player): void {
  let progressed = true;
  while (player.cash < 0 && progressed) {
    progressed = false;
    for (const space of BOARD) {
      if (player.cash >= 0) break;
      const ps = next.properties[space.id];
      if (ps && ps.owner === player.id && ps.level > 0 && space.buildCost) {
        ps.level = (ps.level - 1) as BuildLevel;
        player.cash += space.buildCost * 0.5;
        progressed = true;
      }
    }
  }
  progressed = true;
  while (player.cash < 0 && progressed) {
    progressed = false;
    for (const space of BOARD) {
      if (player.cash >= 0) break;
      const ps = next.properties[space.id];
      if (ps && ps.owner === player.id && !ps.mortgaged && space.price) {
        ps.mortgaged = true;
        player.cash += mortgageValue(space);
        progressed = true;
      }
    }
  }
}

function checkGameOver(next: GameState, bus: EventBus): void {
  const active = next.players.filter((p) => !p.bankrupt);
  if (active.length === 1 && next.winner === null) {
    next.winner = active[0].id;
    next.phase = 'GAME_OVER';
    bus.push('INFO', 'GAME_OVER', { winner: active[0].name });
  }
}

function forceBankruptcy(next: GameState, playerId: PlayerId, creditor: PlayerId | 'bank', bus: EventBus): void {
  const player = getPlayer(next, playerId);
  player.bankrupt = true;
  player.cash = 0;
  for (const space of BOARD) {
    const ps = next.properties[space.id];
    if (ps && ps.owner === playerId) {
      if (creditor === 'bank') {
        ps.owner = null;
        ps.level = 0;
        ps.mortgaged = false;
      } else {
        ps.owner = creditor;
      }
    }
  }
  if (creditor !== 'bank') {
    const cred = getPlayer(next, creditor);
    cred.freePassCards.chama = cred.freePassCards.chama || player.freePassCards.chama;
    cred.freePassCards.harambee = cred.freePassCards.harambee || player.freePassCards.harambee;
  }
  player.freePassCards = { chama: false, harambee: false };
  bus.push('BAD', 'BANKRUPT', { name: player.name });
  checkGameOver(next, bus);
}

function chargePlayer(next: GameState, playerId: PlayerId, amount: number, creditor: PlayerId | 'bank', bus: EventBus): void {
  const player = getPlayer(next, playerId);
  player.cash -= amount;
  if (player.cash < 0) liquidate(next, player);
  if (player.cash < 0) {
    forceBankruptcy(next, playerId, creditor, bus);
    return;
  }
  if (creditor !== 'bank') {
    getPlayer(next, creditor).cash += amount;
  }
}

function cardEventKind(effect: CardEffect): EventKind {
  switch (effect.type) {
    case 'COLLECT':
    case 'COLLECT_EACH_PLAYER':
    case 'GET_OUT_OF_JAIL_FREE':
      return 'GOOD';
    case 'PAY':
    case 'PAY_EACH_PLAYER':
    case 'PAY_LEFT_PLAYER':
    case 'PAY_PER_BUILDING':
    case 'GO_TO_JAIL':
      return 'BAD';
    default:
      return 'INFO';
  }
}

function applyCardEffect(
  next: GameState,
  playerId: PlayerId,
  deckType: 'CHAMA' | 'HARAMBEE',
  effect: CardEffect,
  bus: EventBus,
  rng: Rng,
  diceTotal: number
): void {
  const player = getPlayer(next, playerId);
  switch (effect.type) {
    case 'COLLECT':
      player.cash += effect.amount;
      break;
    case 'PAY':
      chargePlayer(next, playerId, effect.amount, 'bank', bus);
      break;
    case 'PAY_EACH_PLAYER':
      for (const other of next.players) {
        if (other.id !== playerId && !other.bankrupt) chargePlayer(next, playerId, effect.amount, other.id, bus);
      }
      break;
    case 'COLLECT_EACH_PLAYER':
      for (const other of next.players) {
        if (other.id !== playerId && !other.bankrupt) chargePlayer(next, other.id, effect.amount, playerId, bus);
      }
      break;
    case 'PAY_LEFT_PLAYER':
      chargePlayer(next, playerId, effect.amount, nextActivePlayer(next, playerId), bus);
      break;
    case 'ADVANCE_TO':
      moveTo(next, playerId, effect.spaceId, bus);
      resolveLanding(next, playerId, diceTotal, bus, rng);
      break;
    case 'ADVANCE_TO_NEAREST_TRANSIT':
      moveTo(next, playerId, nearestSpace(TRANSIT_SPACE_IDS, player.position), bus);
      resolveLanding(next, playerId, diceTotal, bus, rng, 'TRANSIT_DOUBLE');
      break;
    case 'ADVANCE_TO_NEAREST_UTILITY':
      moveTo(next, playerId, nearestSpace(UTILITY_SPACE_IDS, player.position), bus);
      resolveLanding(next, playerId, diceTotal, bus, rng, 'UTILITY_TEN');
      break;
    case 'GET_OUT_OF_JAIL_FREE':
      if (deckType === 'CHAMA') player.freePassCards.chama = true;
      else player.freePassCards.harambee = true;
      break;
    case 'GO_TO_JAIL':
      sendToJail(next, playerId, bus);
      break;
    case 'PAY_PER_BUILDING': {
      let total = 0;
      for (const space of BOARD) {
        if (space.type !== 'PROPERTY') continue;
        const ps = next.properties[space.id];
        if (ps && ps.owner === playerId) {
          if (ps.level >= 1 && ps.level <= 4) total += effect.perKiosk * ps.level;
          else if (ps.level === 5) total += effect.perPlot;
        }
      }
      chargePlayer(next, playerId, total, 'bank', bus);
      break;
    }
  }
}

function drawAndApplyCard(
  next: GameState,
  playerId: PlayerId,
  deckType: 'CHAMA' | 'HARAMBEE',
  bus: EventBus,
  rng: Rng,
  diceTotal: number
): void {
  const cards = deckType === 'CHAMA' ? CHAMA_CARDS : HARAMBEE_CARDS;
  let deck = deckType === 'CHAMA' ? next.chamaDeck : next.harambeeDeck;
  let discard = deckType === 'CHAMA' ? next.chamaDiscard : next.harambeeDiscard;
  if (deck.length === 0) {
    deck = shuffle(discard, rng);
    discard = [];
  }
  const cardIndex = deck[0];
  deck = deck.slice(1);
  discard = [...discard, cardIndex];
  if (deckType === 'CHAMA') {
    next.chamaDeck = deck;
    next.chamaDiscard = discard;
  } else {
    next.harambeeDeck = deck;
    next.harambeeDiscard = discard;
  }
  const card = cards[cardIndex];
  bus.push(cardEventKind(card.effect), deckType === 'CHAMA' ? 'DREW_CHAMA' : 'DREW_HARAMBEE', { text: card.text });
  applyCardEffect(next, playerId, deckType, card.effect, bus, rng, diceTotal);
}

function resolveLanding(
  next: GameState,
  playerId: PlayerId,
  diceTotal: number,
  bus: EventBus,
  rng: Rng,
  cardBonus?: 'TRANSIT_DOUBLE' | 'UTILITY_TEN'
): void {
  const player = getPlayer(next, playerId);
  const space = BOARD[player.position];
  switch (space.type) {
    case 'GO':
    case 'JAIL':
    case 'FREE_PARKING':
      setPhase(next, 'AWAITING_END_TURN');
      break;
    case 'GO_TO_JAIL':
      sendToJail(next, playerId, bus);
      setPhase(next, 'AWAITING_END_TURN');
      break;
    case 'TAX':
      if (space.taxPercent !== undefined) {
        bus.push('INFO', 'TAX_AUDIT_PENDING', {});
        setPhase(next, 'AWAITING_TAX_CHOICE');
      } else {
        chargePlayer(next, playerId, space.taxFlat!, 'bank', bus);
        bus.push('BAD', 'PAID_TAX', { amount: space.taxFlat! });
        setPhase(next, 'AWAITING_END_TURN');
      }
      break;
    case 'CHAMA':
    case 'HARAMBEE':
      drawAndApplyCard(next, playerId, space.type, bus, rng, diceTotal);
      if (next.phase !== 'AWAITING_PROPERTY_DECISION' && next.phase !== 'AWAITING_TAX_CHOICE' && next.winner === null) {
        setPhase(next, 'AWAITING_END_TURN');
      }
      break;
    case 'PROPERTY':
    case 'TRANSIT':
    case 'UTILITY': {
      const ps = next.properties[space.id]!;
      if (ps.owner === null) {
        bus.push('INFO', 'LANDED_UNOWNED', { price: space.price! });
        setPhase(next, 'AWAITING_PROPERTY_DECISION');
      } else if (ps.owner === playerId) {
        bus.push('INFO', 'OWN_PROPERTY', {});
        setPhase(next, 'AWAITING_END_TURN');
      } else if (ps.mortgaged) {
        setPhase(next, 'AWAITING_END_TURN');
      } else {
        const owner = ps.owner;
        let rent = rentFor(next, space.id, diceTotal);
        if (cardBonus === 'TRANSIT_DOUBLE' && space.type === 'TRANSIT') rent *= 2;
        if (cardBonus === 'UTILITY_TEN' && space.type === 'UTILITY') rent = diceTotal * 10;
        chargePlayer(next, playerId, rent, owner, bus);
        bus.push('BAD', 'PAID_RENT', { amount: rent, owner: getPlayer(next, owner).name });
        setPhase(next, 'AWAITING_END_TURN');
      }
      break;
    }
  }
}
