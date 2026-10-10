// A full game: ~68 possessions a side (both teams' tempo), substitutions that track each player's minute
// target (MPG scaled to 200), fouls / foul-outs, overtime. Returns the final, a box score and an optional
// event log. Pure: no DOM, no Supabase.

import { makeRng } from './rng.js?v=62';
import { runPossession, unitStats } from './possession.js?v=62';

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
 *   opts: { C, L (league refs), seed | rng, neutral = false, log = false, ctl }
 * -> { score: [home, away], ot, poss, box: { home: [...rows], away: [...rows] }, events }
 * Runs gameSteps to the end (both coaches on auto timeouts unless opts.ctl says otherwise).
 */
export function simulateGame(home, away, opts) {
  const it = gameSteps(home, away, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// MOMENTUM + TIMEOUTS (Oct 2026). A run (one side outscoring the other by 8+ over the last ~12 possessions) is worth a
// small make bonus to the side on it; a timeout wipes the run, gives the caller a set play on its next possession and
// a breather (a few possessions of fresher legs). 4 a game. Coaches on `auto` call one when the other side is on a
// 9+ run (keeping one for the end); the user controls his own in a watched game (ctl.call[k] = true).
const RUN_WIN = 12, RUN_AT = 8, MOM_K = 0.06, PLAY_K = 0.08, REST_K = 0.025, REST_N = 8;
export const TIMEOUTS = 4;
export function newCtl(auto = [true, true]) {
  return { to: [TIMEOUTS, TIMEOUTS], call: [false, false], auto: auto.slice(), play: [0, 0], rest: [0, 0], recent: [], run: [0, 0] };
}

/** the same game one possession at a time: yields {score, t, period, run, to} after each; returns the result */
export function* gameSteps(home, away, opts) {
  const { C, L } = opts;
  const rng = opts.rng || makeRng(opts.seed ?? 1);
  const log = opts.log ? [] : null;
  const ctl = opts.ctl || newCtl();
  const H = side(home, !opts.neutral), A = side(away, false);
  const S = [H, A];

  const per = Math.max(55, Math.round(C.POSS_SCALE * home.tempo * away.tempo / C.LG_PACE + rng.normal(0, C.PACE_SD)));
  let first = rng.int(2);                                   // who wins the tip
  const score = [0, 0];
  let t = 0, lastSub = -1e9, ot = 0, poss = 0;
  const halfLead = [0, 0];
  const runOf = () => { const r = [0, 0]; for (const [k, pts] of ctl.recent) r[k] += pts; return [r[0] - r[1], r[1] - r[0]]; };
  const timeout = (k, why) => {
    if (ctl.to[k] <= 0) return;
    ctl.to[k]--; ctl.recent = []; ctl.play[k] = 1; ctl.rest[k] = REST_N;
    if (log) log.push({ t: Math.round(t), s: k, ty: 'tmo', left: ctl.to[k], why });
  };

  function* period(nPoss, t0, len) {
    const total = nPoss * 2, dt = len / total;
    for (let i = 0; i < total; i++) {
      t = t0 + i * dt;
      if (i === 0 || t - lastSub >= C.SUB_EVERY || S.some(s => s.five.some(p => s.rows[p.id].pf >= C.FOUL_OUT))) {
        S.forEach((s, k) => setFive(s, chooseFive(s, Math.min(2400, t + C.SUB_EVERY), C), log, t, k));
        lastSub = t;
      }
      // timeouts (dead ball before the possession): the user's call, or an auto coach stopping a 9+ run
      const run = runOf(); ctl.run = run;
      for (const k of [0, 1]) {
        if (ctl.call[k]) { ctl.call[k] = false; timeout(k, 'called'); }
        else if (ctl.auto[k] && run[1 - k] >= RUN_AT + 1 && ctl.to[k] > 1) timeout(k, 'run');
      }
      const k = (first + i) % 2, o = S[k], d = S[1 - k];
      const r2 = runOf();
      let mom = r2[k] >= RUN_AT ? MOM_K * Math.min(1, (r2[k] - RUN_AT + 1) / 6) : 0;   // riding a run
      const tr = o.team.tr || {};                                                          // the user's Coaching Legacy traits
      if (ctl.play[k]) { mom += PLAY_K * (1 + (tr.tmo || 0)); ctl.play[k] = 0; }            // the drawn-up play
      if (ctl.rest[k] > 0) { mom += REST_K * (1 + (tr.tmo || 0)); ctl.rest[k]--; }         // fresher legs
      if (tr.crunch && t >= 2160 && Math.abs(score[k] - score[1 - k]) <= 6) mom += tr.crunch;   // crunch time
      if (tr.half && t >= 1200 && halfLead[k] < 0) mom += tr.half;                         // the halftime fix
      const env = { C, L, rng, log, t, side: k, lead: score[k] - score[1 - k], mom };
      const pts = runPossession(o, d, env);
      score[k] += pts;
      ctl.recent.push([k, pts]); if (ctl.recent.length > RUN_WIN) ctl.recent.shift();
      poss += 0.5;
      for (const s of S) for (const p of s.five) s.rows[p.id].sec += dt;
      yield { score: score.slice(), t, run: runOf(), to: ctl.to.slice(), events: log };
    }
  }

  const half = Math.round(per / 2);
  yield* period(half, 0, 1200);
  halfLead[0] = score[0] - score[1]; halfLead[1] = -halfLead[0];
  first = 1 - first;
  ctl.recent = [];                                           // halftime resets the momentum
  yield* period(per - half, 1200, 1200);
  while (score[0] === score[1]) {                          // overtime: 5 minutes at the game's pace
    if (ot >= 8) throw new Error(`still tied after ${ot} OTs (${home.name} vs ${away.name}) — check constants for NaN`);
    ot++;
    ctl.to = ctl.to.map(x => x + 1);                         // one more timeout each overtime
    yield* period(Math.max(4, Math.round(per * C.OT_SEC / 2400)), 2400 + (ot - 1) * C.OT_SEC, C.OT_SEC);
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
