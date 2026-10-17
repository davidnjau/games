# Choma Tycoon: Nairobi Street Food Challenge

A fast-paced arcade order-matching game. Run a Nairobi street food cart — serve Mayai Pasua, Smokie Pasua, Combo Plate, Mahindi Choma and Mutura to a stream of customers before their patience runs out, and don't get caught by a Kanjo raid.

Built with TypeScript + Vite. No game engine, no framework — the UI is plain DOM/CSS (patience bars, order bubbles and a hold-to-confirm button are naturally DOM elements).

```bash
npm install
npm run dev        # play
npm test           # 21 rule tests
```

## How to play

- Tap a customer to select them, then tap ingredients in the order their order bubble shows.
- Get one wrong and the tray resets — "Mchanganyiko mbaya!"
- Once the tray matches exactly, hit **Leta Hiyo!** to serve. Serving adds +3s to the clock.
- Each customer has a patience bar. Let it run out and they leave angry — you lose points.
- The game gets harder as your score climbs: faster spawns, shorter patience, trickier orders (Combo Plate, sauce add-ons).
- Every 30–45 seconds: **KANJO WANAJA!** Press and hold **PACK UP & HIDE** for a continuous 3 seconds before the siren stops, or you're fined.

## Architecture

Same split as the other games in this repo: `src/game/rules.ts` is pure state transitions (no DOM, no `Math.random`, no wall-clock time) — the renderer is the only thing that touches the page.

- **`src/game/types.ts`** — vocabulary and tunables (`RULES`).
- **`src/game/rules.ts`** — `createGame` / `tick(state, dtMs, rng, holding)` / `selectCustomer` / `addIngredient` / `clearTray` / `serve`. The Kanjo raid is a small state machine (`NONE → WARNING → HIDING → NONE`) living inside `tick`.
- **`src/renderer.ts`** — paints a `GameState` into the DOM each frame; owns no game logic.
- **`src/main.ts`** — the conductor: the real-time game loop (`requestAnimationFrame` → `tick` → `render`), input wiring, sound, and `localStorage` high-score persistence.
- **`src/audio.ts`** — synthesized Web Audio sound effects, no audio files.
- **`src/strings.ts`** — every string the player sees, including the feedback-code → message mapping.
