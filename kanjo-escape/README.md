# Kanjo Escape

A hidden-movement chase across Nairobi's CBD. Play the **hawker**, slipping through alleys to reach a matatu stage, or the **Kanjo squad**, hunting them with two pickups and an askari on foot. The computer plays the other side.

Built with TypeScript, HTML Canvas and Vite. No game engine.

```bash
npm install
npm run dev        # play
npm test           # 21 rule, deduction and AI tests
npm run simulate   # balance check: 600 AI-vs-AI games
```

## How to play

- **Hawker:** move one junction or alley per round. Your moves are secret, but Kanjo learns whether you took a road or an alley. On rounds 3, 6, 9, 12 and 15 the whistle blows and you're seen. Reach any stage to win.
- **Kanjo:** pickups move up to 2 junctions on roads; the askari on foot moves 1, alleys included. Stop on the hawker to catch them. Askaris can't enter stages. Survive 15 rounds without an escape and you win too.
- **Ujasusi** shows every place the hawker could logically be.

Keyboard (Kanjo): `1` `2` `3` select a unit, `H` hold, `Enter` end turn.

## Docs

- [DESIGN.md](DESIGN.md): full rules, balance numbers, and every change from the original playthrough log
- [GUIDE.md](GUIDE.md): build it yourself, milestone by milestone
