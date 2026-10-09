// The season: day-by-day simulation over state.schedule, results, player stats, standings, a power rating
// (opponent-adjusted net blended with the preseason prior) and the poll. Pure: works on the state object.
import { prepareTeam } from './ratings.js?v=48';
import { simulateGame, totals } from './game.js?v=48';
import { makeRng, hashSeed } from './rng.js?v=48';
import { powerFeatures } from './league.js?v=48';
import { afterGame } from './injuries.js?v=48';
import { resolvePending, nextPendingDate, EXT_RATING } from './fill.js?v=48';
import { resolveVisits } from './visits.js?v=48';
import { resolveMTE } from './mte.js?v=48';
import { schemeMods, programGame } from './program.js?v=48';

const STAT_KEYS = ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf'];

// prepared (sim-ready) teams, cached until a roster / lineup / plan changes (bump state._ver)
export function prepared(state, C, cache = {}) {
  if (cache.ver === state._ver && cache.year === state.year && cache.teams) return cache;
  const byId = state.players, teams = {};
  for (const t of Object.values(state.teams)) {
    const opts = t.name === state.user || t.minutes || t.starters || t.plan
      ? { minutes: t.minutes || undefined, starters: t.starters || undefined, plan: t.plan || undefined } : {};
    teams[t.name] = schemeMods(state, t, prepareTeam(t, byId, state.maps, C, opts), C);   // scheme fit x familiarity, fatigue
  }
  for (const t of Object.values((state.ext && state.ext.teams) || {})) teams[t.name] = prepareTeam(t, state.ext.players, state.maps, C, {});
  return Object.assign(cache, { ver: state._ver, year: state.year, teams, L: leagueRefsOf(state) });
}

// league reference rates (minutes-weighted) the possession model scales against
export function leagueRefsOf(state) {
  let m = 0; const a = { ast40: 0, stl40: 0, blk40: 0, or40: 0, dr40: 0 };
  for (const t of Object.values(state.teams)) for (const id of t.players) {
    const p = state.players[id]; if (!p || !p.attr) continue; const w = p.mpg || 0; m += w;
    for (const k in a) a[k] += p.attr[k] * w;
  }
  for (const k in a) a[k] /= m || 1;
  return a;
}

export const touch = state => { state._ver = (state._ver || 0) + 1; };

export function gameSeed(state, g) { return hashSeed(`${state.seed}:${state.year}:${g.id}`); }

// play one scheduled game and record it
export function playGame(state, g, prep, C, opts = {}) {
  const H = prep.teams[g.h], A = prep.teams[g.a];
  const sim = simulateGame(H, A, { C, L: prep.L, seed: gameSeed(state, g), neutral: g.n, log: !!opts.log });
  record(state, g, sim);
  return sim;
}

export function record(state, g, sim) {
  const th = totals(sim.box.home), ta = totals(sim.box.away);
  const est = t => t.fga - t.orb + t.tov + 0.475 * t.fta;
  g.r = [sim.score[0], sim.score[1], sim.ot, Math.round((est(th) + est(ta)) / 2)];
  for (const [rows, team] of [[sim.box.home, g.h], [sim.box.away, g.a]]) {
    if (!state.teams[team]) continue;                         // non-D-I opponents keep no season stats
    const starters = new Set(rows.slice().sort((a, b) => (b.min || 0) - (a.min || 0)).slice(0, 5).map(r => r.id));   // a start = top-5 minutes
    for (const r of rows) {
      const s = state.stats[r.id] || (state.stats[r.id] = Object.fromEntries([['g', 0], ['gs', 0], ...STAT_KEYS.map(k => [k, 0])]));
      s.g++; for (const k of STAT_KEYS) s[k] += r[k] || 0;
      if (starters.has(r.id)) s.gs = (s.gs || 0) + 1;
      s.team = team;
    }
  }
  if (state.user && (g.h === state.user || g.a === state.user)) {
    state.userBox[g.id] = { box: sim.box, score: sim.score, ot: sim.ot };
  }
  if (g.pay > 0) {                                            // a buy / guarantee game: the host pays the visitor (schedule.js)
    const H = state.teams[g.h] && state.teams[g.h].prog, A = state.teams[g.a] && state.teams[g.a].prog;
    if (H) H.nil.fund = Math.max(0, H.nil.fund - g.pay);
    if (A) A.nil.fund += g.pay;
  }
  programGame(state, g, sim);                                 // playing a scheme teaches it
  if (state.user && g.h === state.user && !g.n) resolveVisits(state, g);   // official visits at this home game
  if (state.injuries !== false && afterGame(state, g, sim)) touch(state);
}

export function nextDate(state) {
  const g = state.schedule.find(x => !x.r), p = nextPendingDate(state);
  const d = g ? g.d : null;
  return !d ? p : !p ? d : (p < d ? p : d);
}

// sim every game on the next unplayed date (skipping any the caller already played, e.g. a watched game)
export function simDay(state, C, cache, opts = {}) {
  const d = nextDate(state); if (!d) return null;
  resolveMTE(state, d);                                          // multi-team event rounds (mte.js)
  resolvePending(state, d, makeRng(hashSeed(`${state.seed}:${state.year}:mte:${d}`)));   // MTE day 2 / 3 from real results
  const prep = prepared(state, C, cache);
  const out = [];
  for (const g of state.schedule) if (g.d === d && !g.r) { playGame(state, g, prep, C, opts); out.push(g); }
  return { date: d, games: out };
}

// sim until `stop(state)` is true or the slate runs out (e.g. the user's next game, end of the regular season)
export function simUntil(state, C, cache, stop, opts = {}) {
  let n = 0;
  while (nextDate(state) && !stop(state)) { simDay(state, C, cache, opts); n++; }
  return n;
}

export function record_(state, team) {
  let w = 0, l = 0, cw = 0, cl = 0;
  for (const g of state.schedule) {
    if (!g.r || (g.h !== team && g.a !== team)) continue;
    const won = (g.h === team) === (g.r[0] > g.r[1]);
    if (won) w++; else l++;
    if (g.c) { if (won) cw++; else cl++; }
  }
  return { w, l, cw, cl };
}

export function standings(state) {
  const by = {};
  for (const t of Object.values(state.teams)) {
    const r = record_(state, t.name);
    (by[t.conf] = by[t.conf] || []).push(Object.assign({ team: t.name }, r));
  }
  const pct = (w, l) => (w + l ? w / (w + l) : 0);
  for (const c in by) by[c].sort((a, b) => pct(b.cw, b.cl) - pct(a.cw, a.cl) || (b.cw - a.cw) || pct(b.w, b.l) - pct(a.w, a.l));
  return by;
}

// power: preseason prior (roster-based fit, on the projection's points-per-game scale) blended with an
// opponent-adjusted scoring margin that takes over as games are played (PRIOR_G games of weight on the prior)
const PRIOR_G = 8;
export function power(state) {
  const T = Object.keys(state.teams), prior = {};
  for (const n of T) prior[n] = powerFeatures(state.teams[n], state.players, state.maps).reduce((s, x, i) => s + x * state.powerFit[i], 0);
  const games = state.schedule.filter(g => g.r && state.teams[g.h] && state.teams[g.a]);   // D-I vs D-I only
  const opp = {}, mar = {};
  for (const n of T) { opp[n] = []; mar[n] = []; }
  for (const g of games) {
    const hca = g.n ? 0 : 3;
    const m = Math.max(-30, Math.min(30, g.r[0] - g.r[1]));          // blowout cap
    opp[g.h].push(g.a); mar[g.h].push(m - hca); opp[g.a].push(g.h); mar[g.a].push(-m + hca);
  }
  let r = Object.assign({}, prior);
  for (let it = 0; it < 25; it++) {
    const nx = {};
    for (const n of T) {
      const k = opp[n].length;
      const fit = k ? mar[n].reduce((s, m, i) => s + m + r[opp[n][i]], 0) : 0;
      nx[n] = (PRIOR_G * prior[n] + fit) / (PRIOR_G + k);
    }
    const mu = T.reduce((s, n) => s + nx[n], 0) / T.length, mu0 = T.reduce((s, n) => s + prior[n], 0) / T.length;
    for (const n of T) nx[n] += mu0 - mu;                               // keep the scale anchored
    r = nx;
  }
  return r;
}

export function poll(state, n = 25) {
  const p = power(state);
  return Object.keys(p).sort((a, b) => p[b] - p[a]).slice(0, n).map((t, i) => Object.assign({ rank: i + 1, team: t, power: p[t] }, record_(state, t)));
}

export function lineFor(state, g, pw) {
  // home spread (positive = home favoured) from power ratings
  const p = pw || power(state);
  return (p[g.h] ?? EXT_RATING) - (p[g.a] ?? EXT_RATING) + (g.n ? 0 : 3);   // a non-D-I opponent has no power rating
}

export const statKeys = STAT_KEYS;
