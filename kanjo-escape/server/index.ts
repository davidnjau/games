// ─────────────────────────────────────────────────────────────
// server/index.ts — standalone dev/prod server: serves the built
// game AND relays online play, on one port.
//
// Serving the single-file build (`npm run build` -> dist/index.html)
// and the WebSocket relay from the same HTTP server means players only
// ever need one address: http(s)://host[:port]/?online
//
// This is for running Kanjo Escape on its own. To serve it alongside
// other games from one shared host/port, see ../../server/index.ts,
// which attaches the same relay (./relay.ts) to its own HTTP server.
// ─────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createKanjoEscapeRelay } from './relay';

const PORT = Number(process.env.PORT ?? 8080);
const DIST_HTML = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');

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

const wss = createKanjoEscapeRelay();
httpServer.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

httpServer.listen(PORT, () => {
  console.log(`Kanjo Escape listening on http://localhost:${PORT} (and ws on the same port)`);
});
