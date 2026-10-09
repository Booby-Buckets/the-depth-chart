// A full game: ~68 possessions a side (both teams' tempo), substitutions that track each player's minute
// target (MPG scaled to 200), fouls / foul-outs, overtime. Returns the final, a box score and an optional
// event log. Pure: no DOM, no Supabase.

import { makeRng } from './rng.js?v=23';
import { runPossession, unitStats } from './possession.js?v=23';

const ROW = () => ({ sec: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 });

// Pick five by minutes still owed through the next stint, keeping a playable shape:
// at least one G, at least one B (when the roster has one), at most three B and three G.
function chooseFive(side, tNext, C) {
  const avail = side.team.roster.filter(p => side.rows[p.id].pf < C.FOUL_OUT);
  // the coach's starters open each half (if all five can play)
  if (side.team.starters && (tNext - C.SUB_EVERY === 0 || tNext - C.SUB_EVERY === 1200)) {
    const st = side.team.starters.map(id => avail.find(p => p.id === id)).filter(Boolean);
    if (st.length === 5) return st;
  }
  const pool = avail.length >= 5 ? avail : side.team.roster;          // foul-out disaster: play anyone
  const owed = p => p.target * 60 * tNext / 2400 - side.rows[p.id].sec;
  const sorted = pool.slice().sort((a, b) => owed(b) - owed(a) || b.target - a.target);
  const five = [], cnt = { G: 0, W: 0, B: 0 };
  const take = p => { five.push(p); cnt[p.group]++; };
  const g = sorted.find(p => p.group === 'G'); if (g) take(g);
  const b = sorted.find(p => p.group === 'B'); if (b) take(b);
  for (const p of sorted) {
    if (five.length === 5) break;
    if (five.includes(p)) continue;
    if ((p.group === 'B' || p.group === 'G') && cnt[p.group] >= 3) continue;
    take(p);
  }
  for (const p of sorted) { if (five.length === 5) break; if (!five.includes(p)) take(p); }
  return five;
}

function side(team, home) {
  const rows = {}; team.roster.forEach(p => { rows[p.id] = ROW(); });
  return { team, home, rows, box: p => rows[p.id], five: null, unit: null, fouls: 0 };
}

function setFive(s, five, log, t, idx) {
  if (log && s.five) {
    const out = s.five.filter(p => !five.includes(p)), inn = five.filter(p => !s.five.includes(p));
    if (out.length) log.push({ t: Math.round(t), s: idx, ty: 'sub', in: inn.map(p => p.id), out: out.map(p => p.id) });
  }
  s.five = five; s.unit = unitStats(five);
}

/**
 * simulateGame(home, away, opts)
 *   home, away: prepared teams (ratings.prepareTeam)
 *   opts: { C, L (league refs), seed | rng, neutral = false, log = false }
 * -> { score: [home, away], ot, poss, box: { home: [...rows], away: [...rows] }, events }
 */
export function simulateGame(home, away, opts) {
  const { C, L } = opts;
  const rng = opts.rng || makeRng(opts.seed ?? 1);
  const log = opts.log ? [] : null;
  const H = side(home, !opts.neutral), A = side(away, false);
  const S = [H, A];

  const per = Math.max(55, Math.round(C.POSS_SCALE * home.tempo * away.tempo / C.LG_PACE + rng.normal(0, C.PACE_SD)));
  let first = rng.int(2);                                   // who wins the tip
  const score = [0, 0];
  let t = 0, lastSub = -1e9, ot = 0, poss = 0;

  const period = (nPoss, t0, len) => {
    // nPoss possessions per team over `len` seconds; second-half tip alternates
    const total = nPoss * 2, dt = len / total;
    for (let i = 0; i < total; i++) {
      t = t0 + i * dt;
      if (i === 0 || t - lastSub >= C.SUB_EVERY || S.some(s => s.five.some(p => s.rows[p.id].pf >= C.FOUL_OUT))) {
        S.forEach((s, k) => setFive(s, chooseFive(s, Math.min(2400, t + C.SUB_EVERY), C), log, t, k));
        lastSub = t;
      }
      const k = (first + i) % 2, o = S[k], d = S[1 - k];
      const env = { C, L, rng, log, t, side: k, lead: score[k] - score[1 - k] };
      score[k] += runPossession(o, d, env);
      poss += 0.5;
      for (const s of S) for (const p of s.five) s.rows[p.id].sec += dt;
    }
  };

  const half = Math.round(per / 2);
  period(half, 0, 1200);
  first = 1 - first;
  period(per - half, 1200, 1200);
  while (score[0] === score[1]) {                          // overtime: 5 minutes at the game's pace
    if (ot >= 8) throw new Error(`still tied after ${ot} OTs (${home.name} vs ${away.name}) — check constants for NaN`);
    ot++;
    period(Math.max(4, Math.round(per * C.OT_SEC / 2400)), 2400 + (ot - 1) * C.OT_SEC, C.OT_SEC);
  }

  const out = s => s.team.roster.map(p => Object.assign({ id: p.id, name: p.name, min: +(s.rows[p.id].sec / 60).toFixed(1) }, s.rows[p.id]))
    .filter(r => r.sec > 0).map(r => { delete r.sec; return r; });
  return { score, ot, poss: Math.round(poss), box: { home: out(H), away: out(A) }, events: log };
}

// team totals from one side of a box score
export function totals(rows) {
  const t = ROW(); delete t.sec;
  for (const r of rows) for (const k in t) t[k] += r[k];
  return t;
}
