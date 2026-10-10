// Full schedules (Oct 9 2026): every game on a team's real 2026-27 slate gets played.
//   • SHELLS — D-I members with no usable roster in the snapshot (Long Island, Wyoming, Ohio…): a generated
//     roster sized to the team's real power rating. They are ordinary league teams (conference, standings).
//   • EXT — non-D-I opponents (Bethesda, Paine…): a light generated team that plays its games (they count in the
//     D-I team's record, as in real life) but lives in state.ext, outside standings / polls / awards / offseason.
//   • EXTRAS + MTE days — games ESPN had not listed (schedule_extras_2027.json): fixed opponents are added; a
//     4-team bracket's day 2 (winner vs winner) and an event's day 3 (pool) stay in state.pending and become
//     real games on the morning they are played, from the actual day-1 / day-2 results.
// Pure: works on the state object; no DOM, no Supabase.
import { overall } from './ratings.js?v=52';

const EXT_RATING = -26;                         // a typical non-D-I opponent vs an average D-I team
const MPG13 = [33, 31, 29, 27, 24, 19, 14, 10, 7, 4, 2, 1, 0];
const SHAPE = ['G', 'G', 'W', 'B', 'W', 'G', 'B', 'W', 'G', 'B', 'W', 'G', 'B'];
const grp = pos => /C|PF/.test(pos || '') ? 'B' : /SF|F/.test(pos || '') ? 'W' : 'G';
const clamp = v => Math.max(1, Math.min(99, v));

// a roster whose minutes-weighted overall puts the team's preseason power at `rating`
function genRoster(state, team, rating, n, rng, templates, names, maps) {
  const f = state.powerFit, lvl = team.level || 0;
  const wantOvr = (rating - f[0] - f[2] * lvl / 10 - f[3] * (team.sysDef || 0)) / f[1];
  const byG = { G: [], W: [], B: [] }; templates.forEach(t => byG[grp(t.pos)].push(t));
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = SHAPE[i % SHAPE.length], pool = byG[g].length ? byG[g] : templates, tp = pool[rng.int(pool.length)];
    const nm = names[rng.int(names.length)];
    out.push({ id: `gen:${team.name}:${i}`, name: `${nm[0]} ${nm[nm.length - 1]}`, team: team.name, pos: tp.pos, pos2: '', ht: tp.ht,
      yr: 1 + rng.int(4), base: Object.assign({}, tp.pillars), pillars: null, lvl, mpg: MPG13[i] || 0, injured: false,
      pot: Math.round(Math.max(0, rng.normal(3, 2)) * 10) / 10, gen: true });
  }
  const ovrOf = d => {
    let w = 0, s = 0;
    for (const p of out) { p.pillars = Object.fromEntries(Object.entries(p.base).map(([k, v]) => [k, clamp(Math.round(v + d))])); if (p.mpg) { s += overall(p, maps) * p.mpg; w += p.mpg; } }
    return s / (w || 1);
  };
  let lo = -45, hi = 45;
  for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (ovrOf(mid) < wantOvr) lo = mid; else hi = mid; }
  ovrOf((lo + hi) / 2);
  out.forEach(p => delete p.base);
  return out;
}

const blankTeam = (name, conf, tempo, level) => ({ name, conf, tempo, level, sysDef: 0, players: [], plan: { tempo: 0, three: 0, pressure: 0 }, minutes: null, starters: null });

/** call inside createLeague, after powerFit and before prestige */
export function fillLeague(state, snap, sched, extras, rng) {
  const maps = state.maps, teams = state.teams, players = state.players;
  const templates = Object.values(players).filter(p => p.yr <= 2 && (p.mpg || 0) >= 3).map(p => ({ pos: p.pos, ht: p.ht, pillars: p.pillars }));
  const names = Object.values(players).map(p => String(p.name).split(' ')).filter(x => x.length >= 2);
  const lvls = Object.values(teams).map(t => t.level || 0), lvlMin = Math.min(...lvls);
  const tempoMu = Object.values(teams).reduce((s, t) => s + (t.tempo || 69), 0) / Object.keys(teams).length;
  // 1. D-I shells
  for (const sh of snap.shells || []) {
    if (teams[sh.name]) continue;
    const t = teams[sh.name] = Object.assign(blankTeam(sh.name, sh.conf, sh.tempo || tempoMu, sh.level || 0), { shell: true, state: sh.state || null });
    const rating = sh.rating != null ? sh.rating : -12;
    for (const p of genRoster(state, t, rating, 13, rng, templates, names, maps)) { players[p.id] = p; t.players.push(p.id); }
  }
  // 2. every opponent the schedule + extras name that is still unknown -> a non-D-I team
  state.ext = state.ext || { teams: {}, players: {} };
  const want = new Set(sched.games.flatMap(g => [sched.teams[g[2]], sched.teams[g[3]]]));
  for (const [k, list] of Object.entries(extras || {})) if (k !== '_doc' && Array.isArray(list)) list.forEach(x => { if (x.opp) want.add(x.opp); });
  for (const nm of want) {
    if (teams[nm] || state.ext.teams[nm]) continue;
    const t = state.ext.teams[nm] = Object.assign(blankTeam(nm, 'Non-D-I', tempoMu, lvlMin), { ext: true });
    for (const p of genRoster(state, t, EXT_RATING, 11, rng, templates, names, maps)) { state.ext.players[p.id] = p; t.players.push(p.id); }
  }
}

const known = (state, n) => !!(state.teams[n] || (state.ext && state.ext.teams[n]));

/** the real slate: D-I games, games vs non-D-I opponents, and the extras file (fixed games + pending MTE days) */
export function buildSchedule(state, sched, extras, year) {
  const names = sched.teams, seen = new Set();
  const key = (d, a, b) => d + '|' + [a, b].sort().join('|');
  const games = [];
  for (const g of sched.games) {
    const h = names[g[2]], a = names[g[3]];
    if (!known(state, h) || !known(state, a) || g[1] > `${year}-03-15`) continue;   // regular season ends mid-March
    if (!state.teams[h] && !state.teams[a]) continue;                                   // two non-D-I teams
    seen.add(key(g[1], h, a));
    games.push({ id: String(g[0]), d: g[1], h, a, n: !!g[4], c: !!g[5], r: null });
  }
  state.pending = [];
  for (const [team, list] of Object.entries(extras || {})) {
    if (team === '_doc' || !Array.isArray(list) || !state.teams[team]) continue;
    for (const x of list) {
      if (!x.date || x.date > `${year}-03-15`) continue;
      if (x.opp) {
        if (!known(state, x.opp) || seen.has(key(x.date, team, x.opp))) continue;
        seen.add(key(x.date, team, x.opp));
        const [h, a] = x.where === 'A' ? [x.opp, team] : [team, x.opp];
        games.push({ id: `x-${x.date}-${team}`.slice(0, 80), d: x.date, h, a, n: x.where === 'N', c: false, r: null, ev: x.event || '' });
      } else if (x.opps || x.pool) {
        state.pending.push({ d: x.date, team, type: x.opps ? 'bracket' : 'pool', opps: x.opps || null, pool: x.pool || null, ev: x.event || '', done: false });
      }
    }
  }
  for (const g of games) if (!g.n && state.teams[g.h] && state.teams[g.a]) g.c = g.c || state.teams[g.h].conf === state.teams[g.a].conf;
  // a few programs have not released every date (Howard: 25 listed): top them up to MIN_GAMES with home games vs
  // non-D-I opponents on open November / December days, flagged `fill` so the UI can say so
  const MIN_GAMES = 29, count = {}, days = {};
  for (const g of games) for (const t of [g.h, g.a]) { count[t] = (count[t] || 0) + 1; (days[t] = days[t] || new Set()).add(g.d); }
  for (const p of state.pending) count[p.team] = (count[p.team] || 0) + 1;
  const extNames = Object.keys(state.ext.teams).sort(), slots = [];
  for (let d = Date.UTC(year - 1, 10, 4); d <= Date.UTC(year - 1, 11, 30); d += 864e5) slots.push(new Date(d).toISOString().slice(0, 10));
  let k = 0;
  for (const t of Object.keys(state.teams).sort()) {
    let need = MIN_GAMES - (count[t] || 0);
    for (let i = 0; need > 0 && i < slots.length; i += 3) {
      const d = slots[(i + k * 7) % slots.length], prev = slots[Math.max(0, (i + k * 7) % slots.length - 1)], next = slots[((i + k * 7) % slots.length) + 1];
      const D = days[t] || new Set();
      if (D.has(d) || D.has(prev) || D.has(next) || !extNames.length) continue;
      const opp = extNames[(k * 13 + i) % extNames.length];
      games.push({ id: `fill-${year}-${t}-${d}`.slice(0, 90), d, h: t, a: opp, n: false, c: false, r: null, fill: true });
      D.add(d); days[t] = D; need--;
    }
    k++;
  }
  return games.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

// ── pending MTE days become real games on the morning they are played ──
const winnerOf = g => (g.r[0] > g.r[1] ? g.h : g.a), loserOf = g => (g.r[0] > g.r[1] ? g.a : g.h);
function lastGame(state, a, b, before) {
  let best = null;
  for (const g of state.schedule) if (g.r && g.d < before && ((g.h === a && g.a === b) || (g.h === b && g.a === a)) && (!best || g.d > best.d)) best = g;
  return best;
}
function lastOf(state, t, before) {
  let best = null;
  for (const g of state.schedule) if (g.r && g.d < before && (g.h === t || g.a === t) && (!best || g.d > best.d)) best = g;
  return best;
}
const busy = (state, t, d) => state.schedule.some(g => g.d === d && (g.h === t || g.a === t));
const faced = (state, a, b) => state.schedule.some(g => (g.h === a && g.a === b) || (g.h === b && g.a === a));

export function nextPendingDate(state) {
  let d = null; for (const x of state.pending || []) if (!x.done && (!d || x.d < d)) d = x.d;
  return d;
}

/** turn the pending entries dated `d` into games (call before the day is simulated); returns games added */
export function resolvePending(state, d, rng) {
  const P = (state.pending || []).filter(x => x.d === d && !x.done);
  if (!P.length) return [];
  const add = [];
  const mk = (a, b, ev) => { const g = { id: `p-${d}-${a}-${b}`.slice(0, 90), d, h: a, a: b, n: true, c: false, r: null, ev }; state.schedule.push(g); add.push(g); };
  // brackets: my day-1 result picks the other pair's winner or loser
  for (const x of P.filter(x => x.type === 'bracket')) {
    if (x.done || busy(state, x.team, d)) { x.done = true; continue; }
    const mine = lastOf(state, x.team, d), iWon = mine ? winnerOf(mine) === x.team : rng.chance(0.5);
    const [A, B] = x.opps, pg = lastGame(state, A, B, d);
    let opp = pg ? (iWon ? winnerOf(pg) : loserOf(pg)) : (rng.chance(0.5) ? A : B);
    if (!known(state, opp) || busy(state, opp, d)) opp = [A, B].find(t => known(state, t) && !busy(state, t, d));
    x.done = true;
    if (!opp) continue;
    mk(x.team, opp, x.ev);
    for (const y of P) if (y.team === opp) y.done = true;
  }
  // pools (day 3): pair teams with matching event records, never a rematch
  const rec = t => { let w = 0; for (const g of state.schedule) if (g.r && g.ev && (g.h === t || g.a === t) && g.d < d && g.d >= addDays(d, -4)) w += winnerOf(g) === t ? 1 : 0; return w; };
  const pool = P.filter(x => x.type === 'pool' && !x.done).sort((a, b) => rec(b.team) - rec(a.team));
  for (const x of pool) {
    if (x.done || busy(state, x.team, d)) { x.done = true; continue; }
    const r0 = rec(x.team);
    const cands = (x.pool || []).filter(t => known(state, t) && !busy(state, t, d) && !faced(state, x.team, t))
      .sort((a, b) => Math.abs(rec(a) - r0) - Math.abs(rec(b) - r0) || (P.some(y => y.team === b && !y.done) - P.some(y => y.team === a && !y.done)));
    x.done = true;
    if (!cands.length) continue;
    const opp = cands[0];
    mk(x.team, opp, x.ev);
    for (const y of P) if (y.team === opp) y.done = true;
  }
  state.schedule.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return add;
}
function addDays(iso, n) { return new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }

export { EXT_RATING };
