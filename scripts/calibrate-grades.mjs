/**
 * calibrate-grades.js
 * Tuning harness for player-grades.js
 *
 *   node calibrate-grades.js          # runs on a synthetic pool (demo)
 *
 * Or import in your own code once real data is loaded:
 *   import { runCalibration } from './calibrate-grades.js';
 *   runCalibration(myPlayers, { sweep: true });
 *
 * What it shows:
 *   - grade distribution (histogram + percentiles + summary)
 *   - top 15 / bottom 15 with the composite + reliability that drove them
 *   - a k / center sweep so you can see how the curve reshapes before committing
 */

import { gradePlayers, CONFIG } from './player-grades.mjs';

// ============================================================
// stats / formatting helpers
// ============================================================
const nameOf = (p) => p.name || p.player_name || p.fullName || `#${p.id ?? '?'}`;

function summary(grades) {
  const xs = [...grades].sort((a, b) => a - b);
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const pct = (q) => xs[Math.min(n - 1, Math.floor(q * n))];
  return {
    n, mean, sd, min: xs[0], max: xs[n - 1],
    p10: pct(0.10), p25: pct(0.25), p50: pct(0.50),
    p75: pct(0.75), p90: pct(0.90), p99: pct(0.99),
    pct90plus: (xs.filter((x) => x >= 90).length / n) * 100,
    pctBelow35: (xs.filter((x) => x < 35).length / n) * 100,
  };
}

function histogram(grades) {
  const buckets = [
    ['25–29', 25, 30], ['30–39', 30, 40], ['40–49', 40, 50],
    ['50–59', 50, 60], ['60–69', 60, 70], ['70–79', 70, 80],
    ['80–89', 80, 90], ['90–99', 90, 100],
  ];
  const counts = buckets.map(([, lo, hi]) =>
    grades.filter((g) => g >= lo && g < hi).length);
  const max = Math.max(1, ...counts);
  return buckets.map(([label], i) => {
    const bars = '█'.repeat(Math.round((counts[i] / max) * 40));
    return `  ${label.padEnd(6)} | ${bars} ${counts[i]}`;
  }).join('\n');
}

// ============================================================
// report
// ============================================================
function printReport(graded) {
  const grades = graded.map((p) => p.grade);
  const s = summary(grades);

  console.log(`\n=== GRADE DISTRIBUTION (n=${s.n}) ===`);
  console.log(
    `mean ${s.mean.toFixed(1)} | median ${s.p50} | sd ${s.sd.toFixed(1)} ` +
    `| min ${s.min} | max ${s.max}`);
  console.log('');
  console.log(histogram(grades));
  console.log('');
  console.log(
    `percentiles: p10=${s.p10} p25=${s.p25} p50=${s.p50} ` +
    `p75=${s.p75} p90=${s.p90} p99=${s.p99}`);
  console.log(
    `share 90+: ${s.pct90plus.toFixed(1)}%  |  share <35: ${s.pctBelow35.toFixed(1)}%`);

  const sorted = [...graded].sort((a, b) => b.grade - a.grade);
  const row = (p, rank) => {
    const d = p._debug || {};
    return ` ${String(rank).padStart(2)}. ${nameOf(p).padEnd(22)} ${String(p.grade).padStart(3)}` +
      `   (C=${(d.compositeStd ?? 0).toFixed(2).padStart(5)} rel=${(d.reliability ?? 1).toFixed(2)})`;
  };

  console.log('\n=== TOP 15 ===');
  sorted.slice(0, 15).forEach((p, i) => console.log(row(p, i + 1)));
  console.log('\n=== BOTTOM 15 ===');
  sorted.slice(-15).forEach((p, i) => console.log(row(p, sorted.length - 14 + i)));
}

// ============================================================
// k / center sweep — re-grades under each setting, restores CONFIG after
// ============================================================
function sweep(players, ks = [1.2, 1.6, 2.0], centers = [0.0, 0.3]) {
  const orig = { ...CONFIG.logistic };
  console.log('\n=== k / center SWEEP ===');
  console.log('   k  center | mean  p50  %90+  %<35  spread(p90-p10)');
  console.log('  ' + '-'.repeat(54));
  for (const k of ks) {
    for (const center of centers) {
      CONFIG.logistic.k = k;
      CONFIG.logistic.center = center;
      const s = summary(gradePlayers(players).map((p) => p.grade));
      console.log(
        `  ${k.toFixed(1)}  ${center.toFixed(1)}   | ` +
        `${s.mean.toFixed(1).padStart(4)}  ${String(s.p50).padStart(3)}  ` +
        `${s.pct90plus.toFixed(1).padStart(4)}  ${s.pctBelow35.toFixed(1).padStart(4)}  ` +
        `${String(s.p90 - s.p10).padStart(3)}`);
    }
  }
  Object.assign(CONFIG.logistic, orig); // restore
}

// ============================================================
// public entry
// ============================================================
export function runCalibration(players, { sweep: doSweep = true } = {}) {
  const graded = gradePlayers(players);
  printReport(graded);
  if (doSweep) sweep(players);
  console.log('');
  return graded;
}

// ============================================================
// synthetic pool — lets you run the harness before wiring real data.
// Each player has a hidden "talent"; stats correlate with it so the
// top/bottom lists are believable and the curve is realistic.
// ============================================================
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildDemoPool(n = 350) {
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  const players = [];
  for (let i = 0; i < n; i++) {
    const talent = randn();                 // latent quality
    const noise = () => talent * 0.7 + randn() * 0.7;
    const pos = positions[i % 5];
    const baseHeight = 70 + i % 5 * 2.2;     // taller toward C
    const games = Math.random() < 0.15
      ? Math.floor(Math.random() * 28)       // some thin-sample players
      : 28 + Math.floor(Math.random() * 6);
    const mpg = Math.random() < 0.12 ? Math.random() * 10 : 12 + Math.random() * 22;

    players.push({
      id: i + 1, name: `Player ${String(i + 1).padStart(3, '0')}`, pos,
      gamesPlayed: games, mpg,
      // offense
      ppg: 12 + noise() * 5, fgaToFgPct: 0.45 + noise() * 0.05, fta: 3 + noise() * 2,
      ppg40: 18 + noise() * 6, obpm: noise() * 3, ows: 1.5 + noise() * 1.5,
      // efficiency
      tsPct: 0.55 + noise() * 0.05, tpPct: 0.34 + noise() * 0.05,
      fgPct: 0.46 + noise() * 0.05, ftPct: 0.72 + noise() * 0.08,
      // creation
      ast: 2.5 + noise() * 2, astPct: 15 + noise() * 8, pprod: 1.4 + noise() * 1.2,
      orb: 1.2 + randn() * 0.6, to: 2 - noise() * 0.5, tovPct: 14 - noise() * 3,
      // usage
      usgPct: 20 + noise() * 5, per: 15 + noise() * 5,
      apg40: 3 + noise() * 2, mpg2: mpg,
      // impact
      wa: noise() * 2, ws: 2 + noise() * 2, bpm: noise() * 4,
      glsT1: noise() * 3, glsT2: noise() * 3, glsT3: noise() * 2.5, glsT4: noise() * 2,
      // defense
      stl: 1 + noise() * 0.6, blk: 0.6 + noise() * 0.6,
      drb: 3 + noise() * 1.5, pf: 2.2 - noise() * 0.3,
      // scalability (per-40)
      fga40: 13 + noise() * 4, fta40: 4 + noise() * 2,
      pf40: 3.5 - noise() * 0.4, to40: 3 - noise() * 0.5,
      // size
      height: baseHeight + randn() * 1.5,
      heightVsPos: randn(),
    });
    players[i].mpg = mpg; // ensure mpg present for rate-null logic
  }
  return players;
}

// run as a script
if (process.argv[1] && process.argv[1].endsWith('calibrate-grades.js')) {
  console.log(`Running calibration on synthetic pool (mode=${CONFIG.mode}, ` +
    `standardize=${CONFIG.standardize})`);
  runCalibration(buildDemoPool(350), { sweep: true });
}

export { buildDemoPool };
