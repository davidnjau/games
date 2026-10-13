// ─────────────────────────────────────────────────────────────
// server/index.ts — serves the built game AND relays online play,
// on one port.
//
// One process = one match (two seats). Each client sends intent
// ('pickVehicle', 'move', 'spike'...); the server is the only one
// allowed to call into rules.ts and decide what actually happened.
// Clients just render whatever MatchState the server broadcasts.
//
// Serving the single-file build (`npm run build` -> dist/index.html)
// and the WebSocket relay from the same HTTP server means players only
// ever need one address: http(s)://host[:port]/?online
// ─────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  applyMove,
  applyRoadblock,
  createMatch,
  isLegalMove,
  validateRoadblock,
} from '../src/game/rules';
import type { MatchState, PlayerId, Position, Roadblock, VehicleType } from '../src/game/types';

const PORT = Number(process.env.PORT ?? 8080);
const DIST_HTML = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');

interface Seat {
  ws: WebSocket;
  vehicle: VehicleType | null;
  ready: boolean;
}

const seats: Partial<Record<PlayerId, Seat>> = {};
let match: MatchState | null = null;

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: unknown): void {
  for (const seat of Object.values(seats)) send(seat.ws, msg);
}

function broadcastState(): void {
  if (match) broadcast({ type: 'state', match });
}

function broadcastLobby(): void {
  broadcast({
    type: 'lobby',
    picks: { 1: seats[1]?.vehicle ?? null, 2: seats[2]?.vehicle ?? null },
    ready: { 1: seats[1]?.ready ?? false, 2: seats[2]?.ready ?? false },
  });
}

function maybeStartMatch(): void {
  const s1 = seats[1];
  const s2 = seats[2];
  if (match || !s1?.ready || !s2?.ready || !s1.vehicle || !s2.vehicle) return;
  match = createMatch(s1.vehicle, s2.vehicle);
  broadcastState();
}

function resetToLobby(): void {
  match = null;
  for (const seat of Object.values(seats)) {
    seat.vehicle = null;
    seat.ready = false;
  }
  broadcastLobby();
}

const httpServer = createServer((_req, res) => {
  try {
    const html = readFileSync(DIST_HTML);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('dist/index.html not found — run `npm run build` first.');
  }
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => {
  console.log(`Matatu Rush listening on http://localhost:${PORT} (and ws on the same port)`);
});

wss.on('connection', (ws) => {
  const id: PlayerId | null = !seats[1] ? 1 : !seats[2] ? 2 : null;
  if (id === null) {
    send(ws, { type: 'error', message: 'Mchezo umejaa.' });
    ws.close();
    return;
  }

  seats[id] = { ws, vehicle: null, ready: false };
  send(ws, { type: 'assigned', playerId: id });
  if (match) send(ws, { type: 'state', match });
  else broadcastLobby();

  ws.on('message', (raw) => {
    const seat = seats[id];
    if (!seat) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'pickVehicle':
        if (match) return;
        seat.vehicle = msg.vehicle as VehicleType;
        broadcastLobby();
        break;

      case 'ready':
        if (match || !seat.vehicle) return;
        seat.ready = true;
        broadcastLobby();
        maybeStartMatch();
        break;

      case 'move': {
        if (!match || match.currentTurn !== id) return;
        const to = msg.to as Position;
        if (!isLegalMove(match, to)) return;
        match = applyMove(match, to);
        broadcastState();
        break;
      }

      case 'spike': {
        if (!match || match.currentTurn !== id) return;
        const rb = msg.rb as Roadblock;
        if (!validateRoadblock(match, rb).ok) return;
        match = applyRoadblock(match, rb);
        broadcastState();
        break;
      }

      case 'rematch':
        resetToLobby();
        break;
    }
  });

  ws.on('close', () => {
    delete seats[id];
    match = null;
    broadcastLobby();
  });
});
