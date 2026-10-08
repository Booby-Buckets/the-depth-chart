// Calibration: sim the real 2026-27 D-I schedule N times and print league averages next to the real 2025-26
// targets (engine/targets.json) and each team's sim efficiency next to the projection chain (team_pace_eff
// projected ORtg / DRtg — what buildTeamProjections feeds — and team_projected_box ppg).
//
//   node tools/calibrate.js                 # 100 seasons
//   node tools/calibrate.js --seasons 500   # the full run
//   node tools/calibrate.js --seed 7 --json out.json
//   node tools/calibrate.js --seasons 30 --set LEAD_K=0.2,HCA_K=0.11   # try constants without editing
//
// Node-only tool (reads files); the engine modules it drives stay pure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C } from '../engine/constants.js?v=2';
import { indexSnapshot } from '../engine/snapshot.js?v=2';
import { simulateGame, totals } from '../engine/game.js?v=2';
import { makeRng } from '../engine/rng.js?v=2';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEASONS = +arg('seasons', 100), SEED = +arg('seed', 2027);
// --set KEY=value[,KEY=value]: try constants without editing engine/constants.js
for (const kv of (arg('set', '') || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('='); if (!(k in C)) throw new Error('unknown constant ' + k); C[k] = +v;
}

const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/dynasty-snapshot.json')));
const T = JSON.parse(fs.readFileSync(path.join(HERE, '../engine/targets.json')));
const sched = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/schedule_2027.json')));
const { L, teams } = indexSnapshot(snap, C);
const meta = Object.fromEntries(snap.teams.map(t => [t.name, t]));

const games = sched.games.map(g => [sched.teams[g[2]], sched.teams[g[3]], !!g[4]]).filter(([h, a]) => teams[h] && teams[a]);

// ── accumulate ──
const K = ['pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf'];
const lg = Object.fromEntries(K.map(k => [k, 0])); lg.poss = 0; lg.oppDrb = 0; lg.teamGames = 0;
const tm = {}; for (const n in teams) tm[n] = { pf: 0, pa: 0, poss: 0, w: 0, g: 0, pe: 0, pea: 0 };
const est = t => t.fga - t.orb + t.tov + 0.475 * t.fta;
const pl = {};                                                       // player id -> {min, pts, g}
const gm = games.map(() => ({ s: 0, s2: 0 }));                       // per-matchup margin moments
const rng = makeRng(SEED);
const t0 = Date.now();
for (let s = 0; s < SEASONS; s++) {
  games.forEach(([h, a, neu], gi) => {
    const r = simulateGame(teams[h], teams[a], { C, L, rng: rng.child(), neutral: neu });
    const th = totals(r.box.home), ta = totals(r.box.away);
    for (const k of K) lg[k] += th[k] + ta[k];
    lg.poss += 2 * r.poss; lg.oppDrb += ta.drb + th.drb; lg.teamGames += 2;
    const [x, y] = r.score;
    tm[h].pf += x; tm[h].pa += y; tm[h].poss += r.poss; tm[h].g++; tm[a].pf += y; tm[a].pa += x; tm[a].poss += r.poss; tm[a].g++;
    tm[h].pe += est(th); tm[h].pea += est(ta); tm[a].pe += est(ta); tm[a].pea += est(th);
    if (x > y) tm[h].w++; else tm[a].w++;
    const m = x - y; gm[gi].s += m; gm[gi].s2 += m * m;
    for (const row of r.box.home.concat(r.box.away)) { const q = pl[row.id] || (pl[row.id] = { min: 0, pts: 0, g: 0 }); q.min += row.min; q.pts += row.pts; q.g++; }
  });
}
const secs = (Date.now() - t0) / 1000;

// ── league table ──
const G = lg.teamGames;
const fga2 = lg.fga - lg.tpa, fgm2 = lg.fgm - lg.tpm;
// possessions the way the real targets count them (box-score estimate), so pace / ORtg compare like-for-like
const possEst = lg.fga - lg.orb + lg.tov + 0.475 * lg.fta;
const sim = {
  pace: possEst / G, ortg: 100 * lg.pts / possEst, ppg: lg.pts / G, pace_actual: lg.poss / G,
  efg: 100 * (lg.fgm + 0.5 * lg.tpm) / lg.fga, tov_pct: 100 * lg.tov / lg.poss, orb_pct: 100 * lg.orb / (lg.orb + lg.drb),
  ftr: 100 * lg.fta / lg.fga, fg_pct: 100 * lg.fgm / lg.fga, tp_pct: 100 * lg.tpm / lg.tpa, ft_pct: 100 * lg.ftm / lg.fta,
  three_rate: 100 * lg.tpa / lg.fga, apg: lg.ast / G, spg: lg.stl / G, bpg: lg.blk / G, topg: lg.tov / G,
  orpg: lg.orb / G, rpg: (lg.orb + lg.drb) / G, two_pct: 100 * fgm2 / fga2, ast_per_fgm: lg.ast / lg.fgm, pfpg: lg.pf / G,
};

// ── per-team: sim vs projection chain ──
const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, mx, my, sdx: Math.sqrt(sxx / n), sdy: Math.sqrt(syy / n) }; };
// opponent-adjusted efficiency (the projection's ORtg/DRtg are adjusted, KenPom-style): iterate
// adjO = rawO - (avg opponent adjD - league), adjD = rawD - (avg opponent adjO - league)
const opps = {}; for (const [h, a] of games) { (opps[h] = opps[h] || []).push(a); (opps[a] = opps[a] || []).push(h); }
const raw = {}; for (const [n, v] of Object.entries(tm)) if (v.g) raw[n] = { o: 100 * v.pf / v.pe, d: 100 * v.pa / v.pea };
const lgE = Object.values(raw).reduce((s, r) => s + r.o, 0) / Object.keys(raw).length;
let adj = Object.fromEntries(Object.entries(raw).map(([n, r]) => [n, { o: r.o, d: r.d }]));
for (let it = 0; it < 20; it++) {
  const nx = {};
  for (const n in raw) {
    const os = opps[n] || []; const od = os.reduce((s, x) => s + adj[x].d, 0) / os.length, oo = os.reduce((s, x) => s + adj[x].o, 0) / os.length;
    nx[n] = { o: raw[n].o - (od - lgE), d: raw[n].d - (oo - lgE) };
  }
  adj = nx;
}
// compare against projected DNA only where it exists (66 teams carry a rating-derived fallback)
const allRows = Object.entries(tm).filter(([n, v]) => v.g > 0).map(([n, v]) => ({ n, net: adj[n].o - adj[n].d, wp: v.w / v.g, rating: meta[n].rating }));
const cR = corr(allRows.filter(r => r.rating != null).map(r => r.rating), allRows.filter(r => r.rating != null).map(r => r.net));
const rows = Object.entries(tm).filter(([n, v]) => v.g > 0 && meta[n].projO != null && meta[n].projSrc === 'proj').map(([n, v]) => ({
  n, o: adj[n].o, d: adj[n].d, rawO: raw[n].o, rawD: raw[n].d, ppg: v.pf / v.g, wp: v.w / v.g,
  po: meta[n].projO, pd: meta[n].projD, pppg: meta[n].projBox && meta[n].projBox.ppg, rating: meta[n].rating }));
const cN = corr(rows.map(r => r.po - r.pd), rows.map(r => r.o - r.d));
const cO = corr(rows.map(r => r.po), rows.map(r => r.o)), cD = corr(rows.map(r => r.pd), rows.map(r => r.d));
const pp = rows.filter(r => r.pppg); const cP = corr(pp.map(r => r.pppg), pp.map(r => r.ppg));
const rmse = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);

// game-level spread: sim margin SD around each matchup's own mean (pure game randomness)
const within = Math.sqrt(gm.reduce((s, g) => s + (g.s2 / SEASONS - (g.s / SEASONS) ** 2), 0) / gm.length * SEASONS / Math.max(1, SEASONS - 1));   // unbiased (n-1)

// HCA: same matchups home/away swapped, same seeds
let hcaSum = 0; const hr = makeRng(SEED + 1); const names = Object.keys(teams);
for (let i = 0; i < 4000; i++) {
  const a = names[hr.int(names.length)], b = names[hr.int(names.length)]; if (a === b) continue;
  const sd = (hr.next() * 4294967296) >>> 0;
  const g1 = simulateGame(teams[a], teams[b], { C, L, seed: sd }), g2 = simulateGame(teams[b], teams[a], { C, L, seed: sd });
  hcaSum += ((g1.score[0] - g1.score[1]) + (g2.score[0] - g2.score[1])) / 2;
}
sim.hca_pts = hcaSum / 4000;
sim.game_margin_sd = within;

// favourites by projected spread (projection net x pace / 100 + HCA), sim win % vs a normal(11) expectation
const phi = x => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const buckets = [[0, 3], [3, 6], [6, 10], [10, 15], [15, 99]].map(([lo, hi]) => ({ lo, hi, n: 0, win: 0, exp: 0, sp: 0, mm: 0, nn: 0, nsp: 0, nmm: 0 }));
games.forEach(([h, a, neu], gi) => {
  const mh = meta[h], ma = meta[a]; if (mh.projO == null || ma.projO == null || mh.projSrc !== 'proj' || ma.projSrc !== 'proj') return;
  const pace = (mh.tempo || 69) * (ma.tempo || 69) / C.LG_PACE;
  const spread = ((mh.projO - mh.projD) - (ma.projO - ma.projD)) * pace / 100 + (neu ? 0 : T.hca_pts);   // EM difference x possessions
  const fav = Math.abs(spread), simFavMargin = (spread >= 0 ? 1 : -1) * gm[gi].s / SEASONS;
  const b = buckets.find(b => fav >= b.lo && fav < b.hi);
  b.n++; b.exp += phi(fav / T.game_margin_sd); b.sp += fav; b.mm += simFavMargin;
  if (neu) { b.nn++; b.nsp += fav; b.nmm += simFavMargin; }
  // sim win % for the favourite from this matchup's mean / sd
  const sd = Math.sqrt(Math.max(1, gm[gi].s2 / SEASONS - (gm[gi].s / SEASONS) ** 2));
  b.win += phi(simFavMargin / sd);
});

// players: sim ppg vs projected ppg (rotation players)
const P = snap.players.filter(p => p.line.mpg >= 15 && pl[p.id]);
const cPl = corr(P.map(p => p.line.ppg), P.map(p => pl[p.id].pts / pl[p.id].g));
const cMin = corr(P.map(p => p.line.mpg), P.map(p => pl[p.id].min / pl[p.id].g));

// ── print ──
const f = (v, d = 1) => v == null ? '—' : (+v).toFixed(d);
console.log(`\nDynasty engine calibration — ${SEASONS} seasons x ${games.length} D-I games (${(SEASONS * games.length).toLocaleString()} sims, ${secs.toFixed(0)}s), seed ${SEED}\n`);
console.log('LEAGUE           sim     target   diff   ok');
const KEYS = ['pace', 'ortg', 'ppg', 'efg', 'tov_pct', 'orb_pct', 'ftr', 'three_rate', 'fg_pct', 'tp_pct', 'ft_pct', 'apg', 'spg', 'bpg', 'topg', 'orpg', 'rpg', 'hca_pts', 'game_margin_sd'];
let pass = 0, checked = 0;
for (const k of KEYS) {
  const tol = T.tolerance[k], diff = sim[k] - T[k];
  const ok = tol == null ? '' : Math.abs(diff) <= tol ? 'yes' : 'NO';
  if (tol != null) { checked++; if (ok === 'yes') pass++; }
  console.log(`${k.padEnd(15)} ${f(sim[k], 2).padStart(7)} ${f(T[k], 2).padStart(8)} ${(diff >= 0 ? '+' : '') + f(diff, 2)}`.padEnd(42) + ok);
}
console.log(`also: actual possessions/team ${f(sim.pace_actual, 2)} (pace above = box-score estimate)  2P% ${f(sim.two_pct)}  ast/FGM ${f(sim.ast_per_fgm, 2)}  PF/g ${f(sim.pfpg)}`);
console.log(`\n${pass}/${checked} league targets within tolerance`);
console.log(`\nTEAMS vs projection chain — ${rows.length} teams with projected DNA, sim opponent-adjusted (team_pace_eff ORtg/DRtg, team_projected_box ppg)`);
console.log(`  net : r ${f(cN.r, 3)}  slope ${f(cN.slope, 2)}  sd sim ${f(cN.sdy)} vs proj ${f(cN.sdx)} (real 2025-26 net sd ${T.net_sd})  rmse ${f(rmse(rows.map(r => r.o - r.d), rows.map(r => r.po - r.pd)))}`);
console.log(`  ORtg: r ${f(cO.r, 3)}  slope ${f(cO.slope, 2)}  mean sim ${f(cO.my)} vs proj ${f(cO.mx)}`);
console.log(`  DRtg: r ${f(cD.r, 3)}  slope ${f(cD.slope, 2)}  mean sim ${f(cD.my)} vs proj ${f(cD.mx)}`);
console.log(`  ppg : r ${f(cP.r, 3)}  mean sim ${f(cP.my)} vs proj ${f(cP.mx)}`);
{ const lv = corr(rows.map(r => meta[r.n].level), rows.map(r => (r.o - r.d) - (r.po - r.pd)));
  const lo = corr(rows.map(r => meta[r.n].level), rows.map(r => r.o - r.po)), ld = corr(rows.map(r => meta[r.n].level), rows.map(r => r.d - r.pd));
  console.log(`  residual vs conference level: net ${f(10 * lv.slope, 2)} per 10 lvl (r ${f(lv.r, 2)}) · O ${f(10 * lo.slope, 2)} · D ${f(10 * ld.slope, 2)}`); }
console.log(`  vs 2027 power rating (all ${allRows.length} teams): r ${f(cR.r, 3)}  slope ${f(cR.slope, 2)} sim net per rating point`);
console.log(`PLAYERS (mpg>=15, n=${P.length}): ppg r ${f(cPl.r, 3)} slope ${f(cPl.slope, 2)} (sim ${f(cPl.my)} vs proj ${f(cPl.mx)}) · minutes r ${f(cMin.r, 3)} (sim ${f(cMin.my)} vs proj ${f(cMin.mx)})`);
console.log('\nFAVOURITES (projected spread)   games   sim fav win%   expected (N(spread, 11))   avg spread / sim margin');
for (const b of buckets) if (b.n) console.log(`  ${String(b.lo).padStart(2)}–${b.hi === 99 ? '+ ' : String(b.hi).padEnd(2)} pts`.padEnd(31) + `${String(b.n).padStart(5)}   ${f(100 * b.win / b.n).padStart(8)}       ${f(100 * b.exp / b.n).padStart(8)}          ${f(b.sp / b.n)} / ${f(b.mm / b.n)}`);
const top = rows.slice().sort((a, b) => (b.po - b.pd) - (a.po - a.pd));
console.log('\nTOP 10 by projection        proj net  sim net  sim win%');
for (const r of top.slice(0, 10)) console.log(`  ${r.n.padEnd(26)} ${f(r.po - r.pd).padStart(7)} ${f(r.o - r.d).padStart(8)} ${f(100 * r.wp).padStart(8)}`);
console.log('BOTTOM 5');
for (const r of top.slice(-5)) console.log(`  ${r.n.padEnd(26)} ${f(r.po - r.pd).padStart(7)} ${f(r.o - r.d).padStart(8)} ${f(100 * r.wp).padStart(8)}`);

if (process.argv.includes('--resid')) {
  console.log('\nBIGGEST GAPS sim net - proj net');
  for (const r of rows.slice().sort((a, b) => Math.abs((b.o - b.d) - (b.po - b.pd)) - Math.abs((a.o - a.d) - (a.po - a.pd))).slice(0, 20))
    console.log(`  ${r.n.padEnd(34)} proj ${f(r.po - r.pd).padStart(6)}  sim ${f(r.o - r.d).padStart(6)}  (O ${f(r.po)}->${f(r.o)}  D ${f(r.pd)}->${f(r.d)})  conf ${meta[r.n].conf} lvl ${meta[r.n].level}`);
}
const out = arg('json');
if (out) fs.writeFileSync(out, JSON.stringify({ seasons: SEASONS, seed: SEED, sim, targets: T, net: cN, ortg: cO, drtg: cD, ppg: cP, players: cPl, buckets, C }, null, 1));
