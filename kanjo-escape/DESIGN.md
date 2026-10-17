# Kanjo Escape: Game Design

This is the rulebook the code implements. It starts from `docs/playthrough-log.md` and fills the gaps that log left open. Every change from the log is listed at the end with the reason.

## Premise

A hawker carrying a full load of goods has to get out of Nairobi's CBD through one of four matatu stages. The Kanjo (county enforcement) squad hunts them with two pickup trucks and one askari on foot. The hawker moves in secret; the squad only learns *how* the hawker moved each round, and sees them every third round when the whistle blows.

One human plays one side; the computer plays the other.

## The city

A graph of **nodes** joined by **links**.

| Node | Count | Who can enter |
| :-- | :-- | :-- |
| Junction (street crossing) | 42 (6 streets × 7 roads) | Everyone |
| Alley (narrow cut-through) | 14 | Hawker, foot askari |
| Stage (exit) | 4: Khoja, Archives, Railways, Odeon | Hawker only |
| Depot (Kanjo HQ, Machakos) | 1 | Askaris only |

| Link | Joins | Who can use it |
| :-- | :-- | :-- |
| Road | junction–junction, junction–stage, junction–depot | Everyone |
| Alley | alley–junction | Hawker, foot askari |

Seven road segments are closed to break the grid. Each stage has two entrance junctions. Map data lives in `src/game/map.ts`.

## Setup

- The hawker secretly starts on one of five public start points: Latema/River, Accra/Ronald Ngala, Gaberone Rd alley, Moi/River, Accra/Murang'a. Both players know the list; only the hawker knows the pick.
- **askari_1** (pickup) at Tom Mboya / Haile Selassie, **askari_2** (on foot) at Tom Mboya / Ronald Ngala, **askari_3** (pickup) at Kanjo HQ.

## A round

1. **Hawker moves** exactly one link, to any node it may enter that has no askari on it. Moving is compulsory.
   - Entering a stage wins immediately.
   - The move is secret, but the link type (road or alley) is announced and written in the public trail log.
   - **Reveal ("Wale wale!")**: on rounds 3, 6, 9, 12 and 15, the hawker's new position is shown to everyone after the move.
2. **Squad moves.** Each askari either moves or holds, in any order.
   - Pickup: up to 2 road links. Never into an alley or a stage.
   - On foot: 1 link, road or alley. Never into a stage.
   - No askari may pass through or stop on another askari.
   - Stopping on the hawker's node is a **catch**. Driving *through* it is not.
3. **End of round.** If round 15 has ended, the squad wins. If the hawker has no legal move at the start of their turn, the squad wins.

## Winning

| Result | Winner | When |
| :-- | :-- | :-- |
| Escaped | Hawker | Hawker enters any stage |
| Caught | Kanjo | An askari stops on the hawker |
| Cornered | Kanjo | Hawker starts a turn with no legal move |
| Time up | Kanjo | Round 15 ends with the hawker still in the CBD |

## Deduction (the belief set)

The game tracks every node the hawker *could* be on, using only public information:

- Start: the five public start points.
- After a hawker move by link type T: every node reachable from a current candidate by a T link, excluding stages, the depot and squad-occupied nodes.
- On a reveal: just the revealed node.
- After an askari stops somewhere without a catch: remove that node.

This set is shown as **?** markers when **Ujasusi** (intel) is on, and it is the only thing the Kanjo AI plans with. A test checks over 300 simulated games that the real position is always inside it.

## Balance

Measured with `npm run simulate` (600 AI-vs-AI games):

| Version | Hawker wins | Avg rounds | Problem |
| :-- | :-- | :-- | :-- |
| 5×6 map, 2-entry stages | 70% | 1.7 | Hawker starts too close to exits |
| 5×6, 1-entry stages | 21–31% | 4.0 | Squad camps the entrances |
| 6×7, 1-entry stages | 20% | 4.9 | Same |
| **6×7, 2-entry stages, reveal every 3** | **47.5%** | **4.2** | Shipped |

A match is short and tense: four or five rounds on average. The reveal interval was changed from 4 to 3 because, with matches that short, a round-4 reveal often never happened.

### Traffic

A ROAD move (never an alley — too narrow for this to make sense) has a small chance of jamming. When it does, the hawker's trail entry is tagged `trafficked`, and `endKanjoTurn` keeps the match in `KANJO_TURN` for one extra round instead of handing back to the hawker — a free round for the squad to close in. CORNERED is suppressed for that bonus round (the hawker isn't being asked to move, so being boxed in doesn't count yet); TIME_UP still takes priority if the clock is already up. The raw "am I delayed" flag stays off `PublicState` — the squad already gets the bonus round regardless, so there's nothing useful the fact itself would add to the Kanjo AI's planning.

### Difficulty levels

The table above is NORMAL. EASY and HARD apply deltas (`DIFFICULTY_RULES` in `types.ts`) on top of it, picked from the menu before a match starts and carried on `MatchState.rules` for the rest of that match:

| Difficulty | revealEvery | truckRange | trafficChance | Hawker wins (3000 games) | Avg rounds |
| :-- | :-- | :-- | :-- | :-- | :-- |
| EASY | 4 | 2 | 3% | 44.9% | 4.3 |
| NORMAL | 3 | 2 | 8% | 42.2% | 4.1 |
| HARD | 2 | 3 | 16% | 37.7% | 2.8 |

HARD's shorter reveal interval, wider truck range, and higher traffic chance all shrink the hawker's window to run, which shows up as a much faster average match in addition to a lower win rate. Traffic's own chance was tuned down from an initial 18%/8%/30% guess — that dropped NORMAL's hawker win rate by ~6–8pp on its own, more swing than intended for adding one new mechanic to an already-tuned baseline. The current 3%/8%/16% spread nudges each difficulty by a few points without overhauling it.

### Bail, coins, and the jail-free card

A catch no longer ends the match outright. `applyAskariMove` always pauses in a new `BAIL_DECISION` phase with the capture node recorded — it's deliberately wallet-agnostic, so it can't decide on its own whether bailing is even an option. That decision belongs to `main.ts`, which tracks a small persistent wallet (`{ coins, hasJailFreeCard }`, saved under `kanjo-escape:wallet` in `localStorage`, never inside `MatchState`) and either shows a bail prompt or auto-declines on the hawker's behalf when they can't afford it — so a hawker who never buys in sees zero behavior change from before this feature existed.

- **Earning coins**: reaching a stage pays `escapeCoinsBase + max(0, maxRounds − round) × escapeCoinsPerRound` — escaping early pays more than limping across the line on the last possible round.
- **Paying bail**: costs `bailCostBase × (bailsUsed + 1)` — it escalates within a match so repeated bailouts get more expensive, not free insurance.
- **The jail-free card**: a one-time, non-stacking pass bought from the menu for a flat `jailFreeCardCost` coins; using it substitutes for the coin cost on the next catch.
- Paying bail resumes play via `payBail`, which hands the same state straight to `endKanjoTurn` — so a bail on the final round still loses to TIME_UP, and a bail that lands mid-traffic-delay still gives the squad their bonus round. No separate code path duplicates those rules.
- **AI-vs-AI simulation is unaffected**: `sim.ts` always auto-declines a `BAIL_DECISION` (there's no wallet to spend in a simulated match), which reproduces the exact pre-bail CAUGHT behavior — confirmed by re-running `npm run simulate` and getting identical numbers to the traffic-only baseline above.
- **Scope cut**: only a human-controlled hawker ever sees a bail prompt. An AI-controlled hawker (i.e. a human playing Kanjo) has no wallet in v1 and always goes straight to CAUGHT on a catch.

### Online multiplayer

The hawker vs. 3-truck-squad design generalizes naturally to multiple humans: `?online` opens a lobby where up to 4 people claim the `HAWKER` seat and the 3 askari seats; anyone who doesn't claim a seat is simply played by the same AI that plays local matches, acting last in the round once every human-controlled unit has moved. `server/relay.ts` is the sole authority — it owns the RNG (hawker start pick, traffic rolls) and validates every move with the same `rules.ts` functions used locally, so an online match's outcome follows exactly the same rules as a local one at whatever difficulty the hawker seat picked in the lobby.

The one thing online play can't fully replicate is a trusted wallet: there's no account system anywhere in this monorepo, so the relay seeds a match's coin balance from whatever the hawker's client claims on joining, then is authoritative for the rest of that match (bail costs, escape earnings) and syncs the result back to the client's `localStorage`. This is good enough for a casual game between friends; it is not a basis for anything with real stakes.

See `server/relay.test.ts` for the actual proof this works — three scripted end-to-end matches (solo hawker vs. full AI squad, hawker + 1 human askari, hawker + 2 human askaris with the third AI-filled) run against a real relay over a real WebSocket, asserting on every single message that an askari seat never receives `hawkerNode` until the match is over.

## Changes from the playthrough log

| Log | This design | Why |
| :-- | :-- | :-- |
| No catch rule; landing on an askari triggers a Standard Overtake jump | Hawker can't step onto an askari; an askari stopping on the hawker catches them | Without a catch rule the squad can never win. The overtake rule belongs to Matatu Rush. |
| No squad win condition | Caught, Cornered, or Time up after round 15 | Gives the squad a goal and a clock. |
| Two exits (Archives, Khoja) | Four exits, each with two entrances; askaris may not enter stages | With 2 exits, 3 askaris can block both forever. |
| Reveal when `turn % 4 === 0`, before the hawker moves | Reveal after the hawker moves on rounds 3, 6, 9… | A reveal before the move is already stale when the squad acts. Short matches needed a sooner reveal. |
| Map described only by node names | Full graph in `map.ts` | The log's geography was self-contradictory (e.g. askari_2 "moves" onto its own start). |
| `MEDIUM_LOAD` inventory | Fixed: one step per turn, alleys allowed | Kept simple for v1. Load choice is a stretch goal in GUIDE.md. |
| "Kanjo player blindly moves" | Kanjo sees link type each round, plus an optional intel overlay | Pure guessing isn't fun; deduction is. |
