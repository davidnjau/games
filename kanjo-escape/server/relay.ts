// ─────────────────────────────────────────────────────────────
// server/relay.ts — the online-play relay: one process, one match,
// up to 4 seats (1 hawker + 3 askaris). Clients send intent
// ('pickRole', 'hawkerMove', 'askariMove'...); this is the only
// thing allowed to call into rules.ts/ai.ts and decide what
// actually happened. Clients just render whatever state gets sent
// back to THEIR seat.
//
// The hard part vs. matatu-rush's relay: hidden information. The
// hawker seat gets the full MatchState; every askari seat gets
// publicView(match) only — broadcasting is always per-seat, never
// one shared payload, so hawkerNode can't leak by copy-paste.
//
// Any askari seat nobody claims is AI-controlled from kickoff —
// chooseSquadOrders' unitIds filter lets the AI decide only for
// those units once every human-controlled unit has acted. There is
// no mid-match reconnect/takeover: like matatu-rush, any disconnect
// ends the match and bounces survivors back to the lobby.
//
// Constructed with `{ noServer: true }` — the caller (this game's own
// server/index.ts, or the root games server) owns the HTTP server's
// `upgrade` event and decides which relay a given request's path maps
// to. See ../../server/index.ts for the shared multi-relay dispatch.
// ─────────────────────────────────────────────────────────────

import { WebSocketServer, type WebSocket } from 'ws';
import { chooseSquadOrders } from '../src/game/ai';
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
  payBail,
  publicView,
  type Rng,
} from '../src/game/rules';
import type { Difficulty, MatchState, NodeId, PublicState } from '../src/game/types';

export type SeatRole = 'HAWKER' | 'ASKARI_1' | 'ASKARI_2' | 'ASKARI_3';
const ROLES: SeatRole[] = ['HAWKER', 'ASKARI_1', 'ASKARI_2', 'ASKARI_3'];
const ASKARI_ROLES = ['ASKARI_1', 'ASKARI_2', 'ASKARI_3'] as const;
const UNIT_ID: Record<(typeof ASKARI_ROLES)[number], string> = {
  ASKARI_1: 'askari_1',
  ASKARI_2: 'askari_2',
  ASKARI_3: 'askari_3',
};
const unitIdForRole = (role: SeatRole): string | null =>
  role === 'HAWKER' ? null : UNIT_ID[role as (typeof ASKARI_ROLES)[number]];
const DIFFICULTIES: Difficulty[] = ['EASY', 'NORMAL', 'HARD'];

interface Wallet {
  coins: number;
  hasJailFreeCard: boolean;
}

interface Seat {
  ws: WebSocket;
  ready: boolean;
}

/**
 * Creates the Kanjo Escape online relay. The caller wires it to an HTTP
 * server's `upgrade` event. `rng` defaults to Math.random; tests pass a
 * seeded one (same `Rng` contract as createMatch/applyHawkerMove/
 * chooseSquadOrders) for deterministic matches.
 */
export function createKanjoEscapeRelay(rng: Rng = Math.random): WebSocketServer {
  const seats: Partial<Record<SeatRole, Seat>> = {};
  const clients = new Set<WebSocket>(); // everyone connected, seated or not — lobby state must reach both
  let match: MatchState | null = null;
  let difficulty: Difficulty = 'NORMAL';
  let wallet: Wallet = { coins: 0, hasJailFreeCard: false };

  function send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function roleOf(ws: WebSocket): SeatRole | null {
    for (const r of ROLES) if (seats[r]?.ws === ws) return r;
    return null;
  }

  /**
   * Per-seat state — never a shared payload, so hawkerNode can't leak to an
   * askari seat. Once the match is over there's no fairness reason left to
   * withhold it, so every seat gets the full MatchState — matching local
   * play, which always reveals the hawker's final position at GAME_OVER.
   */
  function stateFor(role: SeatRole): MatchState | PublicState {
    return role === 'HAWKER' || match!.phase === 'GAME_OVER' ? match! : publicView(match!);
  }

  function sendState(role: SeatRole): void {
    const seat = seats[role];
    if (!seat || !match) return;
    const msg: Record<string, unknown> = { type: 'state', match: stateFor(role) };
    if (role === 'HAWKER') msg.wallet = wallet;
    send(seat.ws, msg);
  }

  function broadcastState(): void {
    for (const r of ROLES) sendState(r);
  }

  function broadcastLobby(): void {
    const lobbySeats = Object.fromEntries(
      ROLES.map((r) => [r, { taken: !!seats[r], ready: seats[r]?.ready ?? false }]),
    );
    const msg = { type: 'lobby', seats: lobbySeats, difficulty };
    for (const ws of clients) send(ws, msg); // reaches unseated connections too, not just claimed seats
  }

  const aiControlledUnitIds = (): string[] =>
    ASKARI_ROLES.filter((r) => !seats[r]).map((r) => UNIT_ID[r]);

  function maybeStartMatch(): void {
    if (match) return;
    const hawker = seats.HAWKER;
    if (!hawker?.ready) return;
    if (ASKARI_ROLES.some((r) => seats[r] && !seats[r]!.ready)) return;
    match = createMatch(rng, difficulty);
    broadcastState();
    progressKanjo();
  }

  function resetToLobby(): void {
    match = null;
    wallet = { coins: 0, hasJailFreeCard: false };
    for (const r of ROLES) if (seats[r]) seats[r]!.ready = false;
    broadcastLobby();
  }

  /**
   * Drives a KANJO_TURN forward: lets AI act for any askari seat nobody
   * claimed once every *other* unmoved unit is also AI-controlled, then
   * ends the round once everyone has acted. Recurses once for a traffic
   * bonus round (phase stays KANJO_TURN with moved flags reset).
   */
  function progressKanjo(): void {
    if (!match || match.phase !== 'KANJO_TURN') return;
    const aiUnits = new Set(aiControlledUnitIds());
    const unmoved = match.askaris.filter((a) => !a.moved);
    if (unmoved.length > 0 && unmoved.every((a) => aiUnits.has(a.id))) {
      for (const order of chooseSquadOrders(publicView(match), rng, unmoved.map((a) => a.id))) {
        match = order.to ? applyAskariMove(match, order.unitId, order.to) : holdAskari(match, order.unitId);
        broadcastState();
        if (match.phase !== 'KANJO_TURN') return; // BAIL_DECISION or GAME_OVER
      }
    }
    if (!match.askaris.every((a) => a.moved)) return; // still waiting on a human seat
    match = endKanjoTurn(match);
    broadcastState();
    if (match.phase === 'KANJO_TURN') progressKanjo();
  }

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    if (match) {
      send(ws, { type: 'error', message: 'Mchezo inaendelea — subiri hii imalizike.' });
      ws.close();
      return;
    }

    clients.add(ws);
    send(ws, { type: 'assigned', role: null });
    broadcastLobby();

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const role = roleOf(ws);

      switch (msg.type) {
        case 'pickRole': {
          if (match) return;
          const want = msg.role as SeatRole;
          if (!ROLES.includes(want) || seats[want]) return;
          if (role) delete seats[role];
          seats[want] = { ws, ready: false };
          send(ws, { type: 'assigned', role: want });
          broadcastLobby();
          break;
        }

        case 'setDifficulty': {
          if (match || role !== 'HAWKER') return;
          const d = msg.difficulty as Difficulty;
          if (!DIFFICULTIES.includes(d)) return;
          difficulty = d;
          broadcastLobby();
          break;
        }

        case 'ready': {
          if (match || !role) return;
          seats[role]!.ready = true;
          broadcastLobby();
          maybeStartMatch();
          break;
        }

        case 'wallet': {
          if (role !== 'HAWKER') return;
          if (typeof msg.coins === 'number') wallet.coins = msg.coins;
          if (typeof msg.hasJailFreeCard === 'boolean') wallet.hasJailFreeCard = msg.hasJailFreeCard;
          break;
        }

        case 'hawkerMove': {
          if (!match || role !== 'HAWKER' || match.phase !== 'HAWKER_TURN') return;
          const to = msg.to as NodeId;
          if (!hawkerMoves(match).some((m) => m.to === to)) return;
          match = applyHawkerMove(match, to, rng);
          if (match.phase === 'GAME_OVER' && match.outcome?.reason === 'ESCAPED') {
            wallet.coins += coinsForEscape(match.round, match.rules);
          }
          broadcastState();
          progressKanjo();
          break;
        }

        case 'askariMove': {
          const unitId = role && unitIdForRole(role);
          if (!match || !unitId || match.phase !== 'KANJO_TURN') return;
          const to = msg.to as NodeId;
          if (!askariOptions(publicView(match), unitId).some((o) => o.to === to)) return;
          match = applyAskariMove(match, unitId, to);
          broadcastState();
          progressKanjo();
          break;
        }

        case 'holdAskari': {
          const unitId = role && unitIdForRole(role);
          if (!match || !unitId || match.phase !== 'KANJO_TURN') return;
          const unit = match.askaris.find((a) => a.id === unitId);
          if (!unit || unit.moved) return;
          match = holdAskari(match, unitId);
          broadcastState();
          progressKanjo();
          break;
        }

        case 'bailDecision': {
          if (!match || role !== 'HAWKER' || match.phase !== 'BAIL_DECISION') return;
          const choice = msg.choice;
          if (choice === 'decline') {
            match = declineBail(match);
          } else if (choice === 'pay') {
            const cost = bailCost(match);
            if (wallet.coins < cost) return;
            wallet.coins -= cost;
            match = payBail(match);
          } else if (choice === 'card') {
            if (!wallet.hasJailFreeCard) return;
            wallet.hasJailFreeCard = false;
            match = payBail(match);
          } else {
            return;
          }
          broadcastState();
          progressKanjo();
          break;
        }

        case 'rematch':
          resetToLobby();
          break;
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      const role = roleOf(ws);
      if (!role) return; // never seated — a bystander leaving doesn't touch a running match
      delete seats[role];
      match = null;
      wallet = { coins: 0, hasJailFreeCard: false };
      // Force everyone remaining to re-confirm readiness for whatever match comes next.
      for (const r of ROLES) if (seats[r]) seats[r]!.ready = false;
      broadcastLobby();
    });
  });

  return wss;
}
