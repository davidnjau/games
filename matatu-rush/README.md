# Matatu Rush

A two-player, hot-seat Kenyan take on Quoridor. Race your matatu across a 9×9 Nairobi grid to the rival's stage, and drop Kanjo Spikes to force them into long detours, but never box them in completely.

Built with TypeScript, HTML Canvas and Vite. No game engine.

## Play

```bash
npm install
npm run dev
```

## How to play

- Each turn, either **Dunda** (drive one junction) or **Weka spikes** (drop a two-junction roadblock).
- Nose-to-tail with your rival? Overtake by jumping over them. If spikes or the board edge are behind them, drift diagonally instead.
- A spike drop that would leave either driver with no route to their stage is refused.
- First to reach the far row wins. Each driver has 10 spikes.

**Controls:** click/tap a highlighted junction to drive. In spike mode, hover a groove and click (on touch: tap to preview, tap again to place). Keyboard: arrows to drive, `D` drive mode, `S` spike mode, `Z` undo.

## Learn to build it

See [GUIDE.md](GUIDE.md) for a milestone-by-milestone walkthrough, and [docs/matatu-rush-blueprint.md](docs/matatu-rush-blueprint.md) for the original design.
