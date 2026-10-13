// ─────────────────────────────────────────────────────────────
// net.ts — the client's link to the relay server (server/index.ts).
//
// The server is authoritative: this just forwards intent and hands
// back whatever it's told. "mode" (drive vs spikes) never travels
// over the wire — it's a per-viewer UI toggle, not shared state.
// ─────────────────────────────────────────────────────────────

import type { MatchState, PlayerId, Position, Roadblock, VehicleType } from './game/types';

export type LobbyInfo = {
  picks: Record<PlayerId, VehicleType | null>;
  ready: Record<PlayerId, boolean>;
};

export type ServerMessage =
  | { type: 'assigned'; playerId: PlayerId }
  | ({ type: 'lobby' } & LobbyInfo)
  | { type: 'state'; match: MatchState }
  | { type: 'error'; message: string };

export class OnlineClient {
  private ws: WebSocket;

  constructor(url: string, onMessage: (msg: ServerMessage) => void) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data as string)));
  }

  pickVehicle(vehicle: VehicleType): void {
    this.send({ type: 'pickVehicle', vehicle });
  }

  ready(): void {
    this.send({ type: 'ready' });
  }

  move(to: Position): void {
    this.send({ type: 'move', to });
  }

  spike(rb: Roadblock): void {
    this.send({ type: 'spike', rb });
  }

  rematch(): void {
    this.send({ type: 'rematch' });
  }

  private send(msg: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
