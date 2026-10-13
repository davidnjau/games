# Matatu Rush: Build It Yourself

A milestone-by-milestone guide to building Matatu Rush from an empty folder. Each milestone teaches one game-development idea, gives you a small, finished thing to build, and ends with a checkpoint so you know it works before moving on.

The finished game in this repo is your **answer key**. Try each milestone on your own first, then compare with the reference file listed at the end of the milestone. Don't copy-paste; the point is to build the muscle.

**How to use this guide**

1. Start a fresh folder, e.g. `matatu-rush-mine/`, next to this repo.
2. Do one milestone per sitting. Most take 1–3 hours.
3. Don't skip checkpoints. A bug in Milestone 3 is cheap; the same bug found in Milestone 9 is not.
4. Commit after every checkpoint (`git commit -m "M3: BFS pathfinding"`), so you can always roll back.

**Milestone map**

| # | Milestone | Big idea you learn | Reference |
| :-- | :-- | :-- | :-- |
| 0 | Set up the garage | Tooling, how a browser game is structured | `package.json`, `vite.config.ts` |
| 1 | Model the city | Data first, pixels later | `src/game/types.ts` |
| 2 | Streets and spikes | Implicit graphs, test-driven rules | `src/game/rules.ts` (graph part) |
| 3 | Finding a route | Breadth-first search, the anti-trapping rule | `src/game/rules.ts` (BFS part) |
| 4 | Driving and overtaking | Immutable state transitions | `src/game/rules.ts` (moves part) |
| 5 | Paint the board | Canvas, coordinate spaces, HiDPI | `src/layout.ts`, `src/renderer.ts` |
| 6 | Bring it to life | The game loop, tweening, easing | `src/renderer.ts`, `src/main.ts` |
| 7 | Hands on the wheel | Input mapping, hover previews, touch | `src/main.ts` (Input) |
| 8 | Rules of the stage | Finite state machine, HUD | `src/main.ts`, `index.html`, `src/style.css` |
| 9 | Juice | Sound synthesis, feedback, polish | `src/audio.ts`, `src/strings.ts` |
| 10 | Ship it | Undo, vehicle select, win screen, build | `src/main.ts`, `vite.config.ts` |
| 11+ | Stretch goals | AI opponent, online play, mobile app | — |

---

## How the finished game fits together

Keep this picture in your head the whole way through. Every milestone fills in one box.

```
           ┌─────────────────────────┐
  keys,    │        main.ts          │   holds the ONE true MatchState,
  taps ───►│  (input → rules → HUD)  │   turns player intent into rule calls
           └──────┬───────────┬──────┘
                  │           │
      pure calls  ▼           ▼  every frame (~60 fps)
           ┌────────────┐  ┌──────────────┐
           │  rules.ts  │  │ renderer.ts  │  draws state; owns only
           │ (no DOM,   │  │ (canvas,     │  animation state
           │  no pixels)│  │  tweens)     │
           └────────────┘  └──────┬───────┘
                                  │ uses
                           ┌──────▼───────┐
                           │  layout.ts   │  cells/grooves ⇄ pixels
                           └──────────────┘
```

The most important design decision in the whole project: **the rules know nothing about the screen, and the screen knows nothing about the rules.** That is why the rules can be unit-tested in milliseconds, and why you could later reuse `rules.ts` unchanged for an AI opponent or an online server.

---

## Milestone 0: Set up the garage

**Big idea.** A browser game is just a web page with a `<canvas>` element and a script that redraws it many times per second. You need three tools:

- **TypeScript**: JavaScript with types. Catches "I passed a pixel where a cell was expected" before you run anything.
- **Vite**: a dev server that reloads the page instantly when you save, and a bundler that builds the final file.
- **Vitest**: a test runner. You'll test the rules without ever opening a browser.

**Build it**

1. `npm init -y`, then `npm i -D typescript vite vitest vite-plugin-singlefile`.
2. Add scripts to `package.json`: `dev`, `build`, `test`, `typecheck`.
3. Create `tsconfig.json` with `"strict": true`. Strict mode is your friend in a game: most bugs are `undefined` sneaking in.
4. Create `index.html` with a `<canvas id="board">` and `<script type="module" src="/src/main.ts">`.
5. In `src/main.ts`, grab the canvas, get its 2D context and draw a yellow square.

**Checkpoint.** `npm run dev` opens a page with a yellow square. Change the colour, save, and the page updates without a manual refresh.

**Reference:** `package.json`, `tsconfig.json`, `vite.config.ts`.

---

## Milestone 1: Model the city

**Big idea.** Before drawing anything, decide what the game *is* as data. If you can describe a full match as a plain object, you can save it, undo it, test it, send it over a network and render it. Beginners usually start with sprites and end up with game logic tangled into drawing code. Don't.

**Build it.** Create `src/game/types.ts` with:

- Constants: `BOARD_SIZE = 9`, `GROOVE_COUNT = 8`, `SPIKES_PER_PLAYER = 10`.
- Types: `VehicleType`, `Orientation`, `PlayerId`, `Position`, `Roadblock`, `Player`, `MatchState`.
- `GamePhase` (`'SELECT_VEHICLES' | 'CHOOSE_ACTION' | 'GAME_OVER'`) and `ActionMode` (`'DRIVE' | 'SPIKES'`).

Compare with blueprint section 2.2. Notice we use `camelCase` (`spikesRemaining`) in code even though the blueprint's JSON used `snake_case`. Pick one and be consistent.

**Think about this before you code.** A roadblock is anchored at a *groove intersection*, not a cell. On a 9×9 board there are 8×8 intersections, so a roadblock's `x` and `y` run from 0 to 7. Draw it on paper:

```
  cell(3,4) │ cell(4,4)
 ───────────┼───────────   ← HORIZONTAL roadblock at (3,4) lies here,
  cell(3,5) │ cell(4,5)       blocking 3,4↔3,5 and 4,4↔4,5
```

**Checkpoint.** `npm run typecheck` passes. You can write `const m: MatchState = {...}` for a starting position by hand without errors.

**Reference:** `src/game/types.ts`.

---

## Milestone 2: Streets and spikes

**Big idea 1: implicit graphs.** The blueprint describes the board as a graph of junctions (nodes) and streets (edges). You *could* store all 144 edges and delete them when spikes drop. Simpler: store nothing. Assume every street between adjacent junctions is open unless a roadblock covers it. "Dropping spikes" becomes just pushing onto an array.

**Big idea 2: test-driven rules.** Game rules are full of edge cases (literally, the board edge). Write the test first, watch it fail, then make it pass.

**Build it.** In `src/game/rules.ts`:

1. Helpers: `samePos`, `addPos`, `inBounds`, `otherPlayer`.
2. `createMatch(p1Vehicle, p2Vehicle): MatchState`. Player 1 starts at (4, 0) and aims for row 8; Player 2 starts at (4, 8) and aims for row 0.
3. `isStreetBlocked(a, b, roadblocks): boolean`. The heart of the graph.
   - Moving up/down between `a` and `b` crosses a horizontal groove at `y = min(a.y, b.y)`. It's blocked if a HORIZONTAL roadblock sits at that `y` with `x === a.x` **or** `x === a.x - 1` (because a roadblock is two cells wide).
   - Moving left/right is the mirror image with VERTICAL roadblocks.
4. `openStreets(from, roadblocks): Position[]`: the up-to-four neighbours you can drive to.

**Tests to write first** (`src/game/rules.test.ts`):

- `createMatch` places drivers correctly with 10 spikes each.
- A HORIZONTAL roadblock at (3, 4) blocks 3,4↔3,5 and 4,4↔4,5 but **not** 5,4↔5,5 and **not** 3,4↔4,4.
- Same idea for VERTICAL.
- `openStreets` from a corner returns 2 positions.

**Checkpoint.** `npm test` is green.

**Reference:** top half of `src/game/rules.ts`, `describe('isStreetBlocked')` in the test file.

---

## Milestone 3: Finding a route

**Big idea: breadth-first search (BFS).** BFS explores a graph in rings: first every junction 1 step away, then every junction 2 steps away, and so on. That has a lovely property: the *first* time you reach the target row, you've found the *shortest* route. You'll use BFS for two things:

1. **The anti-trapping rule** (blueprint 4.1): a spike drop is illegal if it leaves either driver with no route.
2. **"Hatua hadi stage"**: showing each player how far they are from winning. Players love this number, and later an AI will too.

**Build it**

1. `shortestRouteLength(start, targetY, roadblocks): number`. Return the step count, or `-1` if boxed in.
   - Use a queue (an array plus a `head` index; `queue.shift()` is slow on big arrays) and a `Map` from position key to distance.
   - A cheap position key: `y * 9 + x`.
2. `routeStillOpen(...)` is just `shortestRouteLength(...) >= 0`.

**Tests**

- Empty board from (4, 0) to row 8 → 8.
- A HORIZONTAL spike at (3, 0) right under the start → 9 (one step sideways, then 8 down).
- A pocket sealed on all sides → -1.

**Checkpoint.** Tests green. Then try this on paper: place 3 spikes and predict the distance before running the test.

**Gamedev lesson.** Pathfinding is everywhere in games. BFS works for grids where every step costs the same. When steps have different costs (mud, highways), you'd move to Dijkstra or A*. Same skeleton, different queue.

**Reference:** `shortestRouteLength` and `routeStillOpen` in `src/game/rules.ts`.

---

## Milestone 4: Driving and overtaking

**Big idea: immutable state transitions.** Instead of mutating the match (`player.x = 5`), write functions that take a state and return a **new** state:

```ts
const next = applyMove(state, { x: 4, y: 1 });
// `state` is unchanged; `next` is the world after the move.
```

This costs almost nothing and gives you three things for free: undo (keep a list of old states), easy testing (compare before/after), and safety (the renderer can never see a half-updated world).

**Build it**

1. `legalMoves(state): Position[]`. For each direction:
   - Off-board or spiked → skip.
   - Empty junction → legal.
   - Rival is there → **Standard Overtake**: jump to the junction beyond, if it's on the board and not spiked.
   - If the jump is blocked (spikes **or** board edge) → **Corner Drift**: the two junctions to the rival's left and right, each if not spiked.
2. `applyMove(state, to)`: throw if illegal; move the active player; if they reached their stage, set `phase: 'GAME_OVER'` and `winner`; otherwise switch turns.
3. `validateRoadblock(state, rb): SpikeCheck`. Return a *reason* on failure, not just `false`, because the UI wants to say *why* (`NO_SPIKES`, `OUT_OF_BOUNDS`, `OVERLAP`, `GRIDLOCK`).
   - Overlap rules: same anchor point in any orientation (identical or crossing like a "+"), or same orientation shifted by exactly one along its length.
   - Gridlock: add the roadblock to a **copy** of the list, run `routeStillOpen` for **both** drivers.
4. `applyRoadblock(state, rb)`: validate, spend one spike, switch turns.

**Tests:** four moves in open space, edges, jump, corner drift behind spikes, corner drift at the board edge, win detection, each rejection reason. (Twenty tests in the reference file.)

**Checkpoint.** You can play a full game *in a test*: a list of `applyMove`/`applyRoadblock` calls ending with `winner === 1`.

**Gamedev lesson.** Notice you now have a complete, playable game with no graphics at all. Many professional studios build exactly this way, as a "headless" simulation first.

**Reference:** bottom half of `src/game/rules.ts`.

---

## Milestone 5: Paint the board

**Big idea 1: two coordinate spaces.** The rules speak in **cells** (0–8). The canvas speaks in **pixels**. Put every conversion in one small file (`layout.ts`) so neither side has to know about the other.

```
CELL = 56   GAP = 14   PAD = 18   STEP = CELL + GAP
cell (x, y) top-left pixel = (PAD + x·STEP, PAD + y·STEP)
board size = 2·PAD + 9·CELL + 8·GAP = 652 px
```

**Big idea 2: HiDPI.** A phone may have 3 physical pixels per CSS pixel. If your canvas is 652×652 real pixels, it looks blurry. Fix: make the backing store `652 × devicePixelRatio`, then `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` so you can keep drawing in 652-px units.

**Build it**

1. `layout.ts`: `cellOrigin`, `cellCenter`, `roadblockRect` (a strip filling the groove across two cells).
2. `renderer.ts` with a `draw(state)` method that, in order: clears, draws the dark road network, tints each driver's destination row in their colour, draws the 81 junctions, draws roadblocks, draws the two vehicles (use the SVG icons as `Image`s, clipped to a rounded square with a coloured border).

**Painter's algorithm:** whatever you draw last appears on top. Background first, vehicles last.

**Checkpoint.** Hard-code a `MatchState` with a few roadblocks and both vehicles mid-board. It looks right at desktop and phone sizes, and it's sharp on a retina screen.

**Reference:** `src/layout.ts`, `Renderer.draw` and helpers in `src/renderer.ts`.

---

## Milestone 6: Bring it to life

**Big idea: the game loop.** Games don't redraw "when something changes". They redraw **every frame**:

```ts
function frame(now: number) {
  renderer.draw(view, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`requestAnimationFrame` calls you just before the screen refreshes (usually 60 times a second) and passes a high-precision timestamp. Every animation is a function of that time.

**Big idea: the renderer chases the truth.** When a vehicle moves, the rules update its position *instantly*. The renderer remembers where the vehicle was drawn and slides it over 220 ms. That's a **tween**:

```ts
t = clamp((now - start) / DURATION, 0, 1);
k = easeOutCubic(t);              // 1 - (1 - t)^3: fast start, gentle stop
drawX = from.x + (to.x - from.x) * k;
```

**Build it**

1. `renderer.sync(state, now)`: compare the new state with what the renderer last saw; start a tween for any vehicle whose target moved; record a birth time for any new roadblock.
2. In `draw`, compute each vehicle's pixel position from its tween.
3. Make new spikes "pop": scale from 0.6 to 1 with a small overshoot.
4. Pulse the active driver's outline with `Math.sin(now / 200)`.
5. `isAnimating(now)`: true while any tween is running. You'll lock input with it.

**Checkpoint.** Moving a vehicle via a temporary button glides it smoothly; spikes pop in.

**Gamedev lesson.** Keep *simulation* state (rules) and *presentation* state (animations) separate. Mixing them is the classic cause of "the piece is drawn here but the game thinks it's there" bugs.

**Reference:** `sync`, `pawnPixel`, `isAnimating` in `src/renderer.ts`; `frame()` in `src/main.ts`.

---

## Milestone 7: Hands on the wheel

**Big idea: input mapping.** The screen gives you a click in *screen* pixels. Convert to *board* pixels (the canvas is CSS-scaled), then to *game* space (a cell or a groove), then ask the rules.

```ts
const r = canvas.getBoundingClientRect();
boardX = ((e.clientX - r.left) / r.width) * BOARD_PX;
```

**Build it**

1. `pixelToCell(px, py)`: which junction is under the pointer? Split each groove halfway between its two cells so there are no dead zones.
2. `pixelToGroove(px, py)`: snap to the nearest groove intersection, then pick the orientation by comparing distance along x vs y. If the pointer is further out horizontally than vertically, it's lying in a horizontal groove.
3. Use **pointer events** (`pointermove`, `pointerdown`, `pointerleave`), not mouse events: one code path for mouse, pen and touch.
4. In DRIVE mode: highlight legal moves; clicking one calls `applyMove`.
5. In SPIKES mode: on hover, draw a translucent preview. Red if `validateRoadblock` fails, so players see the rule before they break it.
6. **Touch has no hover.** First tap shows the preview; a second tap on the same groove confirms.
7. Keyboard: arrows to drive (try one step, then a straight overtake), `D`/`S` to switch mode, `Z` to undo.
8. Set `touch-action: none` on the canvas so taps don't scroll or zoom the page.

**Checkpoint.** You can play a full hot-seat match with a mouse, then again with only the keyboard. On your phone (`npm run dev -- --host`, open the LAN URL), the two-tap spikes feel natural.

**Reference:** the "Input" section of `src/main.ts`, `pixelToCell` / `pixelToGroove` in `src/layout.ts`.

---

## Milestone 8: Rules of the stage

**Big idea: the finite state machine (FSM).** Blueprint section 3 shows the game as states and transitions. In code, the current state lives in `match.phase` (`SELECT_VEHICLES`, `CHOOSE_ACTION`, `GAME_OVER`) and `match.mode` (`DRIVE`, `SPIKES`). Every input handler starts by asking "is this allowed in the current state?" That one habit prevents a whole class of bugs: double moves during an animation, dropping spikes on the win screen, and so on.

**Build it**

1. A single `commit(next)` function in `main.ts` through which **every** state change flows. It stores the new state, recomputes the legal-move cache, tells the renderer, and re-renders the HUD. One door in, one place to debug.
2. HUD in HTML/CSS around the canvas (text is far easier in the DOM than on a canvas):
   - Turn banner: "Zamu ya Manyanga".
   - A panel per driver: vehicle icon, *Mitego zimebaki* (spikes left, with pips), *Hatua hadi stage* (BFS distance).
   - Action bar: *Dunda*, *Weka spikes*, *Rudi*, with `aria-pressed` showing the active mode.
3. Toasts for refusals, using the reason codes from Milestone 4: "Buda, hapo huwezi!", "Buda, unamfungia kabisa!"

**Checkpoint.** You can't do anything during an animation, spikes button disables at 0, and every refusal shows the right Sheng message.

**Pitfall we hit while building the reference:** an element with the `hidden` attribute is *still visible* if your CSS gives it `display: grid`. The invisible win screen sat on top of everything and swallowed every click. Fix: `[hidden] { display: none !important; }`.

**Reference:** `commit`, `renderHud`, `toast` in `src/main.ts`; `index.html`; `src/style.css`.

---

## Milestone 9: Juice

**Big idea: "juice"** is the game-dev word for feedback that makes actions feel good: sounds, bounces, flashes. The rules don't change, but the game feels twice as good.

**Build it**

1. `audio.ts` using the **Web Audio API**. Every sound is built from oscillators, so you need no audio files yet:
   - Horn: two square waves (415 Hz + 523 Hz), played twice.
   - Spikes: a falling triangle "thud" plus a short metallic ping.
   - Error: a descending sawtooth buzz.
   - Victory: a rising arpeggio, then the horn.
   - Each tone needs an **envelope** (quick ramp up, exponential fade down) or you'll hear clicks.
2. Browsers block audio until the user interacts, so create/resume the `AudioContext` inside a click handler (`sound.unlock()`).
3. A mute toggle, remembered in `localStorage`. Wrap storage in `try/catch`: private windows can throw.
4. Put every player-facing word in `strings.ts`. Translation, or an English mode, becomes a one-file job.
5. Respect `prefers-reduced-motion`: turn off pulsing for players who've asked for less motion.

**Checkpoint.** Close your eyes and play a turn. Can you tell by sound alone whether you moved, dropped spikes or made an illegal move?

**Stretch:** replace the synth with real recordings from the blueprint (a matatu horn, "Aha! Hapo kimeumana!", a crowd shouting "Wabebee!", a looping Gengetone beat). Load them with `fetch` + `decodeAudioData`.

**Reference:** `src/audio.ts`, `src/strings.ts`.

---

## Milestone 10: Ship it

**Build it**

1. **Undo** (`Rudi`): because state is immutable, undo is just `match = history.pop()`. Push the old state inside `commit`. Mode switches don't get recorded; only real moves do.
2. **Vehicle select** overlay: each driver picks Manyanga, Chapaa or Uber. If both pick the same ride, label them "Manyanga 1" and "Manyanga 2".
3. **Win screen**: wait until the winning move's animation finishes (`!renderer.isAnimating(now)`), then show *Umecheza kama wewe!* with *Cheza tena* (same rides) and *Badilisha gari* (back to select).
4. **Build**: `npm run build` uses `vite-plugin-singlefile` to produce **one** `dist/index.html` with code, styles and icons inlined (about 33 kB). You can email it, drop it on any static host, or open it straight from disk.

**Checkpoint (the real one).** Hand your phone to a friend, explain nothing, and watch them play. Every moment they hesitate is a UX bug to fix.

**Reference:** `undo`, `renderPickers`, `showWin` in `src/main.ts`; `vite.config.ts`.

---

## Milestone 11+: Stretch goals

Pick whichever excites you. Each is a self-contained project that builds on the clean rules engine.

**A. Computer opponent ("Dereva AI").** Classic approach: **minimax with alpha-beta pruning**. Score a position as `rivalDistance − myDistance` using your BFS from Milestone 3. Generate candidate moves (legal drives plus a shortlist of roadblocks near the rival's shortest path), search 2–3 turns ahead. Because `rules.ts` is pure, the AI can simulate thousands of futures without touching the screen. Add difficulty levels by changing search depth.

**B. Online multiplayer.** The match state is a small JSON object, perfect for the network. Send *actions* (`{type: 'MOVE', to}`) to a server that runs the same `rules.ts`, validates them and broadcasts the new state. Never trust the client.

**C. Top-down pawn sprites.** The side-view icons work as tokens, but top-down vehicles that rotate to face their direction of travel would read better on the grid.

**D. Mobile app.** Wrap the build in Capacitor for Android/iOS, or port `rules.ts` to Kotlin and render it with Compose Multiplatform. The tests translate almost line for line.

**E. Game feel round two.** Screen shake on a gridlock refusal, a "near miss" sound when a driver is 1 step from winning, a short replay of the final moves on the win screen.

---

## Project file map

```
matatu-rush/
├── index.html               page shell: canvas, HUD, overlays
├── GUIDE.md                 this guide
├── docs/
│   └── matatu-rush-blueprint.md
├── src/
│   ├── main.ts              conductor: state, input, HUD, game loop
│   ├── renderer.ts          canvas drawing + animation state
│   ├── layout.ts            cell/groove ⇄ pixel conversions
│   ├── audio.ts             Web Audio sound effects
│   ├── strings.ts           all Sheng UI copy
│   ├── style.css            HUD and overlay styling
│   ├── assets/icons/        manyanga.svg, chapaa.svg, cab.svg
│   └── game/
│       ├── types.ts         the game's vocabulary
│       ├── rules.ts         pure rules engine
│       └── rules.test.ts    20 rule tests
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Commands

| Command | What it does |
| :-- | :-- |
| `npm install` | Install tools (once) |
| `npm run dev` | Dev server with instant reload |
| `npm run dev -- --host` | Same, reachable from your phone on the same Wi-Fi |
| `npm test` | Run the rule tests |
| `npm run typecheck` | Type-check without building |
| `npm run build` | Produce the single-file `dist/index.html` |

## Glossary

| Term | Meaning |
| :-- | :-- |
| Junction | A cell on the 9×9 board where a vehicle can stand |
| Groove | The gap between junctions where Kanjo Spikes are dropped |
| Stage | A driver's destination row |
| BFS | Breadth-first search: explores a graph in rings of equal distance |
| FSM | Finite state machine: the game is always in exactly one named phase |
| Tween | An animation that interpolates a value from A to B over time |
| Easing | A curve that shapes a tween's speed (e.g. fast start, soft stop) |
| Juice | Feedback (sound, motion) that makes actions feel satisfying |
| Hot seat | Two players sharing one device, taking turns |
