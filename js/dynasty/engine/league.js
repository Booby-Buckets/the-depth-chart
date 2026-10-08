// A new dynasty: the snapshot's 350 teams + players become a saveable league state (plain JSON — the UI keeps
// it in IndexedDB). Pure: the caller hands in the parsed snapshot / schedule / conference files.
//
// state = {
//   v, seed, year, user, phase, maps,                 maps = the snapshot's pillar/overall/defense fits
//   teams:   { name: { name, conf, tempo, level, sysDef, prestige, players:[ids], plan, minutes, starters } },
//   players: { id: { id, name, team, pos, pos2, ht, yr, pillars, lvl, mpg, pot } },
//   schedule:[ { id, d, h, a, n, c, r } ],             r = [homePts, awayPts, ot, poss] once played
//   stats:   { id: season totals },  powerFit, history:[], userBox:{ gameId: box } }
import { attributes, overall } from './ratings.js';
import { makeRng } from './rng.js';

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

export function powerFeatures(team, players, maps) {
  return [1, rosterOvr(team, players, maps), (team.level || 0) / 10, team.sysDef || 0];
}

export function createLeague(snap, sched, opts = {}) {
  const seed = opts.seed ?? ((Date.now() % 1e9) >>> 0);
  const rng = makeRng(seed);
  const maps = { pillarMap: snap.pillarMap, ovrMap: snap.ovrMap, defMap: snap.defMap, heightRef: snap.heightRef };
  const teams = {}, players = {};
  for (const t of snap.teams) {
    teams[t.name] = { name: t.name, conf: t.conf, tempo: t.tempo, level: t.level || 0, sysDef: t.sysDef || 0,
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
  const T = Object.values(teams);
  const pw = T.map(t => powerFeatures(t, players, maps).reduce((s, x, i) => s + x * powerFit[i], 0));
  const lo = Math.min(...pw), hi = Math.max(...pw);
  T.forEach((t, i) => { t.prestige = Math.round(100 * (pw[i] - lo) / (hi - lo)); t.power0 = pw[i]; delete t.rating0; });

  // the real 2026-27 slate, D-I vs D-I games between league teams
  const names = sched.teams;
  const schedule = sched.games.map(g => ({ id: String(g[0]), d: g[1], h: names[g[2]], a: names[g[3]], n: !!g[4], c: !!g[5], r: null }))
    .filter(g => teams[g.h] && teams[g.a])
    // the regular season ends by mid-March (one stray extras-file game dated April 6 pushed every
    // conference tournament three weeks late)
    .filter(g => g.d <= `${opts.year || 2027}-03-15`)
    .map(g => Object.assign(g, { c: g.c || (teams[g.h].conf === teams[g.a].conf && !g.n) }))
    .sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);

  const user = opts.user && teams[opts.user] ? opts.user : null;
  return { v: 1, seed, year: opts.year || 2027, user, phase: 'regular', maps, powerFit, teams, players, schedule,
    stats: {}, results: {}, history: [], userBox: {}, created: opts.now || null };
}

// attributes need the maps the snapshot carried — rebuilt on load, never saved
export function hydrate(state) {
  for (const p of Object.values(state.players)) p.attr = attributes(p, state.maps);
  return state;
}

export function dehydrate(state) {
  return JSON.stringify(state, (k, v) => (k === 'attr' ? undefined : v));
}
