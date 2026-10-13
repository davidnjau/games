# Kanjo Escape: Build It Yourself

A milestone guide to rebuilding Kanjo Escape. Matatu Rush taught you the basics: data first, pure rules, canvas, the game loop, input. This game adds the ideas that make many strategy games tick:

- maps that are **graphs**, not grids
- **hidden information**: one player knows things the other doesn't
- **deduction**: tracking what the other side can logically work out
- **computer opponents** that score options, including one that must play fair without seeing the truth
- **balancing** a game by simulating hundreds of matches

The finished game in this repo is your answer key. Do each milestone yourself, pass its checkpoint, commit, then compare with the reference file.

Read `DESIGN.md` first. It's the rulebook, and it explains every change from the original playthrough log.

**Milestone map**

| # | Milestone | Big idea | Reference |
| :-- | :-- | :-- | :-- |
| 0 | Set up | Reuse your Matatu Rush tooling | `package.json`, `vite.config.ts` |
| 1 | The city as data | Graphs, adjacency lists, maps as data | `src/game/map.ts`, `graph.ts` |
| 2 | Who can go where | Movement rules, range-limited BFS, paths | `graph.ts`, `askariOptions` in `rules.ts` |
| 3 | Two versions of the truth | Secret state vs public state | `types.ts`, `publicView` in `rules.ts` |
| 4 | Thinking like a detective | The belief set, invariants | `advanceBelief` in `rules.ts` |
| 5 | A full match with no screen | Round loop, win checks, headless simulation | `rules.ts`, `sim.ts` |
| 6 | A hawker that thinks | Scoring (utility) AI, threat maps | `chooseHawkerMove` in `ai.ts` |
| 7 | A squad that plays fair | Planning under uncertainty, joint search | `chooseSquadOrders` in `ai.ts` |
| 8 | Balance by simulation | Measure, change one thing, measure again | `scripts/simulate.ts` |
| 9 | Draw the city | Map units vs pixels, hit-testing a graph | `src/renderer.ts` |
| 10 | Pacing and drama | Async AI turns, cancellation, reveal radar, synth whistle | `src/main.ts`, `src/audio.ts` |
| 11 | Ship it | HUD, trail log, end screens, single-file build | `main.ts`, `index.html`, `style.css` |
| 12+ | Stretch goals | Loads, difficulty, pass-and-play, online | — |

---

## How it fits together

```
                ┌──────────────────────────────┐
  taps, keys ──►│           main.ts            │  menu, turn flow, AI pacing, HUD
                └──┬──────────┬────────────┬───┘
                   │          │            │
          full     │          │ PublicState│ every frame
          state    ▼          ▼  (no secret)▼
           ┌───────────┐ ┌─────────┐ ┌─────────────┐
           │ rules.ts  │ │  ai.ts  │ │ renderer.ts │
           │ referee   │ │ both    │ │ city, pieces│
           │ + belief  │ │ sides   │ │ radar       │
           └─────┬─────┘ └────┬────┘ └─────────────┘
                 │ uses       │ uses
           ┌─────▼────────────▼─────┐
           │  graph.ts  +  map.ts   │  nodes, links, distances
           └────────────────────────┘
```

The rule that matters most in this project: **the Kanjo AI only ever receives `PublicState`**, a type with the hawker's position removed. It *can't* cheat, because the information isn't there to cheat with.

---

## Milestone 0: Set up

Copy your Matatu Rush `package.json`, `tsconfig.json` and `vite.config.ts`. Add a `simulate` script: `"simulate": "vite-node scripts/simulate.ts"` (`vite-node` comes with Vitest). Set `"target": "ES2022"` in `tsconfig.json` so you can use `array.at(-1)`.

**Checkpoint.** `npm run dev` shows a blank page with no console errors; `npm test` runs (zero tests is fine).

---

## Milestone 1: The city as data

**Big idea.** Matatu Rush's board was a grid, so neighbours were just `x ± 1, y ± 1`. A city isn't a grid: some roads are closed, alleys cut diagonally through blocks, stages hang off the edges. So store the map as a **graph**: a list of nodes and a list of links (edges). Then build an **adjacency list**, a lookup from each node to its neighbours, once at startup, so "who's next to me?" is instant.

**Build it**

1. In `types.ts`: `NodeKind` (`JUNCTION | ALLEY | STAGE | DEPOT`), `EdgeKind` (`ROAD | ALLEY`), `MapNode {id, kind, x, y, label}`, `MapEdge {a, b, kind}`.
2. In `map.ts`, **generate** the junction grid from two lists, streets (columns) and roads (rows), instead of typing 42 nodes by hand. Junction ids like `moi-kenyatta`.
3. Add a `CLOSED_ROADS` list and skip those pairs while generating road links.
4. Add alleys and stages as small hand-written lists, each with the junctions it links to.
5. In `graph.ts`, build `ADJ: Record<NodeId, Link[]>` by walking `EDGES` once (each edge goes into **both** ends' lists).

**Tests:** every edge points at real nodes; alleys only use ALLEY links; stages only ROAD links.

**Checkpoint.** `links('moi-ronald')` returns what you expect when you trace it on paper.

**Gamedev lesson.** Keeping the map as data means a level designer (you, later) can redesign the city without touching any logic. Many games load maps from JSON for exactly this reason.

---

## Milestone 2: Who can go where

**Big idea.** Different pieces have different movement rules on the same graph. Express each rule as a tiny function, then let one BFS do the work.

**Build it**

1. `hawkerCanEnter(node)`: anything but the depot.
2. `askariCanEnter(kind, node)`: never a stage; trucks never an alley.
3. `askariCanUse(kind, edgeKind)`: trucks roads only; foot anything.
4. `bfs(from, canStep)`: a general BFS that takes the rule as a function. Reuse it everywhere.
5. `askariOptions(state, unitId)`: a **range-limited** BFS: expand the frontier `range` times (2 for trucks, 1 on foot), never through another askari. Record each node's **parent** so you can rebuild the path the truck drives. You'll animate along it in Milestone 10.
6. Precompute `STAGE_DISTANCE` with a **multi-source BFS**: put all four stages in the queue at once, and every node ends up labelled with its distance to the *nearest* stage. One pass instead of four.

**Tests:** a truck can't enter an alley or pass through the foot askari; the foot askari has exactly its 1-step neighbours, alleys included.

**Checkpoint.** Log `askariOptions` for each unit at the start position and check them on paper.

---

## Milestone 3: Two versions of the truth

**Big idea.** A hidden-information game has a **true state** and a **public state**. Model this in the types so mistakes become compile errors:

```ts
interface PublicState { round; phase; askaris; belief; trail; lastSeen; outcome }
interface MatchState extends PublicState { hawkerNode }   // the secret
```

`publicView(state)` strips the secret. Anything acting for the Kanjo side gets a `PublicState` and nothing else.

**Build it**

1. The two interfaces above.
2. `TrailEntry {round, via, revealedAt}`, the public chase log. Every hawker move adds one row: always the link type, and the node only on reveal rounds.
3. `createMatch(rng)`: pick the secret start from the public list of start points. Pass `rng` in instead of calling `Math.random()` directly; you'll need reproducible games in Milestone 5.

**Test:** `'hawkerNode' in publicView(match)` is `false`.

**Gamedev lesson.** Online games use this exact split. The server keeps the true state and sends each player only their view. Players who receive data they shouldn't see will find it, so you never send it.

---

## Milestone 4: Thinking like a detective

**Big idea: the belief set.** Instead of guessing where the hawker is, compute *every* node they could be on, given only what's public. This is the heart of the game:

| Event | Belief update |
| :-- | :-- |
| Match starts | The public start points |
| Hawker moves by road | Every node one ROAD link away from a current candidate (no stages, no depot, no askaris) |
| Hawker moves by alley | Same, ALLEY links only |
| Reveal | Just the revealed node |
| Askari stops on a node, no catch | Remove that node |

**Build it**

1. `advanceBelief(belief, via, askaris)`: the move rule above.
2. Wire all five updates into `applyHawkerMove` and `applyAskariMove`.

**The invariant test (write it!).** The true hawker node must *always* be in the belief set. If it ever isn't, your deduction is wrong, and the AI will hunt in the wrong place forever. You'll check this across hundreds of games in the next milestone.

**Checkpoint.** On paper: start with 5 candidates, announce "alley", and predict the new set before running the code.

**Gamedev lesson.** This is a tiny version of what poker bots, card-game AIs and fog-of-war strategy AIs do: reason over the set of possible worlds, not the real one.

---

## Milestone 5: A full match with no screen

**Build it**

1. `hawkerMoves`, `applyHawkerMove` (stage = escaped; reveal rounds collapse the belief), `applyAskariMove` (stop on hawker = caught), `holdAskari`, `endKanjoTurn` (time up, cornered, or next round).
2. `mulberry32(seed)`: a seedable random number generator. Same seed, same game, every time. Essential for debugging AI games ("seed 412 crashes" is reproducible; "it crashed once" isn't).
3. `sim.ts`: `simulateMatch(seed, onState?)` plays AI vs AI to the end. Until you write the AIs, plug in "pick the first legal move".
4. The invariant test: run 300 seeds and, on every state, assert `belief.includes(hawkerNode)`.

**Checkpoint.** Every simulated game ends with an outcome, and the invariant holds.

---

## Milestone 6: A hawker that thinks

**Big idea: scoring AI** (also called utility AI). List every option, give each a number, take the best. Simple, fast, easy to tune, and the backbone of a surprising number of shipped games.

**Build it.** `chooseHawkerMove(state, rng)`:

1. A stage is adjacent? Take it.
2. Build a **threat map**: every node any askari could reach on their next turn (reuse `askariOptions`).
3. Score each move:
   - big penalty if it's in the threat map (bigger on a reveal round, because they'll *know*)
   - penalty per step to the nearest stage (BFS that routes around askaris)
   - small bonus for safe onward exits (avoid dead ends)
   - bonus for alleys (trucks can't follow, and it hides your route)
   - a little `rng()` noise so it isn't predictable
4. Return the highest score.

**Checkpoint.** In simulation the hawker sometimes escapes and sometimes gets caught, never 0% or 100%.

---

## Milestone 7: A squad that plays fair

**Big idea: planning under uncertainty.** The Kanjo AI doesn't know where the hawker is; it knows the belief set. So it plans the move that's best *on average over all places the hawker might be*.

**Build it.** `chooseSquadOrders(pub, rng)`, taking `PublicState` only:

1. `reachTime(unit, node)`: rounds for this unit to get there (trucks: road distance ÷ 2, rounded up; for alleys, distance to the alley mouth).
2. `urgency(node)`: candidates near a stage matter more (the hawker could escape next turn).
3. `coverage(units, belief)`: sum of `urgency × fastest reachTime` over the belief. **Lower is better.**
4. **Joint search.** Try every combination of moves for the three units (each can hold or go). About 12 × 5 × 12 options, a few hundred combos, which is trivial for a computer. For each: skip if two units end on one node, add a catch bonus for landing on candidate nodes (weighted by urgency), remove those nodes from the belief, score the coverage.
5. `orderSafely`: units can't drive through each other, so try orderings until every move is legal in sequence.

**The fairness test.** Make two states with the same public info but a *different* secret hawker position. The AI must give identical orders for both (same seed). If it doesn't, it's cheating.

**Gamedev lesson.** Searching all combinations is called brute force, and it's fine when the numbers are small. When they aren't (more units, longer lookahead), games switch to greedy search, beam search, or Monte Carlo methods.

---

## Milestone 8: Balance by simulation

**Big idea.** Your intuition about whether a game is fair is usually wrong. Measure it. `scripts/simulate.ts` plays 600 seeded games and prints the hawker win rate, average length and how games ended.

**Do this exercise** (it's exactly what happened while building the reference):

1. Start with a 5×6 grid of streets, two entrances per stage, hawker starting near the middle. Simulate.
2. Read the numbers. The real result was a 70% hawker win rate in 1.7 rounds: starts were too close to the exits.
3. Change **one thing** (stage entrances, map size, start points, reveal interval), re-run, and write the result in a table.
4. Keep going until hawker wins land between 45% and 55% and games last long enough for at least one reveal.

See the balance table in `DESIGN.md` for the real path from 70% to 47.5%.

**Pitfalls**

- Changing two things at once tells you nothing about either.
- AI-vs-AI balance isn't human balance. It's a starting point; play-test with people next.
- Watch *why* games end, not just who wins. "Squad wins 80%, mostly by camping entrances" points straight at the fix.

---

## Milestone 9: Draw the city

**Big idea.** Nodes have positions in **map units** (2 units between streets). The renderer converts with one pair of functions, `toPx` and `toMap`. The rules never see pixels.

**Build it** (painter's order, back to front):

1. Ground, then **city blocks** (rounded rects between streets).
2. Roads: one wide stroke per ROAD link, then a dashed lane line on top.
3. Alleys: thin dashed amber strokes.
4. Nodes: junction dots, alley diamonds, stage and depot pills with labels.
5. Highlights: dashed pulsing rings on legal destinations.
6. Intel: a **?** badge on every belief node.
7. "Last seen" ghost of the hawker at the last revealed spot.
8. Pieces: hawker (only when the human *is* the hawker, during a reveal, or at game over), then askaris.

**Hit-testing a graph.** There are no grid cells to floor() into. Convert the tap to map units and pick the nearest node within a radius (larger for stage pills).

**Checkpoint.** The whole city draws crisply at desktop and phone widths, and tapping near any node reports the right label under the map.

---

## Milestone 10: Pacing and drama

**Big idea 1: AI turns need pacing.** The AI decides in a millisecond, but if all three askaris jump at once the player can't follow what happened. Use `async`/`await` with small waits between steps:

```ts
async function kanjoAiTurn(token: number) {
  for (const order of chooseSquadOrders(publicView(match))) {
    if (token !== gameToken) return;   // player went back to the menu: stop!
    moveAskari(order.unitId, order.to);
    await wait(560);
  }
}
```

**Big idea 2: cancellation tokens.** If the player hits *Menu kuu* mid-turn, old timers will keep firing into the new game. Bump a `gameToken` on every new game and have every async step check it.

**Build it**

1. A `busy` flag: input is ignored while the AI acts or a reveal plays.
2. Path tweens: trucks slide junction by junction along the path from `askariOptions`.
3. The reveal: expanding orange radar rings at the hawker's position, a "Wale wale!" toast, and a whistle.
4. The whistle in Web Audio: a high sine tone whose pitch is wobbled 28 times a second by a second oscillator (an **LFO**). That's what makes a pea whistle trill.
5. Miss feedback: a ring pulse where an askari stops, so the Kanjo player sees "not here".

---

## Milestone 11: Ship it

1. **Menu**: choose a side. Short Swahili rules.
2. **Dossier panel**: status line, round clock, rounds until the next reveal, the 15-cell **trail log** (road, alley, or orange when seen), the squad list with keyboard shortcuts 1/2/3, *Baki hapo* (hold) and *Maliza zamu* (end turn).
3. **Ujasusi** toggle for the belief overlay.
4. **End screen**, written from the human's point of view: *UMECHAPA ESCAPE!*, *UMESHIKWA!*, *UMEMSHIKA!* and so on.
5. On phones, let the status line jump above the map (`display: contents` on the side panel plus `order: -1`).
6. `npm run build`: one self-contained `dist/index.html`.

**Pitfall carried over from Matatu Rush:** `[hidden] { display: none !important; }` or your hidden overlays will swallow clicks.

**Checkpoint.** Play five games as each side. Note every moment you were confused about what the computer did. Each one is a pacing or feedback fix.

---

## Milestone 12+: Stretch goals

**A. Inventory loads** (from the original log). Before the match the hawker picks a load: LIGHT (2 steps per turn, no alleys), MEDIUM (the current rules) or HEAVY (1 step, alleys, but worth double "points"). Re-balance with the simulator.

**B. Difficulty levels.** Easy Kanjo ignores urgency and adds more noise; hard Kanjo looks two rounds ahead. Easy hawker forgets the threat map half the time.

**C. Pass-and-play.** Two humans on one phone: a cover screen ("Mpe simu Kanjo") between turns so the hawker's move stays secret.

**D. Smarter deduction display.** Shade belief nodes by probability instead of a flat "?". The hawker AI's preferences give you a likelihood for each candidate.

**E. Monte Carlo Kanjo.** Sample 200 possible hawker positions from the belief, simulate each a few rounds ahead with the hawker AI, and pick the squad move that catches most often.

**F. Online play.** The `PublicState` split is already the hard part. The server keeps `MatchState` and sends the hawker the full state and the squad `publicView`.

---

## Files

```
kanjo-escape/
├── DESIGN.md              the rulebook + why it differs from the log
├── GUIDE.md               this guide
├── docs/playthrough-log.md
├── scripts/simulate.ts    balance runner
├── src/
│   ├── main.ts            menu, turn flow, AI pacing, input, HUD
│   ├── renderer.ts        city, pieces, radar, hit-testing
│   ├── audio.ts           whistle, engine, siren, escape fanfare
│   ├── strings.ts         all Swahili/Sheng copy
│   ├── style.css
│   ├── assets/icons/      hawker.svg, truck.svg, askari.svg
│   └── game/
│       ├── types.ts       vocabulary + RULES numbers
│       ├── map.ts         the CBD graph
│       ├── graph.ts       adjacency, permissions, BFS, distances
│       ├── rules.ts       referee + belief set
│       ├── ai.ts          hawker AI, Kanjo AI, seeded RNG
│       ├── sim.ts         headless AI-vs-AI match
│       └── rules.test.ts  21 tests, incl. deduction and fairness invariants
└── index.html
```

## Commands

| Command | What it does |
| :-- | :-- |
| `npm install` | Install tools (once) |
| `npm run dev` | Dev server with instant reload |
| `npm test` | Rules, deduction and AI tests |
| `npm run simulate` | 600 AI-vs-AI games, prints balance |
| `npm run simulate -- 2000` | Same with more games |
| `npm run build` | Single-file `dist/index.html` |
