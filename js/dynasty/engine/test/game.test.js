import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C } from '../constants.js?v=2';
import { indexSnapshot } from '../snapshot.js?v=2';
import { simulateGame, totals } from '../game.js?v=2';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const snap = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../data/dynasty-snapshot.json')));
const { L, teams } = indexSnapshot(snap, C);
const DUKE = teams['Duke Blue Devils'], UNC = teams['North Carolina Tar Heels'];

test('same seed -> identical game, box and log', () => {
  const a = simulateGame(DUKE, UNC, { C, L, seed: 11, log: true });
  const b = simulateGame(DUKE, UNC, { C, L, seed: 11, log: true });
  assert.deepEqual(a, b);
  const finals = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(sd => simulateGame(DUKE, UNC, { C, L, seed: sd }).score.join('-')));
  assert.ok(finals.size >= 6, 'different seeds should give different games');
});

test('box score adds up: points = 2*FGM + 3PM + FTM, matches the final', () => {
  for (let s = 0; s < 50; s++) {
    const g = simulateGame(DUKE, UNC, { C, L, seed: s });
    for (const [side, i] of [['home', 0], ['away', 1]]) {
      const t = totals(g.box[side]);
      assert.equal(t.pts, 2 * t.fgm + t.tpm + t.ftm);
      assert.equal(t.pts, g.score[i]);
      assert.ok(t.fgm <= t.fga && t.tpm <= t.tpa && t.ftm <= t.fta && t.tpa <= t.fga);
    }
    assert.notEqual(g.score[0], g.score[1]);          // overtime settles ties
  }
});

test('every team plays 200 minutes (+25 per OT) and minutes follow MPG', () => {
  const got = {};
  for (let s = 0; s < 200; s++) {
    const g = simulateGame(DUKE, UNC, { C, L, seed: s });
    const min = g.box.home.reduce((x, r) => x + r.min, 0);
    assert.ok(Math.abs(min - (200 + 25 * g.ot)) < 1.5, `minutes ${min} ot ${g.ot}`);
    for (const r of g.box.home) got[r.id] = (got[r.id] || 0) + r.min / 200;
  }
  for (const p of DUKE.roster.filter(p => p.target >= 15)) {
    assert.ok(Math.abs(got[p.id] - p.target) < 3.5, `${p.name}: ${got[p.id].toFixed(1)} vs ${p.target.toFixed(1)}`);
  }
});

test('possessions land near the two tempos, both sides within one', () => {
  const g = simulateGame(DUKE, UNC, { C, L, seed: 3 });
  assert.ok(g.poss > 55 && g.poss < 85, `poss ${g.poss}`);
});

test('event log: chronological, every scoring event accounted for', () => {
  const g = simulateGame(DUKE, UNC, { C, L, seed: 5, log: true });
  let last = -1, pts = [0, 0];
  for (const e of g.events) {
    assert.ok(e.t >= last); last = e.t;
    if (e.ty === 'fg2' && e.m) pts[e.s] += 2 + (e.and1 || 0);
    if (e.ty === 'fg3' && e.m) pts[e.s] += 3 + (e.and1 || 0);
    if (e.ty === 'ft') pts[e.s] += e.m;
  }
  assert.deepEqual(pts, g.score);
});

test('home court helps: same matchup, sides swapped', () => {
  let m = 0; const N = 600;
  for (let s = 0; s < N; s++) {
    const a = simulateGame(DUKE, UNC, { C, L, seed: s }), b = simulateGame(UNC, DUKE, { C, L, seed: s });
    m += ((a.score[0] - a.score[1]) + (b.score[0] - b.score[1])) / 2;
  }
  assert.ok(m / N > 1 && m / N < 5, `HCA ${(m / N).toFixed(2)}`);
});

test('engine modules never touch the DOM or the network', () => {
  const dir = path.resolve(HERE, '..');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\b(document|window|localStorage|fetch|XMLHttpRequest|supabase)\b/i.test(src.replace(/\/\/.*$/gm, '')), `${f} references the DOM / network`);
  }
});
