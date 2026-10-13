// Balance check: play many AI-vs-AI matches and report who wins and how.
// Run with:  npm run simulate            (default 600 games)
//            npm run simulate -- 2000
import { simulateMatch } from '../src/game/sim';
import { RULES } from '../src/game/types';

const games = Number(process.argv[2] ?? 600);
const reasons: Record<string, number> = {};
let hawkerWins = 0;
let rounds = 0;

for (let seed = 1; seed <= games; seed++) {
  const end = simulateMatch(seed);
  const o = end.outcome!;
  if (o.winner === 'HAWKER') hawkerWins++;
  reasons[o.reason] = (reasons[o.reason] ?? 0) + 1;
  rounds += end.round;
}

const pct = (n: number) => `${((100 * n) / games).toFixed(1)}%`;
console.log(`Rules: ${JSON.stringify(RULES)}`);
console.log(`${games} games · hawker wins ${pct(hawkerWins)} · avg ${(rounds / games).toFixed(1)} rounds`);
for (const [r, n] of Object.entries(reasons).sort()) console.log(`  ${r.padEnd(9)} ${pct(n)}`);
