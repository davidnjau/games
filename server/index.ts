// ─────────────────────────────────────────────────────────────
// server/index.ts — serves the game list and every game from one
// host:port, so the whole thing can sit behind a single public IP
// or domain:
//
//   /            → landing page listing every game
//   /games       → same landing page
//   /games/<id>  → that game's single-file build
//
// Each game build is a fully self-contained dist/index.html (see
// each game's vite.config.ts — vite-plugin-singlefile inlines JS,
// CSS and icons as data URIs), so serving it from a sub-path needs
// no base-path config. Matatu Rush's online relay (its own
// WebSocketServer) is attached to this same HTTP server; its client
// connects same-origin (ws(s)://<host>, no path), so it works
// unmodified regardless of which host/IP/domain this is reached at.
//
// Config is via env vars, set however you run this (shell export,
// Docker -e, docker-compose, systemd EnvironmentFile, ...):
//   PORT        — port to listen on (default 8080)
//   HOST        — bind address (default 0.0.0.0, i.e. all interfaces —
//                 required to be reachable via a public IP, e.g. in a
//                 container)
//   PUBLIC_URL  — optional. Only used to print the shareable link in
//                 the startup banner below, e.g.
//                 http://<public-ip>:8080 or https://games.example.com
// ─────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attachMatatuRushRelay } from '../matatu-rush/server/relay';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

const ROOT = dirname(fileURLToPath(import.meta.url));

interface GameEntry {
  id: string;
  name: string;
  tagline: string;
  distHtml: string;
}

const GAMES: GameEntry[] = [
  {
    id: 'kanjo-escape',
    name: 'Kanjo Escape',
    tagline: "Slip the Kanjo squad across Nairobi's CBD, or hunt the hawker down.",
    distHtml: join(ROOT, '../kanjo-escape/dist/index.html'),
  },
  {
    id: 'matatu-rush',
    name: 'Matatu Rush',
    tagline: 'Race your matatu to the stage and drop Kanjo Spikes to block your rival.',
    distHtml: join(ROOT, '../matatu-rush/dist/index.html'),
  },
];

function renderLandingPage(): string {
  const cards = GAMES.map(
    (g) => `
      <a class="card" href="/games/${g.id}">
        <h2>${g.name}</h2>
        <p>${g.tagline}</p>
      </a>`
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Games</title>
<style>
  body { font-family: system-ui, sans-serif; background: #111; color: #eee; margin: 0; padding: 2rem; }
  h1 { margin-bottom: 1.5rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .card { display: block; padding: 1.25rem; background: #1c1c1c; border-radius: 0.75rem; color: inherit; text-decoration: none; border: 1px solid #333; }
  .card:hover { border-color: #666; }
  .card h2 { margin: 0 0 0.5rem; }
  .card p { margin: 0; color: #aaa; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Games</h1>
<div class="grid">
${cards}
</div>
</body>
</html>`;
}

function serveGame(game: GameEntry, res: import('node:http').ServerResponse): void {
  try {
    const html = readFileSync(game.distHtml);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`${game.id}/dist/index.html not found — run \`npm run build\` first.`);
  }
}

const httpServer = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://internal').pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/' || pathname === '/games') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderLandingPage());
    return;
  }

  const match = pathname.match(/^\/games\/([^/]+)$/);
  const game = match && GAMES.find((g) => g.id === match[1]);
  if (game) {
    serveGame(game, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Matatu Rush is the only online game so far; its relay attaches to every
// upgrade request on this server. If a second online game is added, give
// each relay its own path and dispatch on `request.url` in the `upgrade`
// event instead.
attachMatatuRushRelay(httpServer);

httpServer.listen(PORT, HOST, () => {
  console.log(`Games listening on http://${HOST}:${PORT}`);
  console.log(`Shareable link: ${PUBLIC_URL}/games`);
});
