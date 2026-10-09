// A new dynasty: the snapshot's 350 teams + players become a saveable league state (plain JSON — the UI keeps
// it in IndexedDB). Pure: the caller hands in the parsed snapshot / schedule / conference files.
//
// state = {
//   v, seed, year, user, phase, maps,                 maps = the snapshot's pillar/overall/defense fits
//   teams:   { name: { name, conf, tempo, level, sysDef, prestige, players:[ids], plan, minutes, starters } },
//   players: { id: { id, name, team, pos, pos2, ht, yr, pillars, lvl, mpg, pot } },
//   schedule:[ { id, d, h, a, n, c, r } ],             r = [homePts, awayPts, ot, poss] once played
//   stats:   { id: season totals },  powerFit, history:[], userBox:{ gameId: box } }
import { attributes, overall } from './ratings.js?v=42';
import { makeRng } from './rng.js?v=42';
import { initCoaches } from './coaching.js?v=42';
import { fillLeague, buildSchedule } from './fill.js?v=42';
import { makeClass, classSize } from './offseason.js?v=42';
import { initProgram, ensureStamina } from './program.js?v=42';

export const YR = { 'FR': 1, 'FR.': 1, 'RS FR.': 1, 'SO': 2, 'SO.': 2, 'RS SO.': 2, 'JR': 3, 'JR.': 3, 'RS JR.': 3, 'SR': 4, 'SR.': 4, 'RS SR.': 4, 'GR': 5, 'GR.': 5, '5TH': 5 };
export const YR_LABEL = ['', 'Fr', 'So', 'Jr', 'Sr', 'Gr'];

function yearOf(p) {
  const c = String(p.cls || '').toUpperCase().trim();
  if (YR[c]) return YR[c];
  for (const k of Object.keys(YR)) if (c.startsWith(k)) return YR[k];
  return p.src && p.src.startsWith('returner') ? 3 : 1;
}

// tiny least squares (normal equations) for the preseason power fit
function lstsq(X, y) {
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((row, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j]; A[i][k] += row[i] * y[n]; } });
  for (let i = 0; i < k; i++) {
    let m = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]];
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; }
  }
  return A.map((row, i) => row[k] / row[i]);
}

// minutes-weighted overall of the rotation (top 9 by minutes) — the preseason power feature
export function rosterOvr(team, players, maps) {
  const ps = team.players.map(id => players[id]).filter(p => p && !p.injured).sort((a, b) => (b.mpg || 0) - (a.mpg || 0)).slice(0, 9);
  const m = ps.reduce((s, p) => s + (p.mpg || 0), 0) || 1;
  return ps.reduce((s, p) => s + overall(p, maps) * (p.mpg || 0), 0) / m;
}

// Effective OVR: overall(pillars) adjusted for the competition the pillars were measured against, on a
// power-conference scale — lvlRef is the 75th-percentile league level, so a power-conference player reads about
// his raw rating, a mid-major ~6 lower and a low-major ~12 lower (a Radford "84" reads ~73). 0.6 OVR per level
// point (gentler than the engine's raw level effect, which also carries schedule strength). Generated recruits
// carry lvlRef: their ratings are on this scale already.
export const LVL_OVR = 0.6;
export function effOvr(p, state) {
  return overall(p, state.maps) + LVL_OVR * ((p.lvl ?? state.lvlRef ?? 0) - (state.lvlRef || 0));
}
export function levelRef(teams) {
  const L = Object.values(teams).map(t => t.level || 0).sort((a, b) => a - b);
  return Math.round(L[Math.floor(0.75 * (L.length - 1))] * 100) / 100;
}

export function powerFeatures(team, players, maps) {
  return [1, rosterOvr(team, players, maps), (team.level || 0) / 10, team.sysDef || 0];
}

export function createLeague(snap, sched, opts = {}) {
  const seed = opts.seed ?? ((Date.now() % 1e9) >>> 0);
  const rng = makeRng(seed);
  const maps = { pillarMap: snap.pillarMap, ovrMap: snap.ovrMap, defMap: snap.defMap, heightRef: snap.heightRef };
  const teams = {}, players = {};
  for (const t of snap.teams) {
    teams[t.name] = { name: t.name, conf: t.conf, state: t.state || null, tempo: t.tempo, level: t.level || 0, sysDef: t.sysDef || 0,
      rating0: t.rating, players: t.players.slice(), plan: { tempo: 0, three: 0, pressure: 0 }, minutes: null, starters: null };
  }
  for (const p of snap.players) {
    if (!teams[p.team]) continue;
    const yr = yearOf(p);
    players[p.id] = { id: p.id, name: p.name, team: p.team, pos: p.pos, pos2: p.pos2, ht: p.ht, yr,
      pillars: Object.assign({}, p.pillars), lvl: teams[p.team].level, mpg: p.line.mpg, injured: !!p.injured,
      // hidden growth room (development uses it later): younger players have more, with spread
      pot: Math.round(Math.max(0, (5 - yr) * 2.2 + rng.normal(0, 2.5)) * 10) / 10 };
  }
  // preseason power: projected rating ~ roster overall + league level + scheme defense (fit on this snapshot)
  const X = [], y = [];
  for (const t of Object.values(teams)) if (t.rating0 != null) { X.push(powerFeatures(t, players, maps)); y.push(t.rating0); }
  const powerFit = lstsq(X, y);
  // full schedules: D-I teams with no snapshot roster (shells) + non-D-I opponents (state.ext) get generated rosters
  const pre = { maps, powerFit, teams, players, ext: { teams: {}, players: {} } };
  fillLeague(pre, snap, sched, opts.extras, rng);
  const T = Object.values(teams);
  const pw = T.map(t => powerFeatures(t, players, maps).reduce((s, x, i) => s + x * powerFit[i], 0));
  const lo = Math.min(...pw), hi = Math.max(...pw);
  T.forEach((t, i) => { t.prestige = Math.round(100 * (pw[i] - lo) / (hi - lo)); t.power0 = pw[i]; delete t.rating0; });

  // the real 2026-27 slate: every listed game (incl. non-D-I opponents), the extras file's added games, and the
  // MTE bracket / pool days that resolve from real results as they arrive (state.pending). The regular season
  // ends mid-March (a stray extras game dated April 6 once pushed every conference tournament three weeks late).
  const schedule = buildSchedule(pre, sched, opts.extras, opts.year || 2027);

  // real freshmen's pillar shapes (position + height + profile): generated recruits are rescaled copies
  const templates = Object.values(players).filter(p => p.yr === 1 && p.mpg >= 3).map(p => ({ pos: p.pos, ht: p.ht, pillars: Object.assign({}, p.pillars) }));
  let lw = 0, lm = 0; for (const p of Object.values(players)) { lw += (p.lvl || 0) * (p.mpg || 0); lm += p.mpg || 0; }
  const lvl0 = Math.round(lw / (lm || 1) * 100) / 100;
  const user = opts.user && teams[opts.user] ? opts.user : null;
  const lvlRef = levelRef(teams);
  const state = { v: 2, lvlRef, seed, year: opts.year || 2027, user, phase: 'regular', maps, powerFit, teams, players, schedule, templates, lvl0,
    ext: pre.ext, pending: pre.pending || [],
    stats: {}, results: {}, history: [], userBox: {}, news: [], awards: null, created: opts.now || null };
  state.names = namePool(players);                   // frozen once: recruits draw from it forever
  initCoaches(state, snap, opts.coachName);
  ensureStamina(state);                              // per-player stamina (minutes wear)
  initProgram(state, opts.diff || 'pro');          // staff, hours, schemes, NIL — every team
  state.visits = []; state.targets = []; state.rclass = makeClass(state, classSize(state));   // next year's class, recruitable all season
  return state;
}

// the recruit name pool, captured from the real league at creation. Drawing names from the CURRENT players instead
// drifted: rare names died out every class (1,896 first names -> 357 after 30 seasons).
function namePool(players) {
  const ps = Object.values(players).map(p => p.name.split(' '));
  return { f: [...new Set(ps.map(x => x[0]))], l: [...new Set(ps.map(x => x.slice(1).join(' ')).filter(Boolean))] };
}

// attributes need the maps the snapshot carried — rebuilt on load, never saved
export function hydrate(state) {
  if (state.lvl0 == null) {   // saves from before effective OVR
    let lw = 0, lm = 0; for (const p of Object.values(state.players)) { lw += (p.lvl || 0) * (p.mpg || 0); lm += p.mpg || 0; }
    state.lvl0 = Math.round(lw / (lm || 1) * 100) / 100;
  }
  if (state.lvlRef == null) state.lvlRef = levelRef(state.teams);
  if (!state.job) initCoaches(state, null, null);   // saves from before coaching
  if (!state.news) state.news = [];
  if (!state.names) state.names = namePool(state.players);   // older saves: freeze what they have now
  if (!state.ext) state.ext = { teams: {}, players: {} };      // saves from before full schedules
  if (!state.pending) state.pending = [];
  if (!state.diff || Object.values(state.teams).some(t => !t.prog)) initProgram(state, state.diff || 'pro');   // saves from before programs
  ensureStamina(state);
  if (!state.rclass && state.phase !== 'offseason') { state.visits = state.visits || []; state.rclass = makeClass(state, classSize(state)); }   // saves from before visits
  for (const p of Object.values(state.players)) p.attr = attributes(p, state.maps);
  for (const p of Object.values(state.ext.players)) p.attr = attributes(p, state.maps);
  return state;
}

export function dehydrate(state) {
  return JSON.stringify(state, (k, v) => (k === 'attr' ? undefined : v));
}
