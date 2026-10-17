# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kanjo Escape: a hidden-movement chase game. One player is the **hawker**, trying to slip through Nairobi's CBD to a matatu stage; up to three others each drive one **Kanjo** unit (two pickup trucks, one askari on foot) hunting them — any unclaimed Kanjo seat is AI-controlled. Local play is one human vs. AI on one screen; `?online` adds a WebSocket relay for the multi-seat case. Built with TypeScript + HTML Canvas + Vite — no game engine. It is one of several sibling games in the parent monorepo (see `../CLAUDE.md` for the shared architecture and the unified games server); this file covers only what's specific to working inside `kanjo-escape/`.

Read `DESIGN.md` first — it's the rulebook the code implements (round structure, win conditions, the belief-set deduction model, balance numbers) and documents every change from the original design log with its reasoning. `GUIDE.md` is a milestone-by-milestone build walkthrough mapping each concept (graphs-as-data, hidden information, deduction, scoring AI, balance-by-simulation) to the file that implements it — useful when you need to understand *why* a file is shaped the way it is, not just what it does.

## Commands

```bash
npm install
npm run dev          # Vite dev server
npm run build         # tsc --noEmit, then vite build -> single self-contained dist/index.html
npm run preview       # preview the production build
npm run typecheck     # tsc --noEmit only
npm test              # vitest run (21 rule, deduction and AI tests)
npm run simulate      # vite-node scripts/simulate.ts — 600 AI-vs-AI games, used to balance RULES
                       # optional args: npm run simulate -- <games> <EASY|NORMAL|HARD>
npm run server        # tsx watch server/index.ts — standalone online-play server
npm run start          # tsx server/index.ts (no watch)
```

Run a single test file: `npx vitest run src/game/rules.test.ts`
Run tests matching a name: `npx vitest run -t "overtake"`

There is no lint script; `tsc --noEmit` (strict mode, `noUnusedLocals`/`noUnusedParameters`, `noFallthroughCasesInSwitch`) is the only static check, and it runs as part of `npm run build`.

After changing anything in `src/game/types.ts`'s `RULES`/`DIFFICULTY_RULES` (round count, reveal interval, truck/foot range), re-run `npm run simulate -- <games> <difficulty>` for each affected difficulty and compare against the balance table in `DESIGN.md` — tunable changes are only "done" once the win rate is re-measured.

## Architecture

The rules module knows nothing about the screen; the renderer knows nothing about game rules:

```
keys, taps ──► main.ts (menu, turn flow, AI pacing, HUD)
                  │
         full     │          PublicState           every frame
         state     ▼           (no secret)             ▼
          rules.ts ──────────► ai.ts            renderer.ts (canvas, city, pieces, radar)
          (referee+belief)    (both sides)             │
                  │                │                    │
                  └──────► graph.ts + map.ts ◄──────────┘
                           (nodes, links, distances)
```

Every function in `rules.ts`, `graph.ts`, and `ai.ts` is pure: `(state, input) => newState | answer`. No DOM, no canvas, no `Math.random` (RNG is injected everywhere it's needed), no wall-clock time. `main.ts` is the sole owner of the live `MatchState` and funnels every mutation through one commit point before re-rendering.

### The secret/public split

This is the central mechanic and the thing to protect when editing anything that touches game state:

- `MatchState` (in `src/game/types.ts`) is the full truth, including `hawkerNode` — the hawker's real, secret position.
- `PublicState` is everything both players are allowed to know: round, phase, askari positions, the public trail log, and `belief` — every node consistent with what's been publicly observed.
- `publicView()` in `rules.ts` strips `hawkerNode` **and** three match-only fields that nothing in `ai.ts` needs to plan correctly: `trafficDelay`, `pendingCapture`, and `bailsUsed` (all described below). **Anything feeding the Kanjo AI or the UI's belief overlay must go through `publicView()`, never the raw `MatchState`.** The Kanjo AI (`chooseSquadOrders` in `ai.ts`) only ever receives `PublicState` — it hunts exactly like a human detective would, with no backdoor to the real position. The rule of thumb for any new `MatchState` field: if nothing in `ai.ts`/`PublicState`-typed code reads it, it stays off `PublicState` and gets added to `publicView()`'s strip list — `rules.test.ts` has a "never leaks" test per field, since forgetting the strip is an easy, silent mistake (it happened once already, for `trafficDelay`, caught by that exact test).
- The belief set is advanced by `advanceBelief` in `rules.ts` from only three kinds of public signal: the announced edge type (road vs. alley) of each hawker move, periodic reveals (`RULES.revealEvery`, currently every 3rd round), and askaris stopping somewhere without a catch (which removes that node from the set). `rules.test.ts` and `sim.ts` check over hundreds of simulated games that the real hawker position is always inside the belief set — treat that invariant as load-bearing if you touch `advanceBelief`.
- **Traffic**: a ROAD hawker move (never ALLEY) can roll a jam via `rollTraffic`/`RULES.trafficChance` inside `applyHawkerMove`. When it triggers, `MatchState.trafficDelay` is set and the trail entry is tagged `trafficked: true`; `endKanjoTurn` then keeps `phase: 'KANJO_TURN'` for one extra round (clearing the flag, resetting `moved`) instead of handing back to `HAWKER_TURN` — a bonus round for the squad. `CORNERED` is skipped for that bonus round since the hawker isn't being asked to move. `main.ts`'s `endRound`/`afterRoundEnds` has to re-drive the squad (human or AI) for that extra round itself since `endKanjoTurn` doesn't automatically loop.
- **Bail**: `applyAskariMove` never jumps straight to `GAME_OVER` on a catch — it always pauses in `phase: 'BAIL_DECISION'` with `pendingCapture: { node }` set, and is deliberately wallet-agnostic (it has no idea whether bailing is affordable). `payBail`/`declineBail` in `rules.ts` are the only two ways out of that phase; `payBail` hands the resulting state straight to `endKanjoTurn` rather than duplicating its TIME_UP/CORNERED/traffic logic, so bailing out never accidentally skips the clock or a pending traffic bonus round. Locally the coin/jail-free-card wallet lives **only in `main.ts`**, persisted to `localStorage` under `kanjo-escape:wallet` (JSON, unlike the plain-string `kanjo-escape:muted`/`kanjo-escape:difficulty` keys) — `main.ts` decides eligibility and calls `declineBail` immediately when the wallet can't cover it, so a hawker who never engages with the economy sees no behavior change. Online, the relay owns the authoritative wallet instead (see below). `sim.ts`'s AI-vs-AI loop always auto-declines for the same reason (no wallet exists in a simulated match), which is why adding bail didn't move the balance numbers in `DESIGN.md` at all. Only a human-controlled hawker ever sees the bail prompt — an AI hawker (human playing Kanjo, or an unclaimed online seat) has no wallet and always goes straight to `CAUGHT`.

### Online multiplayer

`?online` in the URL switches `main.ts` into online mode: a lobby lets up to 4 people pick seats (`HAWKER`, `ASKARI_1`, `ASKARI_2`, `ASKARI_3` — mapped 1:1 to the real askari ids from `map.ts`), any unclaimed askari seat is AI-controlled from kickoff, and `server/relay.ts` (`createKanjoEscapeRelay`) is the sole authority: it's the only thing allowed to call `rules.ts`/`ai.ts`, and every client just renders whatever `state` it's sent.

- **Hidden information over the wire is the hard part.** The relay's `stateFor(role)` sends the full `MatchState` to the `HAWKER` seat, `publicView(match)` to every askari seat, and (once `phase === 'GAME_OVER'`) the full state to everyone — there's no fairness reason left to hide it once the match is over, matching local play's own "reveal the hawker's final position" behavior. Broadcasting is always computed per-seat, on purpose: there is deliberately no single shared "broadcast to everyone" helper for `state` messages, since that's exactly the shape of bug that would leak `hawkerNode` to an askari seat by copy-paste. `server/relay.test.ts` is a real end-to-end test (ephemeral HTTP server, real `ws` clients, scripted matches) that asserts this invariant on every message, not just a pure-function check — that class of bug lives in the wiring, not in `rules.ts`.
- **AI fills any unclaimed askari seat.** `progressKanjo()` in the relay lets `chooseSquadOrders`'s `unitIds` filter (added for this) decide only for AI-controlled units, and only once every *other* unmoved unit is also AI-controlled — i.e. AI-controlled askaris always act last in a round, after every human-controlled seat has moved or held. This sidesteps teaching the AI to plan around not-yet-committed human intent.
- **The wallet is relay-owned online, client-owned locally.** The `HAWKER` seat sends its local wallet once (`{type:'wallet', coins, hasJailFreeCard}`) right before readying up, seeding the relay's in-memory copy for that match; the relay then validates/deducts on `bailDecision` and credits escape earnings itself, pushing the updated balance back to the `HAWKER` seat only (never to askari seats) alongside each `state` message. The client writes whatever the relay sends back to `localStorage`, so local and online balances reconcile through the same key. This is trust-on-join, not real accounts — there's no auth anywhere in this monorepo — acceptable for a casual game, not something to build real stakes on top of without revisiting.
- **No mid-match reconnect.** Like matatu-rush, any seat disconnecting mid-match nulls the match and bounces every remaining connection back to the lobby (forcing everyone to re-ready). A match in progress rejects new connections outright.
- `src/net.ts`'s `OnlineClient` is a thin send/receive-JSON wrapper, same shape as matatu-rush's — no game logic lives there. In online mode `main.ts` never calls `applyHawkerMove`/`applyAskariMove`/`payBail`/etc. itself; every mutating action sends intent and waits for the server's `state` echo (see `humanHawkerMove`, `humanAskariMove`, `holdSelected`, `resolveBail`). An askari-seat client's local `match` is a `PublicState` adapted into the `MatchState` shape with placeholder secret fields (`asLocalMatch` in `main.ts`) purely so the rest of the file doesn't need a second code path — safe only because `renderer.ts`'s `showHawker` flag (false whenever `human !== 'HAWKER'`) is the sole gate between a piece's real position and the screen, and that flag is unaffected by the placeholder.
- **Scope cuts worth knowing about**: no local animation tweening for remote-caused moves online (pieces snap to the new state rather than sliding, unlike local play's `renderer.animate()` calls); no "end turn" button online (it hid itself — there's no single action that ends a turn shared across independent askari seats); difficulty can only be set by whoever holds the `HAWKER` seat, pre-match.
- The relay follows the exact `create<Game>Relay(rng?): WebSocketServer` shape matatu-rush's and shillings-stages' relays use — constructed with `{ noServer: true }`, no path filtering inside the relay itself. The caller (this game's own `server/index.ts`, or the root `../server/index.ts`) owns the HTTP server's single `upgrade` event and dispatches by request path (`/ws/kanjo-escape`) to whichever relay matches.

### File map

- **`src/game/types.ts`** — vocabulary (`NodeKind`, `EdgeKind`, `Side`, `MatchState`, `PublicState`, `Outcome`, etc.) and `RULES` (the NORMAL-difficulty tunables: `maxRounds`, `revealEvery`, `truckRange`, `footRange`). `Difficulty` (`'EASY'|'NORMAL'|'HARD'`) and `DIFFICULTY_RULES` hold deltas from that baseline; `rulesFor(difficulty)` in `rules.ts` merges them. The merged result travels on `PublicState.rules`/`MatchState.rules` — every gameplay read of a tunable (`isRevealRound`, `askariOptions`, `endKanjoTurn`, the Kanjo AI's range/coverage math) reads `state.rules.x`, never the bare `RULES` import, so a match's difficulty stays fixed even if concurrent matches (e.g. a future online lobby) run different ones.
- **`src/game/map.ts`** — the city graph: nodes (junction/alley/stage/depot) and edges (road/alley), including the 7 deliberately-closed road segments and the 5 public hawker start points. The only place map geometry lives.
- **`src/game/graph.ts`** — pure graph queries over the map: adjacency, BFS, and per-unit-kind movement legality (trucks: roads only, up to `truckRange`; foot askari: roads or alleys, 1 step; hawker: roads or alleys, 1 step, never through an askari-occupied node). No game state.
- **`src/game/rules.ts`** — the referee: round advancement, legal-move checks, the win-condition checks (`ESCAPED`/`CAUGHT`/`CORNERED`/`TIME_UP`), `publicView()`, and `advanceBelief()`.
- **`src/game/ai.ts`** — scoring AIs for both sides: `chooseHawkerMove` (sees the full truth, since the hawker side has nothing to hide) and `chooseSquadOrders` (sees only `PublicState`/belief — the fairness-critical one).
- **`src/game/sim.ts`** + **`scripts/simulate.ts`** — headless AI-vs-AI match runner. `sim.ts` is imported by `rules.test.ts` for invariant checks; `scripts/simulate.ts` is the standalone 600-game balance script run via `npm run simulate`.
- **`src/renderer.ts`** — draws the city graph, pieces, and the belief-set ("Ujasusi"/intel) radar overlay onto canvas from a `PublicState`/`MatchState` snapshot. Never mutates real state.
- **`src/main.ts`** — the conductor: holds the live `MatchState`, drives async AI turn pacing (with cancellation, since AI "thinking" is animated/delayed for drama), wires keyboard/tap input (`1`/`2`/`3` select a Kanjo unit, `H` hold, `Enter` end turn), and manages the HUD, trail log, end screens, and (when `?online`) the lobby and server-state reconciliation.
- **`src/strings.ts`** — all user-facing copy (Sheng/Swahili) and feedback-code → message mappings. Don't inline UI strings elsewhere.
- **`src/audio.ts`** — synthesizes sound effects (including the reveal whistle) with Web Audio oscillators; no audio asset files.
- **`src/assets/icons/`** — SVGs for hawker, askari, and truck, inlined into the single-file build by `vite-plugin-singlefile`.
- **`src/net.ts`** — `OnlineClient`, the browser-side WebSocket wrapper for online play. No game logic; see "Online multiplayer" above.
- **`server/relay.ts`** — `createKanjoEscapeRelay()`, the authoritative online-play relay (Node, run via `tsx`, not part of the Vite bundle). See "Online multiplayer" above.
- **`server/relay.test.ts`** — end-to-end relay tests: real HTTP server, real `ws` clients, scripted matches. Picked up by the same `npm test`/vitest run as `src/game/rules.test.ts`.
- **`server/index.ts`** — standalone server for running Kanjo Escape's online mode on its own (serves `dist/index.html` + the relay on one port). The root `../server/index.ts` attaches the same relay to its own HTTP server instead, for serving all games from one host.

## Conventions

- `npm run build` inlines everything (code, styles, canvas icon SVGs) into one self-contained `dist/index.html` via `vite-plugin-singlefile` — this is the distributable artifact, shareable or hostable anywhere with no separate asset paths.
- `vite.config.ts` also configures `vitest` (`environment: 'node'`) — tests run via Vite's config, not a separate Jest/vitest config file.
