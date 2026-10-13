# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A monorepo-by-folder of small, self-contained browser games, each built from scratch with **TypeScript + HTML Canvas + Vite — no game engine, no UI framework**. Each game lives in its own top-level directory with its own `package.json`, `node_modules`, and build; there is no shared root tooling or workspace config. `cd` into a game's directory before running any command.

- **`kanjo-escape/`** — single-player hidden-movement chase. One human vs. a computer opponent; no networking.
- **`matatu-rush/`** — two-player hot-seat board game (local), with an optional authoritative WebSocket server for online play.

## Commands

Run from inside each game's own directory (`kanjo-escape/` or `matatu-rush/`):

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

`matatu-rush` additionally has:

```bash
npm run server       # tsx watch server/index.ts — authoritative relay for online play
npm run start         # tsx server/index.ts (no watch)
```

`kanjo-escape` additionally has:

```bash
npm run simulate     # vite-node scripts/simulate.ts — 600 AI-vs-AI games, used to balance RULES
```

## Shared architecture principle

Both games follow the same core split, which is what makes the rules unit-testable in milliseconds and reusable (AI opponent, simulator, or network server) without touching rendering code:

> **The rules module knows nothing about the screen. The renderer knows nothing about game rules.**

```
keys, taps ──► main.ts (input → rules → HUD) ──► game/rules.ts (pure state transitions)
                    │
                    └─► renderer.ts (canvas, tweens) ──► layout.ts / map.ts (board ⇄ pixels)
```

Every rules function is pure: `(state, input) => newState | answer`. No DOM, no canvas, no `Math.random` (RNG is injected), no wall-clock time. `main.ts` is the sole owner of the live `state` and funnels every mutation through one commit point before re-rendering.

### kanjo-escape specifics

- **`src/game/types.ts`** — vocabulary and tunables (`RULES`: `maxRounds`, `revealEvery`, `truckRange`, `footRange`). Change a tunable, then re-run `npm run simulate` to check balance (see `DESIGN.md`'s balance table).
- **`src/game/map.ts`** — the city graph: nodes (junction/alley/stage/depot) and edges (road/alley). The only place map geometry lives.
- **`src/game/graph.ts`** — pure graph queries over the map (adjacency, BFS, movement permissions per unit kind). No game state.
- **`src/game/rules.ts`** — the referee. Central concept: `MatchState.hawkerNode` is the **secret** truth; `PublicState.belief` is every node consistent with what Kanjo has publicly observed (start points, edge-type-only move announcements, periodic reveals). `publicView()` strips the secret — anything feeding the Kanjo AI or UI must go through it, never the raw `MatchState`.
- **`src/game/ai.ts`** — scoring AIs for both sides. Hard fairness rule: the Kanjo AI only ever receives `PublicState`/belief, never `hawkerNode` — it hunts exactly like a human detective would.
- **`src/game/sim.ts`** + **`scripts/simulate.ts`** — headless AI-vs-AI match runner, used both by `rules.test.ts` (invariant checks over hundreds of games, e.g. "the real position is always inside the belief set") and by the balance script.
- Design rationale and every rule change from the original playthrough log are documented in `DESIGN.md`; `GUIDE.md` is a milestone-by-milestone build walkthrough mapping milestones to files.

### matatu-rush specifics

- **`src/game/types.ts`** — vocabulary and board constants (`BOARD_SIZE`, `GROOVE_COUNT`, `SPIKES_PER_PLAYER`). No logic.
- **`src/game/rules.ts`** — the entire game brain. The street graph is implicit (no edge list) — `isStreetBlocked` checks the roadblock array on demand. `shortestRouteLength` (BFS) backs both the anti-trapping rule (`validateRoadblock` rejects any spike drop that would cut off either player's last route to their stage) and the "steps to stage" HUD stat. `legalMoves` encodes overtake (jump an adjacent rival) and corner-drift (diagonal when overtake is blocked). Mutating functions (`applyMove`, `applyRoadblock`) **throw on illegal input** — callers must check `isLegalMove`/`validateRoadblock` first.
- **`src/layout.ts`** — the only place converting game space (cell/groove coordinates) to screen space (pixels), including HiDPI scaling and touch/pointer hit-testing.
- **`src/renderer.ts`** — draws one frame from a `MatchState` snapshot. Owns only visual state (pawn tweens, spike pop-in timers); never mutates real state, only animates toward it.
- **`src/main.ts`** — conductor: holds the single `MatchState` plus an undo `history` stack, wires input, drives the `requestAnimationFrame` loop. Supports snapshot/restore via `window.claude.hot` so a running match survives hot-reload inside the Claude artifact viewer.
- **`GamePhase`**: `SELECT_VEHICLES → CHOOSE_ACTION ⇄ (turns) → GAME_OVER`. Within `CHOOSE_ACTION`, `ActionMode` toggles `DRIVE`/`SPIKES`.
- **Online play**: `src/net.ts` (`OnlineClient`) is a thin WebSocket wrapper — `mode` (drive vs. spikes) is purely local UI state and never travels over the wire. **`server/index.ts`** is authoritative: one process = one match (two seats); it is the only thing allowed to call into `rules.ts` server-side, and it serves the built `dist/index.html` *and* the WebSocket relay from the same HTTP port, so online players need only one address (`http(s)://host[:port]/?online`). Run `npm run build` before `npm run server`/`npm run start` so the server has something to serve.
- Docs: `README.md` (play/controls), `GUIDE.md` (milestone-by-milestone build tutorial), `docs/matatu-rush-blueprint.md` (original design spec).

## Shared conventions

- `npm run build` in both projects uses `vite-plugin-singlefile` to inline everything (code, styles, icons) into one `dist/index.html` — this is the distributable artifact.
- `src/strings.ts` in both projects isolates all user-facing copy (Sheng/Swahili) and vehicle/unit metadata for easy localization — don't inline UI strings elsewhere.
- `src/audio.ts` in both projects synthesizes sound effects with Web Audio oscillators — there are no audio asset files.
- Both `vite.config.ts` files also configure `vitest` (`environment: 'node'`) — tests run via Vite's config, not a separate Jest/vitest config file.
