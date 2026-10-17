// ─────────────────────────────────────────────────────────────
// server/relay.ts — the online-play relay: one process, one match,
// 2-8 seats. Each client sends intent ('rollDice', 'buyProperty',
// 'proposeTrade'...); this is the only thing allowed to call into
// rules.ts and decide what actually happened — dice are rolled here
// with the server's own RNG, never trusted from a client. Clients
// just render whatever GameState gets broadcast back.
//
// Unlike matatu-rush's fixed two-seat relay, player count here is
// variable (2-8), so there's a lobby phase: anyone who has joined and
// marked themselves ready can trigger `startMatch` once at least two
// seats are ready. `seatOrder` then maps the relay's connection slots
// (1-8, assigned in join order) onto the game's internal PlayerIds
// (1..N, assigned in ready order) for the rest of the match.
//
// Constructed with `{ noServer: true }` — the caller (this game's own
// server/index.ts, or the root games server) owns the HTTP server's
// `upgrade` event and decides which relay a given request's path maps
// to. See ../../server/index.ts for the shared multi-relay dispatch.
// ─────────────────────────────────────────────────────────────

import { WebSocketServer, type WebSocket } from 'ws';
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
} from '../src/game/rules';
import type { GameState, PlayerId, TradeOffer } from '../src/game/types';

const MAX_SEATS = 8;

interface Seat {
  ws: WebSocket;
  ready: boolean;
}

export function createShillingsStagesRelay(): WebSocketServer {
  const seats = new Map<PlayerId, Seat>();
  /** seatOrder[i] = the relay seat controlling game PlayerId i+1, fixed once a match starts. */
  let seatOrder: PlayerId[] = [];
  let match: GameState | null = null;

  function send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcast(msg: unknown): void {
    for (const seat of seats.values()) send(seat.ws, msg);
  }

  function broadcastState(): void {
    if (match) broadcast({ type: 'state', match });
  }

  function broadcastLobby(): void {
    broadcast({
      type: 'lobby',
      seats: [...seats.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, seat]) => ({ id, ready: seat.ready })),
    });
  }

  function gamePlayerForSeat(seatId: PlayerId): PlayerId | null {
    const idx = seatOrder.indexOf(seatId);
    return idx === -1 ? null : idx + 1;
  }

  function resetToLobby(): void {
    match = null;
    seatOrder = [];
    for (const seat of seats.values()) seat.ready = false;
    broadcastLobby();
  }

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    let id: PlayerId | null = null;
    for (let i = 1; i <= MAX_SEATS; i++) {
      if (!seats.has(i)) {
        id = i;
        break;
      }
    }
    if (id === null) {
      send(ws, { type: 'error', message: 'Mchezo umejaa.' });
      ws.close();
      return;
    }

    const seatId = id;
    seats.set(seatId, { ws, ready: false });
    send(ws, { type: 'assigned', seatId });
    if (match) send(ws, { type: 'state', match });
    else broadcastLobby();

    ws.on('message', (raw) => {
      const seat = seats.get(seatId);
      if (!seat) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      try {
        const myPlayerId = match ? gamePlayerForSeat(seatId) : null;
        const isCurrentTurn = match !== null && myPlayerId === match.currentTurn;

        switch (msg.type) {
          case 'ready':
            if (match) return;
            seat.ready = Boolean(msg.ready);
            broadcastLobby();
            break;

          case 'startMatch': {
            if (match) return;
            const readyIds = [...seats.entries()]
              .filter(([, s]) => s.ready)
              .map(([pid]) => pid)
              .sort((a, b) => a - b);
            if (readyIds.length < 2) return;
            seatOrder = readyIds;
            match = createGame(readyIds.length, Math.random);
            for (const [pid, s] of seats.entries()) {
              const gp = gamePlayerForSeat(pid);
              if (gp !== null) send(s.ws, { type: 'youAre', playerId: gp });
            }
            broadcastState();
            break;
          }

          case 'rollDice':
            if (!match || !isCurrentTurn) return;
            match = rollDice(match, Math.random);
            broadcastState();
            break;

          case 'buyProperty':
            if (!match || !isCurrentTurn) return;
            match = buyProperty(match);
            broadcastState();
            break;

          case 'declineBuyProperty':
            if (!match || !isCurrentTurn) return;
            match = declineBuyProperty(match);
            broadcastState();
            break;

          case 'buildKiosk':
            if (!match || !isCurrentTurn) return;
            match = buildKiosk(match, Number(msg.spaceId));
            broadcastState();
            break;

          case 'sellKiosk':
            if (!match || !isCurrentTurn) return;
            match = sellKiosk(match, Number(msg.spaceId));
            broadcastState();
            break;

          case 'mortgageProperty':
            if (!match || !isCurrentTurn) return;
            match = mortgageProperty(match, Number(msg.spaceId));
            broadcastState();
            break;

          case 'unmortgageProperty':
            if (!match || !isCurrentTurn) return;
            match = unmortgageProperty(match, Number(msg.spaceId));
            broadcastState();
            break;

          case 'payJailFine':
            if (!match || !isCurrentTurn) return;
            match = payJailFine(match);
            broadcastState();
            break;

          case 'useJailFreeCard':
            if (!match || !isCurrentTurn) return;
            match = useJailFreeCard(match, msg.deck as 'CHAMA' | 'HARAMBEE');
            broadcastState();
            break;

          case 'resolveTaxAudit':
            if (!match || !isCurrentTurn) return;
            match = resolveTaxAudit(match, msg.choice as 'FLAT' | 'PERCENT');
            broadcastState();
            break;

          case 'endTurn':
            if (!match || !isCurrentTurn) return;
            match = endTurn(match);
            broadcastState();
            break;

          case 'proposeTrade': {
            if (!match || myPlayerId === null) return;
            const offer = msg.offer as TradeOffer;
            if (offer.from !== myPlayerId) return;
            match = proposeTrade(match, offer);
            broadcastState();
            break;
          }

          case 'respondTrade': {
            if (!match || !match.pendingTrade || myPlayerId !== match.pendingTrade.to) return;
            match = respondTrade(match, Boolean(msg.accept));
            broadcastState();
            break;
          }

          case 'rematch':
            resetToLobby();
            break;
        }
      } catch (err) {
        send(ws, { type: 'error', message: err instanceof Error ? err.message : 'Hitilafu.' });
      }
    });

    ws.on('close', () => {
      seats.delete(seatId);
      if (match) match = null;
      broadcastLobby();
    });
  });

  return wss;
}
