# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Matatu Rush — a two-player, hot-seat Kenyan reskin of Quoridor. Players race a vehicle across a 9×9 grid to the rival's stage, dropping "Kanjo Spikes" (roadblocks) to force detours without ever fully boxing the rival in. Built with TypeScript + HTML Canvas + Vite — no game engine, no framework, no backend.

## Commands

```bash
npm install
npm run dev         # Vite dev server
npm run build        # tsc --noEmit, then vite build (outputs a single self-contained dist/index.html)
npm run preview      # preview the production build
npm run typecheck    # tsc --noEmit only
npm test             # vitest run
```

Run a single test file: `npx vitest run src/game/rules.test.ts`
Run tests matching a name: `npx vitest run -t "overtake"`

There is no lint script configured; `tsc --noEmit` (strict mode, `noUnusedLocals`/`noUnusedParameters`) is the only static check, and it runs as part of `npm run build`.

## Architecture

The core design rule: **`src/game/rules.ts` knows nothing about the screen, and the renderer/layout know nothing about game rules.** This is what makes the rules unit-testable in milliseconds and reusable (e.g. for an AI opponent or an online server) without touching rendering code.

```
keys, taps ──► main.ts (input → rules → HUD) ──► rules.ts (pure state transitions)
                    │                                   
                    └─► renderer.ts (canvas, tweens) ──► layout.ts (cells/grooves ⇄ pixels)
```

- **`src/game/types.ts`** — the vocabulary (`MatchState`, `Player`, `Roadblock`, etc.). No logic, just types/constants (`BOARD_SIZE`, `GROOVE_COUNT`, `SPIKES_PER_PLAYER`).
- **`src/game/rules.ts`** — the entire game brain. Every function is pure: `(state, input) => newState | answer`. No DOM, no canvas, no `Math.random`, no time. The street graph is implicit — there's no explicit edge list; `isStreetBlocked` checks the roadblock array on demand. Pathfinding (`shortestRouteLength`) is BFS, used both for the anti-trapping rule (`validateRoadblock` rejects any spike drop that would cut off either player's last route to their stage) and for the "steps to stage" HUD stat. `legalMoves` encodes the overtake (jump over an adjacent rival) and corner-drift (diagonal when overtake is blocked) rules.
- **`src/layout.ts`** — the only place that converts between game space (cell/groove coordinates) and screen space (pixels), including HiDPI scaling and touch/pointer hit-testing (`pixelToCell`, `pixelToGroove`).
- **`src/renderer.ts`** — draws one frame from a `MatchState` snapshot (`ViewModel`). Owns only *visual* state (pawn tween positions, spike pop-in timers) — the real state always lives in `MatchState`; the renderer animates toward it, never mutates it.
- **`src/main.ts`** — the conductor. Holds the single `MatchState` source of truth plus an undo `history` stack, wires up pointer/keyboard input, calls into `rules.ts` to produce the next state, and drives the `requestAnimationFrame` loop that calls `renderer.draw`. All state changes funnel through one `commit()` function. Also supports snapshot/restore via `window.claude.hot` so a running match survives a hot-reload inside the Claude artifact viewer.
- **`src/strings.ts`** — every user-facing string (Sheng/Swahili copy) and vehicle metadata, isolated here for easy localization.
- **`src/audio.ts`** — all sound effects are synthesized Web Audio oscillators (no audio files).

### State machine

`GamePhase`: `SELECT_VEHICLES → CHOOSE_ACTION ⇄ (turns) → GAME_OVER`. Within `CHOOSE_ACTION`, `ActionMode` toggles between `DRIVE` and `SPIKES`. All mutating rule functions (`applyMove`, `applyRoadblock`) throw on illegal input rather than failing silently — callers (`main.ts`) are expected to check `isLegalMove`/`validateRoadblock` first and surface rejection reasons (`SpikeRejection`) to the player via `strings.ts`.

## Docs

- `README.md` — how to play, controls.
- `GUIDE.md` — a milestone-by-milestone tutorial for building this project from scratch; each milestone maps to specific files. Useful as a map of which file owns which concept if you need deeper rationale than the code comments give.
- `docs/matatu-rush-blueprint.md` — the original design spec.
