# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A monorepo-by-folder of small, self-contained browser games, each built from scratch with **TypeScript + Vite — no game engine, no UI framework**. Most render to an HTML Canvas; two (`choma-tycoon`, `shillings-stages`) render to plain DOM/CSS instead, because their UI (patience bars/order bubbles, or a property board/dashboards/modals) is naturally DOM-shaped — see "Shared architecture principle" below for why that's still the same architecture. Each game lives in its own top-level directory with its own `package.json`, `node_modules`, and build. The root also has its own minimal `package.json` — for the unified games server described below, not a workspace/monorepo tool. `cd` into a game's directory before running that game's own commands.

- **`kanjo-escape/`** — hidden-movement chase: 1 hawker vs. up to 3 Kanjo-squad seats (AI fills any unclaimed seat). Local hot-seat (human vs. AI) or online via its own authoritative WebSocket relay.
- **`matatu-rush/`** — two-player hot-seat board game (local), with an optional authoritative WebSocket server for online play.
- **`choma-tycoon/`** — single-player real-time arcade order-matching game. No networking; a `requestAnimationFrame` loop ticks the game clock instead of a turn-based state machine.
- **`shillings-stages/`** — 2-8 player Kenyan-reskinned property-trading board game (Monopoly-style), local hot-seat or online via its own authoritative WebSocket relay.
- **`server/`** (root) — a single Node server that serves the game list and every game's build from one host:port, so the whole thing can be deployed behind one public IP or domain. See "Unified games server" below.

## Commands

Run from inside each game's own directory (`kanjo-escape/`, `matatu-rush/`, `choma-tycoon/`, or `shillings-stages/`):

```bash
npm install
npm run dev         # Vite dev server
npm run build        # tsc --noEmit, then vite build -> single self-contained dist/index.html
npm run preview      # preview the production build
npm run typecheck    # tsc --noEmit only
npm test             # vitest run
```

Run a single test file: `npx vitest run src/game/rules.test.ts`
Run tests matching a name: `npx vitest run -t "overtake"`

There is no lint script in either project; `tsc --noEmit` (strict mode, `noUnusedLocals`/`noUnusedParameters`) is the only static check, and it runs as part of `npm run build`.

`matatu-rush` and `shillings-stages` additionally have:

```bash
npm run server       # tsx watch server/index.ts — authoritative relay for online play
npm run start         # tsx server/index.ts (no watch)
```

`kanjo-escape` additionally has:

```bash
npm run simulate     # vite-node scripts/simulate.ts — 600 AI-vs-AI games, used to balance RULES
```

From the **repo root**, the unified games server:

```bash
npm install
npm run build        # builds all four games (npm --prefix per game)
npm start            # tsx server/index.ts — serves /games, /games/kanjo-escape, /games/matatu-rush, /games/choma-tycoon, /games/shillings-stages
```

Or via Docker (multi-stage build; final image has no dev tooling, just the four builds + the server):

```bash
docker compose up --build
```

## Shared architecture principle

All four games follow the same core split, which is what makes the rules unit-testable in milliseconds and reusable (AI opponent, simulator, or network server) without touching rendering code:

> **The rules module knows nothing about the screen. The renderer knows nothing about game rules.**

```
keys, taps ──► main.ts (input → rules → HUD) ──► game/rules.ts (pure state transitions)
                    │
                    └─► renderer.ts (canvas/DOM, tweens) ──► layout.ts / map.ts (board ⇄ pixels)
```

Every rules function is pure: `(state, input) => newState | answer`. No DOM, no canvas, no `Math.random` (RNG is injected), no wall-clock time. `main.ts` is the sole owner of the live `state` and funnels every mutation through one commit point before re-rendering. This holds even in `choma-tycoon` and `shillings-stages`, where `renderer.ts` paints to the DOM instead of a canvas — the principle is "rendering is a dumb function of state," not "must use `<canvas>`."

### kanjo-escape specifics

- **`src/game/types.ts`** — vocabulary and tunables (`RULES`: `maxRounds`, `revealEvery`, `truckRange`, `footRange`). Change a tunable, then re-run `npm run simulate` to check balance (see `DESIGN.md`'s balance table).
- **`src/game/map.ts`** — the city graph: nodes (junction/alley/stage/depot) and edges (road/alley). The only place map geometry lives.
- **`src/game/graph.ts`** — pure graph queries over the map (adjacency, BFS, movement permissions per unit kind). No game state.
- **`src/game/rules.ts`** — the referee. Central concept: `MatchState.hawkerNode` is the **secret** truth; `PublicState.belief` is every node consistent with what Kanjo has publicly observed (start points, edge-type-only move announcements, periodic reveals). `publicView()` strips the secret — anything feeding the Kanjo AI or UI must go through it, never the raw `MatchState`.
- **`src/game/ai.ts`** — scoring AIs for both sides. Hard fairness rule: the Kanjo AI only ever receives `PublicState`/belief, never `hawkerNode` — it hunts exactly like a human detective would.
- **`src/game/sim.ts`** + **`scripts/simulate.ts`** — headless AI-vs-AI match runner, used both by `rules.test.ts` (invariant checks over hundreds of games, e.g. "the real position is always inside the belief set") and by the balance script.
- Also has difficulty levels, a traffic/bail/coin-economy layer on top of the core chase, and (via `?online`) a WebSocket relay letting up to 3 Kanjo seats be filled by separate humans instead of AI — same `{ noServer: true }` + dedicated-path pattern as matatu-rush/shillings-stages below. See `kanjo-escape/CLAUDE.md` for all of this in depth; this root file only covers the core hidden-movement mechanic.
- Design rationale and every rule change from the original playthrough log are documented in `DESIGN.md`; `GUIDE.md` is a milestone-by-milestone build walkthrough mapping milestones to files.

### matatu-rush specifics

- **`src/game/types.ts`** — vocabulary and board constants (`BOARD_SIZE`, `GROOVE_COUNT`, `SPIKES_PER_PLAYER`). No logic.
- **`src/game/rules.ts`** — the entire game brain. The street graph is implicit (no edge list) — `isStreetBlocked` checks the roadblock array on demand. `shortestRouteLength` (BFS) backs both the anti-trapping rule (`validateRoadblock` rejects any spike drop that would cut off either player's last route to their stage) and the "steps to stage" HUD stat. `legalMoves` encodes overtake (jump an adjacent rival) and corner-drift (diagonal when overtake is blocked). Mutating functions (`applyMove`, `applyRoadblock`) **throw on illegal input** — callers must check `isLegalMove`/`validateRoadblock` first.
- **`src/layout.ts`** — the only place converting game space (cell/groove coordinates) to screen space (pixels), including HiDPI scaling and touch/pointer hit-testing.
- **`src/renderer.ts`** — draws one frame from a `MatchState` snapshot. Owns only visual state (pawn tweens, spike pop-in timers); never mutates real state, only animates toward it.
- **`src/main.ts`** — conductor: holds the single `MatchState` plus an undo `history` stack, wires input, drives the `requestAnimationFrame` loop. Supports snapshot/restore via `window.claude.hot` so a running match survives hot-reload inside the Claude artifact viewer.
- **`GamePhase`**: `SELECT_VEHICLES → CHOOSE_ACTION ⇄ (turns) → GAME_OVER`. Within `CHOOSE_ACTION`, `ActionMode` toggles `DRIVE`/`SPIKES`.
- **Online play**: `src/net.ts` (`OnlineClient`) is a thin WebSocket wrapper — `mode` (drive vs. spikes) is purely local UI state and never travels over the wire. It connects same-origin (`ws(s)://<location.host>`, no path), so the relay works unmodified no matter what host/IP/domain/sub-path serves the page. **`server/relay.ts`** (`attachMatatuRushRelay(httpServer)`) is the authoritative relay: one process = one match (two seats); it's the only thing allowed to call into `rules.ts` server-side. It attaches to *any* `http.Server` passed in. **`server/index.ts`** is matatu-rush's standalone wrapper around it — serves the built `dist/index.html` plus the relay on one port, so solo players need only one address (`http(s)://host[:port]/?online`). The root unified server (`../server/index.ts`) attaches the same `relay.ts` to its own HTTP server instead, so online play works identically whether matatu-rush is run standalone or served alongside other games. Run `npm run build` before `npm run server`/`npm run start` so there's a `dist/index.html` to serve.
- Docs: `README.md` (play/controls), `GUIDE.md` (milestone-by-milestone build tutorial), `docs/matatu-rush-blueprint.md` (original design spec).

### choma-tycoon specifics

A real-time arcade game, unlike the other two turn-based games — so its `rules.ts` is driven by a single `tick(state, dtMs, rng, holding)` called every animation frame, not by discrete per-turn actions alone.

- **`src/game/types.ts`** — vocabulary and tunables (`RULES`: match duration, patience/scoring constants, Kanjo-raid timings).
- **`src/game/rules.ts`** — `createGame` seeds a fresh run; `tick` advances the clock, the customer-spawn timer, each customer's patience, and the Kanjo-raid state machine (`NONE → WARNING → HIDING → NONE`) by `dtMs`. Player actions are separate pure functions: `selectCustomer` (switching customers clears the in-progress tray), `addIngredient` (advances the tray on a correct ingredient, **resets it to empty** on a wrong one), `clearTray`, `serve` (only succeeds once the tray exactly matches the customer's required sequence). `difficultyLevel(score)` is a pure function of score; higher levels shrink patience/spawn intervals and raise the odds of the Combo Plate and sauce add-ons. During the `HIDING` raid phase, operations are frozen: no patience drain, no spawns — "pack up and hide" is a real breather, not just a UI overlay.
- **Feedback as data, not strings**: every player-visible event (`addIngredient`, `serve`, patience running out, raid fine/safe) emits a `{ kind, code, key }` on `GameState.feedback` rather than a message string — `strings.ts` maps `code → message` and `main.ts` maps `code → sound`, so neither the renderer nor the sound layer is coupled to exact copy.
- **`src/renderer.ts`** — a DOM-based `Renderer` class (not canvas): queries its elements once by ID, then `render(state, handlers)` rebuilds the small dynamic bits (customer cards, tray slots) from scratch each call — cheap, since there are at most `RULES.maxCustomers` (3) of them. `RenderHandlers` are click callbacks supplied by `main.ts`; the renderer never calls into `rules.ts` itself.
- **`src/main.ts`** — the conductor: a persistent `requestAnimationFrame` loop samples `dt`, calls `tick`, diffs `state.feedback.key` to trigger at most one sound per event, and renders. `holding` (for the hide-button hold-to-confirm) is a plain module-level boolean toggled by `pointerdown`/`pointerup`/`pointerleave`, sampled by `tick` every frame rather than driving its own timer. High score persists to `localStorage`.

### shillings-stages specifics

A turn-based, 2-8 player Monopoly-style property-trading game. Unlike the other turn-based game (`matatu-rush`), player count is variable, so there's no fixed-seat lobby — see the online-play note below.

- **`src/game/types.ts`** — vocabulary (`Space`, `PropertyState`, `Player`, `GameState`, `GamePhase`, `TradeOffer`) and the `RULES` tunables (starting cash, GO salary, jail fine, building-bank caps, mortgage/unmortgage rates, transit/utility rent tables). Events are feedback-as-data: `GameState.events` holds only the events produced by the most recent action (not cumulative), each `{ key, kind, code, data }` — `strings.ts` maps `code` (+`data`) to copy, `main.ts` maps `code` to a sound, so neither is coupled to exact wording.
- **`src/game/board.ts`** — the 40-space board as pure data (price/rent tables per property, transit/utility/tax/card spaces). The only place board geometry/economics live.
- **`src/game/cards.ts`** — the two 16-card Harambee/Chama decks as data, each card a `{ text, effect }` pair over a typed `CardEffect` union.
- **`src/game/rules.ts`** — the referee. Every action (`rollDice`, `buyProperty`, `buildKiosk`, `mortgageProperty`, `proposeTrade`, `endTurn`, ...) is a pure function that clones the incoming state and returns a new one; illegal calls throw, so callers (`main.ts`/`server/relay.ts`) must gate which actions they offer (`canBuildOn`, phase checks) before calling them. `RULES`-driven building bank caps (32 Kiosks / 12 Plot-Flats, shared across all players) are derived on demand from `state.properties`, not tracked as separate counters. Bankruptcy auto-liquidates (sell buildings, then mortgage properties) before transferring remaining assets to the creditor (another player) or back to the bank.
- **`src/layout.ts`** — the only place converting a board space index (0-39) into a screen position. `spaceGridPosition` is the logical 11×11 square-loop coordinate; `spaceIsoPosition` projects that into the isometric screen space (2:1 diamond tiling, sized so adjacent tiles share an edge with no gaps) the canvas renderer draws — swapping either projection never touches `game/rules.ts`. `setupHiDPICanvas` handles devicePixelRatio scaling.
- **`src/renderer.ts`** — a hybrid `Renderer`: the 40-space board is a `<canvas>` painted with `game/rules.ts`-free isometric drawing (flat-colored diamond tiles per group, procedurally-drawn 3-face "box" buildings scaled by Kiosk/Plot level, deterministic pothole blemishes seeded by space id) — a placeholder art pass by design, since there's no sprite sheet yet; swapping in real PNG/SVG tile art later only touches the handful of `draw*` methods, not the projection math or game state. Dashboards, dice, and the action bar stay DOM, rebuilt from scratch each `render()` call like `choma-tycoon`'s pattern. The renderer also gates the action bar and decision modals by `viewerPlayerId` (null in local hot-seat, the viewer's own `PlayerId` online) so an online spectator can't act on another player's turn — they see a read-only "waiting for X" version of the same modal instead.
- **`src/main.ts`** — the conductor; no animation loop needed since this is turn-based, not real-time. Local hot-seat and online share one `RenderHandlers` object; each handler branches on `ONLINE` to either call `game/rules.ts` directly (local) or send intent to the relay (online) and wait for the authoritative `state` broadcast.
- **Online play**: variable player count means there's a lobby phase instead of matatu-rush's fixed two seats — anyone connected can mark `ready`, and once ≥2 are ready, anyone can trigger `startMatch`. **`server/relay.ts`** (`createShillingsStagesRelay()`) then maps relay connection slots (1-8, join order) onto the game's internal `PlayerId`s (1..N, ready order) via `seatOrder`, rolls dice server-side (never client-trusted), and guards every other action behind a turn-ownership (or trade-recipient) check before calling into `rules.ts`. Like `createMatatuRushRelay()`, it's constructed with `{ noServer: true }` — see "Unified games server" below for how the HTTP server dispatches upgrades to it. **`src/net.ts`** (`OnlineClient`) connects same-origin at this game's dedicated path (`/ws/shillings-stages`). **`server/index.ts`** is the standalone wrapper, same shape as matatu-rush's.

## Unified games server (root `server/`, `package.json`, `Dockerfile`)

**`server/index.ts`** is a single plain-`node:http` server (no Express) exposing every game from one host:port:

- `/` and `/games` — a generated landing page listing all games (`GAMES` array at the top of the file; add an entry there plus a build step to add a new game).
- `/games/<id>` — reads and serves that game's `dist/index.html` directly. Works unmodified from any sub-path because each build is a fully self-contained single file (no `/assets/...` references, no vite `base` config needed).
- Kanjo Escape, Matatu Rush and Shillings & Stages each bring their own relay (`createKanjoEscapeRelay()`, `createMatatuRushRelay()`, `createShillingsStagesRelay()`), all constructed with `{ noServer: true }`. This server owns the single `upgrade` event and dispatches by request path via a `RELAYS` path→`WebSocketServer` map (`/ws/kanjo-escape`, `/ws/matatu-rush`, `/ws/shillings-stages`) — unmatched paths get the socket destroyed. Each game's `src/net.ts` connects same-origin at its own dedicated path accordingly. Adding another online game means adding its relay to `RELAYS` under a new path, nothing more.

Config is env vars, not files: `PORT` (default 8080), `HOST` (default `0.0.0.0`, needed to be reachable via a public IP/container), `PUBLIC_URL` (optional — only used for the startup banner's shareable link, e.g. `http://<public-ip>:8080` or `https://games.example.com`; the server itself works at any address since each game's WS client connects same-origin).

**`Dockerfile`** is a two-stage build: stage `build` runs `npm ci && npm run build` inside each game directory (producing their `dist/index.html`); stage `runtime` installs only the root's production deps (`tsx`, `ws`) and copies in `server/`, every game's `dist/` output, and kanjo-escape's, matatu-rush's and shillings-stages's `src/`+`server/` (needed because their `relay.ts` files import game rules straight from TypeScript source via `tsx`, not from the built bundle). `docker-compose.yml` wraps this with a `PUBLIC_URL` example and a `8080:8080` port mapping — change the host-side port or add your reverse proxy/TLS termination in front as needed.

## Shared conventions

- `npm run build` in every project uses `vite-plugin-singlefile` to inline everything (code, styles, and canvas-game icons) into one `dist/index.html` — this is the distributable artifact. `choma-tycoon` has no icon assets to inline; its "sprites" are emoji glyphs in `strings.ts`.
- `src/strings.ts` in every project isolates all user-facing copy (Sheng/Swahili) and vehicle/unit/ingredient metadata for easy localization — don't inline UI strings elsewhere.
- `src/audio.ts` in every project synthesizes sound effects with Web Audio oscillators — there are no audio asset files.
- Every `vite.config.ts` also configures `vitest` (`environment: 'node'`) — tests run via Vite's config, not a separate Jest/vitest config file.
