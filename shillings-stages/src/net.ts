// ─────────────────────────────────────────────────────────────
// net.ts — the client's link to the relay server (server/relay.ts).
//
// The server is authoritative, including dice rolls: this just
// forwards intent and renders back whatever GameState it's told.
// ─────────────────────────────────────────────────────────────

import type { GameState, PlayerId, TradeOffer } from './game/types';

export interface LobbySeat {
  id: PlayerId;
  ready: boolean;
}

export type ServerMessage =
  | { type: 'assigned'; seatId: PlayerId }
  | { type: 'lobby'; seats: LobbySeat[] }
  | { type: 'youAre'; playerId: PlayerId }
  | { type: 'state'; match: GameState }
  | { type: 'error'; message: string };

export class OnlineClient {
  private ws: WebSocket;

  constructor(url: string, onMessage: (msg: ServerMessage) => void) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data as string)));
  }

  setReady(ready: boolean): void {
    this.send({ type: 'ready', ready });
  }

  startMatch(): void {
    this.send({ type: 'startMatch' });
  }

  rollDice(): void {
    this.send({ type: 'rollDice' });
  }

  buyProperty(): void {
    this.send({ type: 'buyProperty' });
  }

  declineBuyProperty(): void {
    this.send({ type: 'declineBuyProperty' });
  }

  buildKiosk(spaceId: number): void {
    this.send({ type: 'buildKiosk', spaceId });
  }

  sellKiosk(spaceId: number): void {
    this.send({ type: 'sellKiosk', spaceId });
  }

  mortgageProperty(spaceId: number): void {
    this.send({ type: 'mortgageProperty', spaceId });
  }

  unmortgageProperty(spaceId: number): void {
    this.send({ type: 'unmortgageProperty', spaceId });
  }

  payJailFine(): void {
    this.send({ type: 'payJailFine' });
  }

  useJailFreeCard(deck: 'CHAMA' | 'HARAMBEE'): void {
    this.send({ type: 'useJailFreeCard', deck });
  }

  resolveTaxAudit(choice: 'FLAT' | 'PERCENT'): void {
    this.send({ type: 'resolveTaxAudit', choice });
  }

  endTurn(): void {
    this.send({ type: 'endTurn' });
  }

  proposeTrade(offer: TradeOffer): void {
    this.send({ type: 'proposeTrade', offer });
  }

  respondTrade(accept: boolean): void {
    this.send({ type: 'respondTrade', accept });
  }

  rematch(): void {
    this.send({ type: 'rematch' });
  }

  private send(msg: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
