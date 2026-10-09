// March benchmark: first-round seed-vs-seed win rates on neutral floors vs real NCAA history (1985-2025).
// Seed lines 1-12 from the rating S-curve; 13-16 are auto-bid-like (one-bid league champions, ranks ~90-300).
//   node tools/seeds.js [--games 300] [--set TALENT_K=0.33]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C } from '../engine/constants.js?v=23';
import { indexSnapshot } from '../engine/snapshot.js?v=23';
import { simulateGame } from '../engine/game.js?v=23';
import { makeRng } from '../engine/rng.js?v=23';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
for (const kv of (arg('set', '') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); C[k] = +v; }
const N = +arg('games', 300);
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/dynasty-snapshot.json')));
const { L, teams } = indexSnapshot(snap, C);
const order = snap.teams.filter(t => teams[t.name] && t.rating != null).sort((a, b) => b.rating - a.rating).map(t => t.name);
const line = s => s <= 12 ? order.slice((s - 1) * 4, s * 4) : order.slice(...{ 13: [90, 110], 14: [120, 150], 15: [160, 200], 16: [220, 300] }[s]);
const REAL = { '1v16': 98.8, '2v15': 92.6, '3v14': 85.3, '4v13': 78.8, '5v12': 64.7, '6v11': 61.2, '7v10': 60.6, '8v9': 48.7 };
const rng = makeRng(+arg('seed', 3));
console.log('matchup   sim fav win%   real history');
for (const [a, b] of [[1, 16], [2, 15], [3, 14], [4, 13], [5, 12], [6, 11], [7, 10], [8, 9]]) {
  const A = line(a), B = line(b); let w = 0;
  for (let i = 0; i < N; i++) {
    const x = A[rng.int(A.length)], y = B[rng.int(B.length)];
    const r = simulateGame(teams[x], teams[y], { C, L, rng: rng.child(), neutral: true });
    if (r.score[0] > r.score[1]) w++;
  }
  console.log(`${a}v${b}`.padEnd(10) + `${(100 * w / N).toFixed(1)}`.padStart(8) + `${REAL[a + 'v' + b].toFixed(1)}`.padStart(15));
}
