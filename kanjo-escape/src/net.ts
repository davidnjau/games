// ─────────────────────────────────────────────────────────────
// net.ts — the client's link to the relay server (server/relay.ts).
//
// The server is authoritative: this just forwards intent and hands
// back whatever it's told. In online mode main.ts never calls
// applyHawkerMove/applyAskariMove/payBail/etc. locally — it sends
// intent here and waits for the server's `state` echo.
// ─────────────────────────────────────────────────────────────

import type { Difficulty, MatchState, NodeId, PublicState } from './game/types';

export type SeatRole = 'HAWKER' | 'ASKARI_1' | 'ASKARI_2' | 'ASKARI_3';

export interface LobbySeats {
  seats: Record<SeatRole, { taken: boolean; ready: boolean }>;
  difficulty: Difficulty;
}

export interface WalletSnapshot {
  coins: number;
  hasJailFreeCard: boolean;
}

export type ServerMessage =
  | { type: 'assigned'; role: SeatRole | null }
  | ({ type: 'lobby' } & LobbySeats)
  | { type: 'state'; match: MatchState | PublicState; wallet?: WalletSnapshot }
  | { type: 'error'; message: string };

export class OnlineClient {
  private ws: WebSocket;

  constructor(url: string, onMessage: (msg: ServerMessage) => void) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data as string)));
  }

  pickRole(role: SeatRole): void {
    this.send({ type: 'pickRole', role });
  }

  setDifficulty(difficulty: Difficulty): void {
    this.send({ type: 'setDifficulty', difficulty });
  }

  ready(): void {
    this.send({ type: 'ready' });
  }

  sendWallet(coins: number, hasJailFreeCard: boolean): void {
    this.send({ type: 'wallet', coins, hasJailFreeCard });
  }

  hawkerMove(to: NodeId): void {
    this.send({ type: 'hawkerMove', to });
  }

  askariMove(to: NodeId): void {
    this.send({ type: 'askariMove', to });
  }

  holdAskari(): void {
    this.send({ type: 'holdAskari' });
  }

  bailDecision(choice: 'pay' | 'card' | 'decline'): void {
    this.send({ type: 'bailDecision', choice });
  }

  rematch(): void {
    this.send({ type: 'rematch' });
  }

  private send(msg: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
