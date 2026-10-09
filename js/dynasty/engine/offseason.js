// The offseason: recap -> departures (graduation, early pro entry, transfer portal entrants) -> portal
// (offers + AI placement) -> recruiting (a generated high-school class, the user's board, AI signing) ->
// development + a generated schedule -> next season. Pure: everything works on the state object; each step
// has its own seeded stream so a save replays identically.
//
// Calibrated to the snapshot: freshmen enter at a median OVR ~59 (top 1% ~77); players gain ~+5 Fr->So,
// ~+3 So->Jr, ~+1.5 after; teams lose ~3.4 upperclassmen a year; rosters carry 13 scholarships.
import { overall, attributes } from './ratings.js?v=16';
import { makeRng, hashSeed } from './rng.js?v=16';
import { record_, power, touch } from './season.js?v=16';
import { ncaaResult } from './postseason.js?v=16';
import { effOvr } from './league.js?v=16';
import { evaluateCoaches } from './coaching.js?v=16';
import { healAll } from './injuries.js?v=16';
import { DIFFS, devMult, focusBonus, recruitPoints, nilRetention, nilOffer, newSeasonProgram } from './program.js?v=16';

export const SCHOLARSHIPS = 13;
const PIL = ['SCO', 'SHT', 'FIN', 'PLY', 'SEC', 'REB', 'DEF'];
const rngFor = (state, tag) => makeRng(hashSeed(`${state.seed}:${state.year}:off:${tag}`));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const ovr = (state, p) => overall(p, state.maps);          // raw pillar overall (development / recruit targets)
const eff = (state, p) => effOvr(p, state);                  // what a coach / player sees

// OVR moves linearly with the pillars: shifting every pillar by d moves OVR by d * (sum of pillar coefs) / 15
function ovrPerPillar(maps) {
  const m = maps.ovrMap; let s = 0;
  m.terms.forEach((t, i) => { if (t !== '1' && t !== 'ht') s += m.coef[i]; });
  return s / 15;
}
// nudge a pillar vector until its OVR is `target`, with the gain spread unevenly (random weights)
// (pillars weigh unequally in OVR, so measure and correct a few times — one pass overshot by up to ~7)
function shiftTo(state, p, target, rng, spread = 0.6) {
  const k = ovrPerPillar(state.maps);
  const w = PIL.map(() => Math.max(0.05, 1 + rng.normal(0, spread))), ws = w.reduce((a, b) => a + b, 0);
  const coef = Object.fromEntries(state.maps.ovrMap.terms.map((t, i) => [t, state.maps.ovrMap.coef[i]]));
  for (let it = 0; it < 6; it++) {
    const miss = target - ovr(state, p); if (Math.abs(miss) < 0.5) break;
    // ovr gain from moving each pillar by w_i * u is u * sum(w_i * coef_i) / 15
    const per = PIL.reduce((s, x, i) => s + w[i] * coef[x], 0) / 15;
    const u = miss / (per || k * ws / 7);
    PIL.forEach((x, i) => { p.pillars[x] = clamp(Math.round(p.pillars[x] + u * w[i]), 1, 99); });
  }
}

// ── 1. recap: history row, prestige ──
export function beginOffseason(state) {
  // archive every player's season line (career history on the player card)
  for (const [id, s] of Object.entries(state.stats)) {
    const p = state.players[id]; if (!p || !s.g) continue;
    (p.hist = p.hist || []).push({ y: state.year, team: s.team || p.team, g: s.g, mpg: +(s.min / s.g).toFixed(1), ppg: +(s.pts / s.g).toFixed(1),
      rpg: +((s.orb + s.drb) / s.g).toFixed(1), apg: +(s.ast / s.g).toFixed(1), ovr: Math.round(effOvr(p, state)) });
    if (p.hist.length > 6) p.hist.shift();
  }
  if (state.job) evaluateCoaches(state);
  const pw = power(state), order = Object.keys(pw).sort((a, b) => pw[b] - pw[a]);
  const N = state.post && state.post.ncaa;
  const rec = state.user ? record_(state, state.user) : null;
  state.history.push({
    year: state.year, champ: N && N.champ, top: order.slice(0, 5), awards: state.awards || null,
    coach: state.teams[state.user] && state.teams[state.user].coach ? state.teams[state.user].coach.name : null,
    user: state.user && Object.assign({ team: state.user, rank: order.indexOf(state.user) + 1, post: ncaaResult(state, state.user) || 'No NCAA bid' }, rec),
  });
  // prestige: 65% memory, 35% this season (power percentile + a tournament bump)
  const bump = { Champion: 25, 'Runner-up': 18, 'Final Four': 14, 'Elite Eight': 9, 'Sweet 16': 6, 'Round of 32': 3, 'Round of 64': 1 };
  order.forEach((t, i) => {
    const pct = 100 * (1 - i / (order.length - 1));
    const T = state.teams[t];
    T.prestige = Math.round(clamp(0.65 * T.prestige + 0.35 * Math.min(100, pct + (bump[ncaaResult(state, t)] || 0)), 1, 100));
  });
  state.phase = 'offseason';
  state.off = { step: 'departures', leaving: {}, portal: [], offers: {}, recruits: null, board: {}, signed: {}, log: [],
    budget: state.user ? recruitPoints(state, state.teams[state.user]) : 100 };   // the season's recruiting hours = signing-day effort
  markDepartures(state);
}

// who leaves: graduates (all 5th years, ~75% of 4th years), early pro entrants (elite players), portal entrants
function markDepartures(state) {
  const rng = rngFor(state, 'departures'), L = state.off.leaving;
  // early-entry bars by league percentile (top ~1% / 2.5% / 4% of rated players), so the scale can't inflate them
  const E = Object.values(state.players).filter(p => p.team && (p.mpg || 0) >= 10).map(p => eff(state, p)).sort((a, b) => b - a);
  const at = q => E[Math.min(E.length - 1, Math.floor(q * E.length))] ?? 99;
  const P1 = at(0.01), P2 = at(0.025), P3 = at(0.04);
  const roles = {};   // expected next-season minutes rank within each team (by OVR)
  for (const t of Object.values(state.teams)) {
    t.players.map(id => state.players[id]).filter(Boolean).sort((a, b) => eff(state, b) - eff(state, a)).forEach((p, i) => { roles[p.id] = i; });
  }
  for (const p of Object.values(state.players)) {
    if (!p.team) continue;
    const o = eff(state, p);
    if (p.yr >= 5 || (p.yr === 4 && rng.chance(0.75))) { L[p.id] = 'graduated'; continue; }
    // early entry: the best players go pro (a top-1% sophomore+ almost always, a top freshman sometimes)
    const pro = o >= P1 ? 0.75 : o >= P2 ? 0.4 : o >= P3 ? 0.15 : 0;
    if (pro && rng.chance(p.yr === 1 ? pro * 0.7 : pro)) { L[p.id] = 'pro'; continue; }
    // portal: buried players with game transfer most; everyone has a small base rate
    const buried = roles[p.id] >= 8 && o >= 62, starved = roles[p.id] >= 6 && o >= 70;
    // the NIL collective buys off part of the temptation (a well-funded program keeps its players)
    const pp = (0.07 + (buried ? 0.35 : 0) + (starved ? 0.2 : 0) + (p.yr === 4 ? 0.25 : 0)) * (1 - nilRetention(state, state.teams[p.team]));
    if (rng.chance(pp)) L[p.id] = 'portal';
  }
}

// ── 2. departures take effect; portal opens ──
export function processDepartures(state) {
  const L = state.off.leaving;
  for (const [id, why] of Object.entries(L)) {
    const p = state.players[id]; if (!p) continue;
    const t = state.teams[p.team]; if (t) t.players = t.players.filter(x => x !== id);
    if (why === 'portal') { p.from = p.team; p.team = null; state.off.portal.push(id); }
    else delete state.players[id];
  }
  state.off.portal.sort((a, b) => eff(state, state.players[b]) - eff(state, state.players[a]));
  state.off.step = 'portal';
}

export const openSpots = (state, team) => Math.max(0, SCHOLARSHIPS - state.teams[team].players.length);

// what a team can offer a player: prestige, plus minutes (how far he'd beat the team's 7th-best player)
function appeal(state, team, p) {
  const t = state.teams[team];
  const os = t.players.map(id => eff(state, state.players[id])).sort((a, b) => b - a);
  const seventh = os[6] ?? 50, minutes = clamp((eff(state, p) - seventh) / 6, -1.5, 1.5);
  return t.prestige / 25 + minutes + 0.8 * nilOffer(state, t);
}

// ── 3. portal: the user's offers first-class, then everyone signs where the appeal is best ──
export function resolvePortal(state) {
  const rng = rngFor(state, 'portal'), O = state.off.offers, U = state.user, out = [];
  for (const id of state.off.portal) {
    const p = state.players[id]; if (!p) continue;
    const cands = Object.keys(state.teams).filter(t => t !== p.from && openSpots(state, t) > 0);
    let best = null, bestS = -1e9;
    for (const t of cands) {
      if (t === U && !O[id]) continue;                       // the user only gets players he offered
      const s = appeal(state, t, p) + rng.normal(0, 0.9) + (t === U ? 0.6 : 0) + (state.teams[t].conf === state.teams[p.from]?.conf ? -0.3 : 0);
      if (s > bestS) { bestS = s; best = t; }
    }
    if (best && (eff(state, p) >= 58 || best === U)) {
      p.team = best; state.teams[best].players.push(id);
      if (best === U || O[id]) out.push({ id, name: p.name, to: best, from: p.from, ovr: Math.round(eff(state, p)) });
    } else delete state.players[id];                        // nobody took him: out of D-I
  }
  state.off.portalResults = out;
  state.off.step = 'recruiting';
  state.off.recruits = makeClass(state);
}

// ── 4. recruiting ──
const STAR_OVR = [null, [47, 54], [53, 61], [60, 68], [67, 74], [73, 80]];
function makeClass(state) {
  const rng = rngFor(state, 'class');
  const spots = Object.keys(state.teams).reduce((s, t) => s + openSpots(state, t), 0);
  const n = spots + 300;   // enough that the last teams to sign still find D-I-level players
  // templates: real freshmen pillar profiles (position + height + shape), rescaled to each recruit's level
  const tpl = state.templates && state.templates.length ? state.templates
    : Object.values(state.players).filter(p => p.yr <= 2).map(p => ({ pos: p.pos, ht: p.ht, pillars: p.pillars }));
  const names = Object.values(state.players).map(p => p.name.split(' '));
  const firsts = names.map(x => x[0]), lasts = names.map(x => x.slice(1).join(' ')).filter(Boolean);
  const out = [];
  for (let i = 0; i < n; i++) {
    const stars = i < 25 ? 5 : i < 125 ? 4 : i < 525 ? 3 : i < 1100 ? 2 : 1;
    const [lo, hi] = STAR_OVR[Math.max(1, stars)];
    const target = hi - (hi - lo) * rng.next() ** 1.4;
    const t = tpl[rng.int(tpl.length)];
    const r = { id: `r${state.year}-${i}`, name: `${firsts[rng.int(firsts.length)]} ${lasts[rng.int(lasts.length)]}`,
      pos: t.pos, ht: t.ht, stars, pillars: Object.assign({}, t.pillars), yr: 1,
      pot: Math.round((stars * 1.6 + 2 + rng.normal(0, 2)) * 10) / 10 };
    shiftTo(state, r, target, rng);
    r.scout = Math.round(ovr(state, r) + rng.normal(0, 2.5));      // what the user sees
    out.push(r);
  }
  out.sort((a, b) => b.scout - a.scout).forEach((r, i) => { r.rank = i + 1; });
  return out;
}

// how much prestige a recruit expects: where the AI order would send him
function recruitAppeal(state, rank) {
  const pres = Object.values(state.teams).map(t => t.prestige).sort((a, b) => b - a);
  return pres[Math.min(pres.length - 1, Math.floor((rank - 1) / 4))];
}
export function landOdds(state, r, effort) {
  const p = state.teams[state.user].prestige, need = recruitAppeal(state, r.rank);
  const x = (p - need) / 9 + (effort - 15) / 12 + (DIFFS[state.diff || 'pro'].recruit || 0) + nilOffer(state, state.teams[state.user]);
  return 1 / (1 + Math.exp(-x));
}

export function resolveRecruiting(state) {
  const rng = rngFor(state, 'signing'), U = state.user, B = state.off.board || {}, signed = [];
  const pool = state.off.recruits.slice();
  const take = (r, team) => {
    const p = { id: r.id, name: r.name, team, pos: r.pos, ht: r.ht, yr: 1, pillars: r.pillars, pot: r.pot, stars: r.stars,
      lvl: state.lvlRef || 0, mpg: 0, injured: false, fresh: true };
    state.players[p.id] = p; state.teams[team].players.push(p.id);
    pool.splice(pool.indexOf(r), 1);
  };
  // the user's board: best targets first, while spots last
  for (const r of pool.filter(r => B[r.id] > 0).sort((a, b) => a.rank - b.rank)) {
    if (!openSpots(state, U)) break;
    const won = rng.chance(landOdds(state, r, B[r.id]));
    signed.push({ id: r.id, name: r.name, stars: r.stars, rank: r.rank, won });
    if (won) take(r, U);
  }
  // everyone else: rounds by prestige (with noise); each team takes one of the best few left, until full
  for (let round = 0; round < 30; round++) {
    const order = Object.keys(state.teams).filter(t => t !== U && openSpots(state, t) > 0)
      .map(t => [t, state.teams[t].prestige + rng.normal(0, 8)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    if (!order.length) break;
    for (const t of order) {
      if (!pool.length) break;
      take(pool[Math.min(pool.length - 1, rng.int(3))], t);
    }
  }
  // the user's leftover spots go to walk-ons (the best unsigned) — a roster always reaches 13
  while (U && openSpots(state, U) && pool.length) take(pool[0], U);
  state.off.signed = signed;
  state.off.step = 'ready';
}

// ── 5. development, minutes, schedule, new season ──
const GROW = { 1: 5, 2: 3, 3: 1.6, 4: 1 };
export function startNextSeason(state) {
  const rng = rngFor(state, 'develop');
  state.off.progress = {};
  for (const p of Object.values(state.players)) {
    if (!p.team) continue;
    if (p.fresh) { delete p.fresh; continue; }                       // incoming freshmen: no growth yet
    const before = ovr(state, p);
    const T = state.teams[p.team];
    const g = (GROW[p.yr] || 0.6) * (0.55 + (p.pot || 0) / 12) * devMult(T) + rng.normal(0, 1.8);   // development staff + hours
    shiftTo(state, p, before + g, rng, 0.8);
    // the season's practice focus carries into the summer
    const fb = focusBonus(T); if (fb && T.prog && T.prog.focus) for (const k of T.prog.focus) p.pillars[k] = clamp(Math.round(p.pillars[k] + fb), 1, 99);
    p.pot = Math.max(0, Math.round(((p.pot || 0) - Math.max(0, g) * 0.5) * 10) / 10);
    p.yr = Math.min(5, p.yr + 1);
    if (p.team === state.user) state.off.progress[p.id] = Math.round(ovr(state, p) - before);
  }
  healAll(state);
  for (const p of Object.values(state.players)) p.attr = attributes(p, state.maps);
  for (const t of Object.values(state.teams)) {
    defaultMinutes(state, t); t.minutes = null; t.starters = null;
    // scheme edges fade (staff turnover, the league adapts): system defense regresses 20% a year toward 0
    t.sysDef = Math.round((t.sysDef || 0) * 0.8 * 100) / 100;
  }
  newSeasonProgram(state);          // NIL payroll, staff contracts + poaching, familiarity fades, hiring pool
  state.year += 1;
  state.schedule = makeSchedule(state);
  state.stats = {}; state.userBox = {}; state.post = null; state.awards = null;
  state.phase = 'regular';
  state.lastOff = { progress: state.off.progress, signed: state.off.signed, portalResults: state.off.portalResults };
  state.off = null;
  touch(state);
}

// the coach's default rotation: minutes by OVR rank (a real coach's shape), at least one guard and one big
const SHAPE = [33, 32, 30, 28, 25, 19, 14, 9, 6, 3, 1, 0, 0, 0, 0];
export function defaultMinutes(state, t) {
  const ps = t.players.map(id => state.players[id]).filter(Boolean).sort((a, b) => eff(state, b) - eff(state, a));
  const isBig = p => p.pos === 'C' || p.pos === 'PF' || (p.ht || 78) >= 81, isG = p => p.pos === 'PG' || p.pos === 'SG' || (p.ht || 78) <= 75;
  const top = ps.slice(0, 5);
  for (const need of [isBig, isG]) if (!top.some(need)) { const s = ps.slice(5).find(need); if (s) { const i = ps.indexOf(s); ps.splice(i, 1); ps.splice(4, 0, s); top.splice(4, 1, s); } }
  const sum = SHAPE.slice(0, ps.length).reduce((a, b) => a + b, 0) || 1;
  ps.forEach((p, i) => { p.mpg = Math.round((SHAPE[i] || 0) * 200 / sum * 10) / 10; });
}

// ── schedule: conference round robins (Jan–early Mar) + 11 non-conference games (Nov–Dec) ──
const ISO = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const addD = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function circle(teams) {
  const t = teams.length % 2 ? teams.concat([null]) : teams.slice(), n = t.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) { const a = t[i], b = t[n - 1 - i]; if (a && b) pairs.push(r % 2 ? [a, b] : [b, a]); }
    rounds.push(pairs); t.splice(1, 0, t.pop());
  }
  return rounds;
}
export function makeSchedule(state) {
  const rng = rngFor(state, 'schedule'), y = state.year, games = [];
  let gid = 0;
  const add = (d, h, a, n, c) => games.push({ id: `${y}-${gid++}`, d, h, a, n, c, r: null });
  // conference: double round robin for leagues of <= 10, single + rematches to ~18-20 games otherwise
  const confs = {};
  for (const t of Object.values(state.teams)) (confs[t.conf] = confs[t.conf] || []).push(t.name);
  for (const members of Object.values(confs)) {
    const R = circle(members.slice().sort(() => rng.next() - 0.5));
    let rounds = R.concat(R.map(rd => rd.map(([h, a]) => [a, h])));
    const want = Math.min(rounds.length, members.length <= 10 ? rounds.length : 20);
    rounds = rounds.slice(0, want);
    const start = ISO(y, 1, 2), step = Math.max(2, Math.floor(64 / Math.max(1, rounds.length)));
    rounds.forEach((rd, i) => rd.forEach(([h, a]) => add(addD(start, i * step), h, a, false, true)));
  }
  // non-conference: 13 rounds of random pairings across leagues (Nov 3 – Dec 30) — with ~18-20 league games that
  // is a real ~31-33 game slate (11 rounds left teams around 29)
  const names = Object.keys(state.teams);
  for (let r = 0; r < 13; r++) {
    const pool = names.slice().sort(() => rng.next() - 0.5), used = new Set(), d = addD(ISO(y - 1, 11, 3), r * 4 + rng.int(3));
    for (const a of pool) {
      if (used.has(a)) continue;
      const b = pool.find(x => !used.has(x) && x !== a && state.teams[x].conf !== state.teams[a].conf);
      if (!b) continue;
      used.add(a); used.add(b);
      const neutral = rng.chance(0.12);
      const [h, w] = rng.chance(0.5 + (state.teams[a].prestige - state.teams[b].prestige) / 200) ? [a, b] : [b, a];
      add(d, h, w, neutral, false);
    }
  }
  return games.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
