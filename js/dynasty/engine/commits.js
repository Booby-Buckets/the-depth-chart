// Recruiting as a season-long race (Oct 2026, owner: "harder than someone just accepting a deal — commitments, etc.;
// look at the EA / Madden / 2K UIs"). Modeled on EA's College Football 25:
//   • OFFERS — a recruit only considers schools that offered him. Every AI program offers at its own level and for its
//     position needs (~3 offers per open spot); a 3-star would commit to a blue blood, it just rarely gets offered.
//   • INTEREST — every week each school on his list earns interest points: its recruiting hours on him x how well it
//     matches what HE values (recruit.js factors/utility, the same math as before). The user spends a weekly budget of
//     hours on actions (DM, family call, home visit, soft/hard sell), the AI spreads its staff's time.
//   • STAGES — he cuts his list on a schedule: Top 8, Top 5, Top 3 (a school below one of his DEALBREAKERS is cut first).
//   • COMMITS — once a school leads clearly he commits (verbal). A commit is SOFT: if another school on his list passes
//     his commit school by a wide margin he can flip. Signing (early period, Nov 18, or signing day) is final.
//   • A SUMMER — real recruiting starts long before November, so each new class gets a few simulated summer weeks:
//     offers go out (the user's staff included), the clearest leads commit early, and the user arrives with work to do.
// Rosters: 16 scholarships (the service academies carry more). Pure; deterministic per seed.
import { makeRng, hashSeed } from './rng.js?v=62';
import { profile, factors, utility, aiOffer, aiRel, relationship, miles, HOME_W, XY } from './recruit.js?v=62';
import { effort, DIFFS } from './program.js?v=62';
import { admitP } from './people.js?v=62';
import { news as push } from './injuries.js?v=62';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const MILITARY = /^(Army|Navy|Air Force)\b/;
export const rosterMax = (state, team) => (MILITARY.test(team) ? 20 : 16);
export const STAGES = [['open', 'Open'], ['t8', 'Top 8'], ['t5', 'Top 5'], ['t3', 'Top 3'], ['commit', 'Committed'], ['signed', 'Signed']];
export const STAGE_LABEL = Object.fromEntries(STAGES);
// recruiting weeks are counted from the start of the summer: SUMMER weeks, then the season's weeks
export const SUMMER = 6;
const CUTS = { 8: ['t8', 8], 12: ['t5', 5], 16: ['t3', 3] };   // week -> [stage, list size]  (mid-Nov, mid-Dec, mid-Jan)
export const cutWeeks = { t8: 8, t5: 12, t3: 16 };
export const USER_OFFERS_MAX = 25, HOURS_CAP = 50, AI_SPREAD = 12;
// the user's weekly actions on one recruit (hours); pitches unlock at the Top 5, a home visit once a season
export const ACTIONS = [
  ['scout', 'Scout him', 10, 'Sharpens his ratings · enough reveals a gem or a bust (no offer needed)'],
  ['dm', 'Text / DM', 10, 'Small and steady'],
  ['call', 'Call his family', 25, 'Builds the relationship'],
  ['home', 'Head-coach home visit', 50, 'Once a season · a big jump'],
  ['soft', 'Soft sell', 20, 'Top 5+ · pitch what he values most, safely'],
  ['hard', 'Hard sell', 40, 'Top 5+ · big swing: backfires if you grade C or worse on his top priority'],
];
const ACT = Object.fromEntries(ACTIONS.map(a => [a[0], a]));
const G = pos => (/C|PF/.test(pos || '') ? 'B' : /SF|F/.test(pos || '') ? 'W' : 'G');

const rngFor = (state, tag) => makeRng(hashSeed(`${state.seed}:${state.year}:rec:${tag}`));
const cls = state => state.rclass || [];
const byId = (state, id) => cls(state).find(r => r.id === id);
/** letter grade for a 0-1 factor score */
export const grade = x => (x >= 0.9 ? 'A+' : x >= 0.82 ? 'A' : x >= 0.75 ? 'A-' : x >= 0.68 ? 'B+' : x >= 0.6 ? 'B' : x >= 0.53 ? 'B-' : x >= 0.46 ? 'C+' : x >= 0.38 ? 'C' : x >= 0.3 ? 'C-' : x >= 0.2 ? 'D' : 'F');
const DB_KEYS = [['pt', 'Playing time'], ['prox', 'Close to home'], ['acad', 'Academics'], ['team', 'Winning now'], ['brand', 'Brand'], ['nil', 'NIL money']];
export const dbLabel = k => (DB_KEYS.find(x => x[0] === k) || [k, k])[1];

// ── roster math ──
/** players returning next season (freshmen through juniors; seniors and grads leave) */
const returning = (state, team) => state.teams[team].players.filter(id => { const p = state.players[id]; return p && (p.yr || 1) <= 3; }).length;
/** scholarships the class can fill: roster max - returning - one expected transfer out (never below 1) */
export function classNeed(state, team) { return Math.max(1, rosterMax(state, team) - returning(state, team) + 1); }
export const commitsOf = (state, team) => cls(state).filter(r => (r.signed || r.commit) === team);

// ── the class's recruitment state ──
function setup(state, r, rng) {
  profile(state, r);
  r.int = r.int || {}; r.list = r.list || []; r.stage = r.stage || 'open'; r.feed = r.feed || [];
  if (r.db === undefined) {
    // ~35% have a dealbreaker on one of the things they value most (a minimum grade a school must reach)
    const top = Object.keys(r.w).filter(k => DB_KEYS.some(x => x[0] === k)).sort((a, b) => r.w[b] - r.w[a]).slice(0, 2);
    r.db = rng.chance(0.35) && top.length ? { k: top[rng.int(top.length)], min: [0.46, 0.53, 0.6][rng.int(3)] } : null;
  }
}
function feed(state, r, text) { r.feed.push({ w: state.rweek || 0, d: (state.rweek || 0) <= SUMMER ? '' : state.progT || '', text }); if (r.feed.length > 14) r.feed.shift(); }
const userIn = (state, r) => r.list.includes(state.user);
function note(state, r, text) {   // the user's news feed: recruits he offered
  if (userIn(state, r) || r.cutUser) push(state, state.progT || '', 'recruit', text, state.user, null);
}
/** does `team` clear recruit r's dealbreaker? */
export function passesDB(state, team, r, f) {
  if (!r.db) return true;
  f = f || factors(state, team, r, team === state.user ? r.offer || 0 : aiOffer(state, team, r), team === state.user ? relationship(state, r, 0) : aiRel(state, team));
  return f[r.db.k] >= r.db.min;
}

// ── offers ──
// each AI program offers about 3 per open spot, around where its prestige ranks it (rank ~ 4 x its prestige rank,
// like the old signing order), weighted to the position groups it's short at; a few reach offers above its level
function aiOffers(state, rng, includeUser) {
  const R = cls(state); if (!R.length) return;
  const teams = Object.values(state.teams).filter(t => includeUser || t.name !== state.user);
  const order = Object.values(state.teams).sort((a, b) => (b.prestige || 0) - (a.prestige || 0)).map(t => t.name);
  const byRank = R.slice().sort((a, b) => a.rank - b.rank);
  for (const T of teams) {
    const need = classNeed(state, T.name), have = commitsOf(state, T.name).length;
    const want = Math.round((need - have) * (4 + (T.prestige >= 75 ? 1 : 0)));
    const out = R.filter(r => r.list.includes(T.name) && !r.signed).length;
    let n = want - out; if (n <= 0) continue;
    const pr = order.indexOf(T.name), c0 = pr * 4, hi = c0 + 70;
    const g = { G: 0, W: 0, B: 0 }; for (const id of T.players) { const p = state.players[id]; if (p && (p.yr || 1) <= 3) g[G(p.pos)]++; }
    const short = k => clamp(({ G: 6, W: 5, B: 5 }[k] - g[k]) / 3, 0.3, 1.6);
    // his level and below it; ABOVE his level the chance of a reach fades (a top-60 kid hears from most of the
    // top 40 programs, a 3-star rarely from a blue blood — though he'd go if asked)
    const pool = byRank.filter(r => !r.signed && !r.list.includes(T.name) && r.stage === 'open' && r.rank <= hi);
    const ws = pool.map(r => short(G(r.pos)) * (r.rank < c0 - 20 ? Math.exp(-(c0 - 20 - r.rank) / 45) : 1));
    while (n > 0 && pool.length) {
      const i = rng.pick(ws); const r = pool[i]; pool.splice(i, 1); ws.splice(i, 1);
      r.list.push(T.name); r.int[T.name] = r.int[T.name] || 0; n--;
      if (T.name === state.user) { r.uoff = true; feed(state, r, 'Your staff offered him over the summer'); }
    }
  }
}

// ── PIPELINES (EA-style): states a program keeps landing players from. A pipeline multiplies the weekly interest a
// school earns with recruits from that state (up to +30% at 100), grows with every signing there and fades a little
// every year. Seeded at league start: the home state strong, neighbours moderate, one or two recruiting hotbeds as
// the program's history (more for big programs).
export const pipeTier = v => (v >= 70 ? 'Elite' : v >= 45 ? 'Strong' : v >= 20 ? 'Growing' : null);
export function initPipelines(state) {
  const rng = rngFor(state, 'pipes'), ks = Object.keys(HOME_W), ws = ks.map(k => HOME_W[k] ** 2);   // history: mostly the real hotbeds
  state.pipes = {};
  for (const T of Object.values(state.teams)) {
    const P = state.pipes[T.name] = {}, pr = T.prestige || 30;
    if (T.state && XY[T.state]) {
      P[T.state] = Math.round(45 + pr * 0.3);
      for (const k of Object.keys(XY).filter(k => k !== T.state).sort((a, c) => miles(a, T.state) - miles(c, T.state)).slice(0, 3)) if (miles(k, T.state) < 450) P[k] = Math.round(16 + pr * 0.14);
    }
    for (let i = 0, n = pr >= 75 ? 3 : pr >= 55 ? 2 : 1; i < n; i++) { const k = ks[rng.pick(ws)]; P[k] = Math.max(P[k] || 0, Math.round(20 + rng.next() * 25 + pr * 0.15)); }
  }
}
export const pipeOf = (state, team, r) => (r && r.home && state.pipes && state.pipes[team] ? state.pipes[team][r.home] || 0 : 0);
const pipeK = (state, team, r) => 1 + 0.3 * pipeOf(state, team, r) / 100;
/** after signing day: each signee builds his school's pipeline in his state; every pipeline fades 8% a year */
export function updatePipelines(state, signees) {
  if (!state.pipes) initPipelines(state);
  for (const P of Object.values(state.pipes)) for (const k in P) { P[k] = Math.round(P[k] * 0.92); if (P[k] < 5) delete P[k]; }
  for (const p of signees) if (p.team && p.home && p.home !== 'INTL') { const P = state.pipes[p.team] = state.pipes[p.team] || {}; P[p.home] = Math.min(100, (P[p.home] || 0) + 12 + (p.stars >= 4 ? 6 : 0)); }
}
/** a program's pipelines, strongest first: [[state, value, tier]] */
export const pipelinesOf = (state, team) => Object.entries((state.pipes || {})[team] || {}).filter(([, v]) => pipeTier(v)).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pipeTier(v)]);

// ── the weekly interest race ──
const match = u => clamp((u / 3.6) ** 2, 0.35, 2.2);
function aiHours(state, team) {   // an AI program's weekly hours per recruit
  const T = state.teams[team], rec = T.prog && T.prog.staff.REC ? T.prog.staff.REC.r : 45;
  const k = 1 - (DIFFS[state.diff || 'pro'].recruit || 0) * 0.25;   // harder difficulty, harder-working rivals
  return (18 + (T.prestige || 30) * 0.18 + (rec - 45) * 0.25) * k;
}
/** the user's weekly hours budget: the recruiting hours on the Program tab (and the coordinator), ~500 for an average program */
export function hoursBudget(state) { const t = state.teams[state.user]; return t && t.prog ? Math.round(440 * effort(state, t, 'recruiting')) : 440; }
/** hours planned for one recruit this week, and in total */
export const planHours = p => Object.keys(p || {}).filter(k => p[k] && ACT[k]).reduce((s, k) => s + ACT[k][2], 0);
export const hoursUsed = state => Object.entries(state.rplan || {}).reduce((s, [id, p]) => { const r = byId(state, id); if (!r || r.signed) return s;
  return s + (userIn(state, r) ? Math.min(HOURS_CAP, planHours(p)) : (p.scout ? 10 : 0)); }, 0);
// SCOUTING (EA-style): every recruit hides how he'll really develop (offseason.js r.arc: a bust stalls, a gem takes
// off). Scouting hours (r.vs, also earned by visits) tighten the ratings your staff sees and, past SCOUT_REVEAL, tell
// you which he is. Anyone can be scouted — before you offer.
export const SCOUT_REVEAL = 45;
export const scoutedPct = r => Math.min(100, Math.round(100 * (r.vs || 0) / SCOUT_REVEAL));
export const revealed = r => (r.vs || 0) >= SCOUT_REVEAL ? (r.arc === 'gem' ? 'gem' : r.arc === 'bust' ? 'bust' : 'solid') : null;
/** next year's open scholarships by position group for a team (G guards, W wings, B bigs) */
export function needs(state, team) {
  const want = { G: 6, W: 5, B: 5 }, have = { G: 0, W: 0, B: 0 };
  for (const id of state.teams[team].players) { const p = state.players[id]; if (p && (p.yr || 1) <= 3) have[G(p.pos)]++; }
  for (const r of commitsOf(state, team)) have[G(r.pos)]++;
  return Object.fromEntries(Object.keys(want).map(k => [k, Math.max(0, want[k] - have[k])]));
}
export const groupOf = G;
/** recruiting class rankings: sum of stars squared over commits + signees */
export function classRanks(state) {
  const sc = {}, n = {};
  for (const r of cls(state)) { const t = r.signed || r.commit; if (!t) continue; sc[t] = (sc[t] || 0) + r.stars * r.stars; n[t] = (n[t] || 0) + 1; }
  return Object.keys(sc).sort((a, b) => sc[b] - sc[a]).map((t, i) => ({ rank: i + 1, team: t, pts: sc[t], n: n[t],
    five: cls(state).filter(r => (r.signed || r.commit) === t && r.stars === 5).length, four: cls(state).filter(r => (r.signed || r.commit) === t && r.stars === 4).length }));
}

function weekGain(state, r, team, hours, rng) {
  const user = team === state.user;
  const f = factors(state, team, r, user ? r.offer || 0 : aiOffer(state, team, r), user ? relationship(state, r, 0) : aiRel(state, team));
  return { g: hours * match(utility(r, f)) * pipeK(state, team, r) * (0.85 + 0.3 * rng.next()), f };
}

/** one recruiting week for the whole class (summer weeks pass date = null) */
export function recruitWeek(state, d) {
  const R = cls(state); if (!R.length) return;
  const w = state.rweek = (state.rweek || 0) + 1, rng = rngFor(state, 'w' + w), U = state.user;
  if (w <= 3 || w % 4 === 0) aiOffers(state, rng, w <= SUMMER);   // new offers early, then a top-up every month (decommits, filled classes)
  const plan = state.rplan || {};
  if (w > SUMMER) for (const r of R) if (r.list.includes(U)) { r.prevU = r.int[U] || 0; r.prevRk = rankOf(r, U); r.prevAll = Object.assign({}, r.int); }
  if (w > SUMMER) for (const [id, p] of Object.entries(plan)) if (p.scout) { const r = byId(state, id); if (r && !r.signed) { const was = revealed(r); r.vs = (r.vs || 0) + 12; const now = revealed(r);
    if (!was && now) feed(state, r, now === 'gem' ? 'Your staff thinks he is a hidden gem' : now === 'bust' ? 'Your staff has real doubts — bust risk' : 'Your staff is sure: he is what his ranking says'); } }
  // the staff spends the hours the user leaves on the table (all of them on Rookie, half on Pro, none on HOF),
  // spread over his offers that have no plan this week
  const autoK = { rookie: 1, pro: 0.5, aa: 0.25, hof: 0 }[state.diff || 'pro'] ?? 0.5;
  // ...the way a real staff would: full 50-hour weeks on the races you can win (best rank on his list first, a commit
  // to you kept warm at half), not a thin spread over every offer (a 25-hour week loses to every AI school's 35-40)
  const mineOpen = w > SUMMER ? R.filter(r => !r.signed && r.list.includes(U) && !planHours(plan[r.id])) : [];
  const autoMap = {};
  { let left = autoK * Math.max(0, hoursBudget(state) - hoursUsed(state));
    for (const r of mineOpen.slice().sort((a, b) => (a.commit === U) - (b.commit === U) || rankOf(a, U) - rankOf(b, U) || b.stars - a.stars)) {
      if (left <= 0) break; const h = Math.min(r.commit === U ? HOURS_CAP / 2 : HOURS_CAP, left); autoMap[r.id] = h; left -= h; } }
  // every program, the AI included, works on a weekly budget: about AI_SPREAD recruits' worth of full hours, spread
  // over its live offers (it used to put full hours on every offer, out-working the user's 500-hour week everywhere)
  const nOff = {};
  for (const r of R) if (!r.signed) for (const t of r.list) nOff[t] = (nOff[t] || 0) + (r.commit && r.commit !== t ? 0.4 : 1);
  for (const r of R) {
    if (r.signed || !r.list.length) continue;
    setup(state, r, rng);
    for (const t of r.list) {
      let h;
      if (t === U && w > SUMMER) {   // the user's own work (the summer was his staff's)
        const p = plan[r.id] || {}; h = (Math.min(HOURS_CAP, planHours(p)) - (p.scout ? 10 : 0)) || (planHours(p) ? 0 : autoMap[r.id] || 0);
        if (p.home) { if (r.hv) h -= 50; else { r.hv = true; h += 50; feed(state, r, 'You visited his home'); } p.home = false; }
        if ((p.soft || p.hard) && !['t5', 't3', 'commit'].includes(r.stage)) { h -= (p.soft ? 20 : 0) + (p.hard ? 40 : 0); p.soft = p.hard = false; }
      } else {
        // AI (and the user's staff over the summer): its staff's time, less on a kid committed to someone else
        h = aiHours(state, t) * Math.min(1, AI_SPREAD / Math.max(1, nOff[t] || 1));
        if (r.commit && r.commit !== t) h *= (state.teams[t].prestige || 0) >= (state.teams[r.commit].prestige || 0) + 8 ? 0.9 : 0.4;   // bigger programs keep recruiting another school's commit
        if (r.commit === t) h *= 0.45;   // keeping a commit warm (a school that coasts can lose him)
      }
      if (h <= 0) continue;
      const { g, f } = weekGain(state, r, t, h, rng);
      let gain = g;
      if (t === U && w > SUMMER) {
        const p = plan[r.id] || {}, top = Object.keys(r.w).sort((a, b) => r.w[b] - r.w[a])[0], tg = f[top] ?? 0.5;
        if (p.soft) gain += 20 * match(4) * (0.6 + tg);
        if (p.hard) { const ok = tg >= 0.53; gain += ok ? 40 * match(4) * (0.9 + tg) : -60; feed(state, r, ok ? `Your hard sell on ${dbLabel(top).toLowerCase()} landed` : `Your hard sell on ${dbLabel(top).toLowerCase()} fell flat`); }
      }
      r.int[t] = Math.max(0, Math.round((r.int[t] || 0) + gain));
    }
    stageStep(state, r, w, rng);
  }
  // a class that's full withdraws its other offers
  for (const T of Object.keys(state.teams)) if (T !== U && commitsOf(state, T).length >= classNeed(state, T))
    for (const r of R) if (!r.signed && r.commit !== T && r.list.includes(T)) { r.list = r.list.filter(x => x !== T); delete r.int[T]; }
  // the early signing period: commits sign for good (most of them)
  if (d && !state.earlySigned && d >= `${state.year - 1}-11-18`) {
    state.earlySigned = true;
    for (const r of R) if (r.commit && !r.signed && rng.chance(0.8)) sign(state, r, r.commit, 'in the early signing period');
  }
}
function cutTo(state, r, n, stage) {
  const keep = r.list.filter(t => passesDB(state, t, r)).sort((a, b) => (r.int[b] || 0) - (r.int[a] || 0));
  if (r.commit && !keep.slice(0, n).includes(r.commit)) keep.unshift(r.commit);   // his commit school stays
  const kept = keep.slice(0, n), out = r.list.filter(t => !kept.includes(t));
  r.list = kept; r.stage = r.commit ? r.stage : stage;
  for (const t of out) delete r.int[t];
  if (out.includes(state.user)) { r.cutUser = true; feed(state, r, `Cut his list to a ${STAGE_LABEL[stage]} — you didn't make it`); note(state, r, `${r.stars}★ ${r.name} cut you from his ${STAGE_LABEL[stage]}`); }
  else if (kept.includes(state.user)) feed(state, r, `Cut his list to a ${STAGE_LABEL[stage]} — you're ${ordinal(rankOf(r, state.user))}`);
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
export const rankOf = (r, team) => r.list.slice().sort((a, b) => (r.int[b] || 0) - (r.int[a] || 0)).indexOf(team) + 1;

function stageStep(state, r, w, rng) {
  // scheduled cuts (an open list with few offers just stays open)
  const c = CUTS[w];
  if (c && !r.signed && r.list.length > c[1]) cutTo(state, r, c[1], c[0]);
  else if (c && !r.commit) r.stage = c[0];
  const ord = r.list.slice().sort((a, b) => (r.int[b] || 0) - (r.int[a] || 0));
  if (!ord.length) return;
  const i1 = r.int[ord[0]] || 0, i2 = ord[1] ? r.int[ord[1]] || 1 : 1, ratio = i1 / Math.max(1, i2);
  if (!r.commit) {
    // how clear a lead he needs: less as his list shrinks and the season goes on; low-ranked kids with one or two
    // offers commit early. He needs real interest too.
    // ...and the clock: by spring a kid wants to be settled (the bar drops through the second half of the season)
    const need = Math.max(1.0, (r.stage === 't3' ? 1.12 : r.stage === 't5' ? 1.2 : r.stage === 't8' ? 1.3 : 1.4) - Math.max(0, w - 16) * 0.012 - (r.list.length <= 2 ? 0.2 : 0));
    const p = 0.3 + Math.max(0, w - 18) * 0.03 + (r.stars >= 4 && w <= SUMMER + 3 ? 0.1 : 0);
    if (w >= 3 && i1 >= 160 && ratio >= need && passesDB(state, ord[0], r) && rng.chance(p)) commit(state, r, ord[0]);
  } else if (!r.signed) {
    // a soft commit can flip: another school passing his commit school by a wide margin
    const ic = r.int[r.commit] || 1, rival = ord.find(t => t !== r.commit);
    // ...or he REOPENS his recruitment: a kid whose second school is close (within 30%) wavers now and then
    // (more often the higher he's ranked), and recommits through the normal race — sometimes somewhere else
    if (rival && (r.int[rival] || 0) > ic * 0.7 && rng.chance(r.stars >= 4 ? 0.025 : 0.012)) {
      const from = r.commit; r.commit = null; r.stage = r.list.length <= 3 ? 't3' : r.list.length <= 5 ? 't5' : 't8';
      feed(state, r, `Reopened his recruitment (was committed to ${from === state.user ? 'you' : '[[' + from + ']]'})`);
      if (from === state.user || r.list.includes(state.user)) push(state, state.progT || '', 'recruit', `${r.stars}★ ${r.name} reopened his recruitment${from === state.user ? ' — he was committed to you' : ''}`, state.user, null);
      return;
    }
    if (rival && (r.int[rival] || 0) > ic * 1.12 && passesDB(state, rival, r) && rng.chance(0.3)) {
      const from = r.commit; feed(state, r, `Decommitted from ${from === state.user ? 'you' : '[[' + from + ']]'}`);
      if (from === state.user) push(state, state.progT || '', 'recruit', `${r.stars}★ ${r.name} decommitted from you`, state.user, null);
      commit(state, r, rival, from);
    }
  }
}
function commit(state, r, team, from) {
  // the user's admissions office has the final word on an athlete who wants to come
  if (team === state.user && !rngFor(state, 'adm:' + r.id).chance(admitP(state, team, r, false))) {
    r.list = r.list.filter(t => t !== team); delete r.int[team]; r.cutUser = true;
    feed(state, r, 'Wanted to commit to you — admissions said no'); note(state, r, `${r.stars}★ ${r.name} wanted to commit — denied admission`); return;
  }
  r.commit = team; r.stage = 'commit';
  feed(state, r, `${from ? 'Flipped to' : 'Committed to'} ${team === state.user ? 'you' : '[[' + team + ']]'}`);
  if (team === state.user || r.list.includes(state.user) || from === state.user)
    push(state, state.progT || '', 'recruit', `${r.stars}★ ${r.name} ${from ? 'flipped' : 'committed'} to ${team === state.user ? 'you' : '[[' + team + ']]'}`, state.user, null);
}
function sign(state, r, team, when) {
  r.signed = team; r.stage = 'signed'; r.list = [team];
  feed(state, r, `Signed with ${team === state.user ? 'you' : '[[' + team + ']]'} ${when}`);
}

// ── the user's moves ──
export function offerRecruit(state, rid) {
  const r = byId(state, rid); if (!r) return 'He is no longer available.';
  setup(state, r, rngFor(state, 'setup:' + rid));
  if (r.list.includes(state.user)) return null;
  if (r.signed) return `${r.name} already signed with ${r.signed}.`;
  if (r.cutUser) return `${r.name} already cut you.`;
  if (r.stage !== 'open' && !(r.commit && r.stage === 'commit')) return `${r.name} has narrowed his list to a ${STAGE_LABEL[r.stage]} — it's too late to offer.`;
  if (cls(state).filter(x => x.list.includes(state.user) && !x.signed).length >= USER_OFFERS_MAX) return `You can have at most ${USER_OFFERS_MAX} offers out.`;
  r.list.push(state.user); r.int[state.user] = r.int[state.user] || 0; feed(state, r, 'You offered');
  return null;
}
export function withdrawOffer(state, rid) {
  const r = byId(state, rid); if (!r || r.signed === state.user) return;
  r.list = r.list.filter(t => t !== state.user); delete r.int[state.user];
  if (r.commit === state.user) { r.commit = null; r.stage = 'open'; }
  if (state.rplan) delete state.rplan[rid];
  feed(state, r, 'You pulled your offer');
}
/** toggle an action in this week's plan for a recruit; returns an error string or null */
export function toggleAction(state, rid, k) {
  const r = byId(state, rid); if (!r || !ACT[k]) return null;
  if (!userIn(state, r) && k !== 'scout') return 'Offer him first.';
  const P = state.rplan = state.rplan || {}, p = P[rid] = P[rid] || {};
  if (p[k]) { p[k] = false; return null; }
  if (k === 'scout' && revealed(r)) return 'Your staff already knows what he is.';
  if ((k === 'soft' || k === 'hard') && !['t5', 't3', 'commit'].includes(r.stage)) return 'Pitches unlock when he cuts to a Top 5.';
  if (k === 'home' && r.hv) return 'You already visited his home this season.';
  if (planHours(p) + ACT[k][2] > HOURS_CAP) return `At most ${HOURS_CAP} hours a week on one recruit.`;
  if (hoursUsed(state) + ACT[k][2] > hoursBudget(state)) return `That's past this week's ${hoursBudget(state)} recruiting hours.`;
  p[k] = true; return null;
}
/** a visit's boost (visits.js) turns into interest */
export function visitInterest(state, r, gain) { if (r && r.list && r.list.includes(state.user)) r.int[state.user] = Math.max(0, Math.round((r.int[state.user] || 0) + gain * 500)); }

/** where the user stands: the chance he ends up signing with you if signing day were today */
export function userChance(state, r) {
  if (r.signed) return r.signed === state.user ? 1 : 0;
  if (!r.list || !r.list.includes(state.user)) return 0;
  if (r.commit) return r.commit === state.user ? 0.85 : 0.08 * (r.int[state.user] || 0) / Math.max(1, r.int[r.commit] || 1);
  const tot = r.list.reduce((s, t) => s + (r.int[t] || 0) ** 3, 0);
  return tot > 0 ? (r.int[state.user] || 0) ** 3 / tot : 1 / r.list.length;
}
/** how the recruit grades a school on each thing he values (letter grades) */
export function gradesFor(state, r, team) {
  const f = factors(state, team, r, team === state.user ? r.offer || 0 : aiOffer(state, team, r), team === state.user ? relationship(state, r, 0) : aiRel(state, team));
  return Object.fromEntries(Object.keys(f).map(k => [k, { x: f[k], g: grade(f[k]) }]));
}

/** a new class: set everyone up and play the summer (AI offers + interest; the clearest leads commit) */
export function initRecruiting(state) {
  const R = cls(state); if (!R.length) return;
  const rng = rngFor(state, 'init');
  if (!state.pipes) initPipelines(state);
  for (const r of R) setup(state, r, rng);
  state.rweek = 0; state.rplan = {}; state.earlySigned = false;
  for (let i = 0; i < SUMMER; i++) recruitWeek(state, null);
}
export const isNewClass = R => !!(R && R.length && R[0].list);
/** an older save mid-season: set the class up, play its summer and the weeks already gone (the AI's side only) */
export function catchUpClass(state) {
  initRecruiting(state);
  const t = state.progT || state.cal;
  const weeks = t ? Math.max(0, Math.floor((Date.parse(t + 'T12:00:00Z') - Date.parse(`${state.year - 1}-11-01T12:00:00Z`)) / 6048e5)) : 0;
  for (let i = 0; i < weeks; i++) recruitWeek(state, null);
}

// ── signing day (the offseason): commits sign; the rest pick from the schools still on their list ──
export function signClass(state, recruits, openSpots, take) {
  const rng = rngFor(state, 'sign'), left = [];
  for (const r of recruits.slice().sort((a, b) => a.rank - b.rank)) {
    let choice = r.signed || r.commit;
    if (choice && openSpots(state, choice) <= 0 && !r.signed) choice = null;   // his school ran out of room
    if (!choice && r.list && r.list.length) {
      const cands = r.list.filter(t => openSpots(state, t) > 0 && passesDB(state, t, r));
      if (cands.length) {
        const ws = cands.map(t => Math.max(1, r.int[t] || 0) ** 3);
        choice = cands[rng.pick(ws)];
        if (choice === state.user && !rng.chance(admitP(state, choice, r, false))) choice = cands.find(t => t !== state.user) || null;
      }
    }
    if (choice && (r.signed === choice || openSpots(state, choice) > 0)) take(r, choice);
    else left.push(r);
  }
  return left;
}

// ── HEAD TO HEAD (Oct 2026): when you and one school are within ~15% for a recruit, the panel shows the race, where
// each of you wins on what he values, how long a lead lasts at this week's pace, and the moves that would swing it ──
export function battleOf(state, r) {
  const U = state.user;
  if (!r || r.signed || !r.list || !r.list.includes(U) || r.list.length < 2) return null;
  const ord = r.list.slice().sort((a, b) => (r.int[b] || 0) - (r.int[a] || 0)), you = r.int[U] || 0;
  const rival = ord[0] === U ? ord[1] : ord[0], them = r.int[rival] || 0;
  if (ord.indexOf(U) > 1 || Math.abs(you - them) > 0.15 * Math.max(you, them, 1)) return null;
  const P = r.prevAll || {}, dYou = r.prevAll ? you - (P[U] || 0) : null, dThem = r.prevAll ? them - (P[rival] || 0) : null;
  const fu = factors(state, U, r, r.offer || 0, relationship(state, r, 0)), fr = factors(state, rival, r, aiOffer(state, rival, r), aiRel(state, rival));
  const U_SC = 7;
  const edges = Object.keys(r.w).map(k => ({ k, w: r.w[k], you: fu[k], them: fr[k], d: U_SC * r.w[k] * (fu[k] - fr[k]) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const pace = dYou != null && dThem != null ? dYou - dThem : null;
  const weeks = pace == null || pace === 0 ? null : you >= them ? (pace < 0 ? Math.ceil((you - them) / -pace) : Infinity) : (pace > 0 ? Math.ceil((them - you) / pace) : Infinity);
  // the moves: what each lever is worth in his eyes (utility points, the same scale as the edges)
  const moves = [];
  if ((r.offer || 0) < r.ask && r.w.nil >= 0.1) { const at = Math.min(1.4, 1) / 1.4; moves.push({ k: 'nil', txt: `Meet his NIL ask ($${r.ask}k)`, v: U_SC * r.w.nil * (at - fu.nil) }); }
  const top = Object.keys(r.w).sort((a, b) => r.w[b] - r.w[a])[0];
  if (['t5', 't3', 'commit'].includes(r.stage) && fu[top] >= 0.53) moves.push({ k: 'hard', txt: `Hard sell on ${dbLabel(top).toLowerCase()} (you grade ${grade(fu[top])})`, v: null });
  const best = ['pt', 'team', 'nil', 'acad', 'draft', 'prox', 'brand'].sort((a, b) => (r.w[b] || 0) * (fu[b] - 0.5) - (r.w[a] || 0) * (fu[a] - 0.5))[0];
  moves.push({ k: 'visit', txt: `Official visit with a ${({ pt: 'Meet the team', team: 'Game-day atmosphere', nil: 'Booster dinner', acad: 'Campus tour', draft: 'Pro development', prox: 'Family weekend', brand: 'Brand day' })[best]} focus`, v: 0.35 * Math.min(2.2, (r.w[best] || 0) / 0.125) * (fu[best] - 0.5) * 2 });
  moves.push({ k: 'hours', txt: 'Max your weekly hours on him (50 h)', v: null });
  return { rival, you, them, lead: you >= them, dYou, dThem, weeks, edges, moves: moves.filter(m => m.v == null || m.v > 0.02).sort((a, b) => (b.v ?? 0) - (a.v ?? 0)) };
}
