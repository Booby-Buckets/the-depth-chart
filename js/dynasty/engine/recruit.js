// How a recruit (or a transfer) picks a school, and NIL negotiations (Oct 2026, owner design). Every recruit weighs
// seven things — with his own priorities — and every program, the user's included, is scored the same way:
//   prox   proximity: his home state to the campus (an international kid is indifferent)
//   pt     playing time: how many returning teammates at his position are better than him
//   rel    relationship: the staff's work on him (effort points, visits, the recruiting coordinator)
//   draft  draft pipeline: players the program has sent to the pros lately, and its prestige
//   team   team caliber: how good the program is right now
//   brand  brand: prestige, the conference, NIL clout
//   nil    NIL: what the program offers against his asking price
// The user's odds come from how the user's school stacks up against the best rival bidding for him. Pure.
import { makeRng, hashSeed } from './rng.js?v=50';
import { effOvr } from './league.js?v=50';
import { power } from './season.js?v=50';
import { facOverall } from './facilities.js?v=50';
import { personalize } from './people.js?v=50';

export const FACTORS = [['prox', 'Close to home'], ['pt', 'Playing time'], ['rel', 'Relationships'], ['draft', 'Draft path'], ['team', 'Winning now'], ['brand', 'Brand'], ['nil', 'NIL money'], ['acad', 'Academics']];
const BASE_W = { prox: 0.18, pt: 0.19, rel: 0.14, draft: 0.09, team: 0.12, brand: 0.09, nil: 0.19, acad: 0.03 };
const U_SCALE = 7;                              // utility points per unit of weighted factor (sets how decisive a gap is)

// state centroids (lat, lon) — distance is all proximity needs
const XY = { AL: [32.8, -86.8], AK: [61.4, -152.3], AZ: [34.2, -111.7], AR: [34.9, -92.4], CA: [36.8, -119.4], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0],
  FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3],
  LA: [31.1, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6],
  NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.6] };
// where D-I players come from (real talent production, roughly) + international
const HOME_W = { TX: 9, CA: 9, FL: 7, GA: 6, NY: 5, NC: 5, IL: 4, MD: 4, NJ: 4, PA: 4, OH: 4, VA: 4, IN: 3, MI: 3, TN: 3, LA: 3, AL: 2.5, MO: 2.5, MN: 2, WA: 2, AZ: 2, KY: 2, SC: 2,
  MS: 2, WI: 1.5, MA: 1.5, CT: 1.5, OK: 1.5, KS: 1.2, CO: 1.2, NV: 1, AR: 1, IA: 1, OR: 1, UT: 1, DC: 1.5, NE: 0.6, WV: 0.5, NM: 0.5, DE: 0.5, ID: 0.4, RI: 0.4, NH: 0.3, ME: 0.3,
  HI: 0.3, MT: 0.3, SD: 0.3, ND: 0.3, VT: 0.2, WY: 0.2, AK: 0.2, INTL: 11 };   // ~10% of a class from abroad
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function miles(a, b) {
  const A = XY[a], B = XY[b]; if (!A || !B) return 900;
  const r = Math.PI / 180, dl = (B[0] - A[0]) * r, dn = (B[1] - A[1]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(A[0] * r) * Math.cos(B[0] * r) * Math.sin(dn / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(h));
}
const grp = pos => /C|PF/.test(pos || '') ? 'B' : /SF|F/.test(pos || '') ? 'W' : 'G';

// ── a recruit's profile: home, priorities, asking price (made once, saved on the recruit) ──
export function profile(state, r) {
  if (r.home && r.w && r.ask != null) { if (r.acad == null || (r.home === 'INTL' && !r.country)) personalize(state, r, makeRng(hashSeed(`${state.seed}:pers:${r.id}`)), !r.team); return r; }
  const rng = makeRng(hashSeed(`${state.seed}:prof:${r.id}`));
  if (!r.home) { const ks = Object.keys(HOME_W), ws = ks.map(k => HOME_W[k]); r.home = ks[rng.pick(ws)]; }
  personalize(state, r, rng, !r.team);   // durability, academics, country (people.js)
  if (!r.w) {
    const w = {}; let s = 0;
    for (const [k] of FACTORS) { w[k] = BASE_W[k] * Math.exp(rng.normal(0, 0.55)); s += w[k]; }
    if ((r.acad ?? 50) >= 75) { s -= w.acad; w.acad *= 5; s += w.acad; }             // strong students care about the school
    if (r.home === 'INTL') { s -= w.nil; w.nil *= 0.3; s += w.nil; }                   // visa rules limit what he can earn
    for (const k in w) w[k] = Math.round(w[k] / s * 1000) / 1000;
    r.w = w;
  }
  if (r.ask == null) {
    // $k a year: 5-star 400-900k, 4-star 150-400k, 3-star 40-150k, 2-star 10-50k, 1-star 0-15k (NIL-first kids ask more)
    const band = [null, [0, 15], [10, 50], [40, 150], [150, 400], [400, 900]][Math.max(1, Math.min(5, r.stars || 2))];
    let a = (band[0] + (band[1] - band[0]) * rng.next() ** 1.3) * 0.7;   // high-schoolers are cheaper than proven transfers
    if (r.w.nil >= 0.22) a *= 1.3;
    if (r.home === 'INTL') a *= 0.35;
    r.ask = Math.round(a / 5) * 5;
  }
  return r;
}
export const priorities = r => FACTORS.slice().sort((a, b) => r.w[b[0]] - r.w[a[0]]).slice(0, 2).map(x => x[1]);

// per-call caches (rosters by position group, fund percentiles, power percentile, pro pipeline)
function ctx(state) {
  if (state._rc && state._rc.ver === state._ver && state._rc.n === Object.keys(state.teams).length) return state._rc;
  const funds = Object.values(state.teams).map(t => (t.prog ? t.prog.nil.fund : 0)).sort((a, b) => a - b);
  const pw = state.phase === 'offseason' || !state.schedule.some(g => g.r) ? null : power(state);
  const pwS = pw ? Object.values(pw).sort((a, b) => a - b) : null;
  const lv = Object.values(state.teams).map(t => (t.level || 0) + (t.lvAdj || 0)).sort((a, b) => a - b);   // + conference exposure (realign.js)
  const pct = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo / Math.max(1, arr.length - 1); };
  const roster = {};
  for (const t of Object.values(state.teams)) {
    const g = { G: [], W: [], B: [] };
    for (const id of t.players) { const p = state.players[id]; if (p && !(p.yr >= 4 && state.phase !== 'offseason')) g[grp(p.pos)].push(effOvr(p, state)); }
    for (const k in g) g[k].sort((a, b) => b - a);
    roster[t.name] = g;
  }
  const fac = Object.values(state.teams).map(t => facOverall(t.fac)).sort((a, b) => a - b);
  return (state._rc = { ver: state._ver, n: Object.keys(state.teams).length, funds, pct, pw, pwS, lv, roster, fac });
}

/** factor scores 0-1 for program `team` and recruit `r` (offer = $k NIL a year; rel = relationship 0-100) */
export function factors(state, team, r, offer, rel) {
  const C = ctx(state), T = state.teams[team]; profile(state, r);
  const prox = r.home === 'INTL' ? 0.15 + 0.85 * (T.intl ?? 0.3) : r.home === T.state ? 1 : 0.85 * (1 - Math.min(1200, miles(r.home, T.state)) / 1200);   // home state = 1; abroad: the international airport + city
  const mine = (r.scout || r.ovr || 60) + (state.lvlRef || 0) * 0;
  const better = (C.roster[team] && C.roster[team][grp(r.pos)] || []).filter(o => o >= mine).length;
  const slots = { G: 2, W: 1.5, B: 1.5 }[grp(r.pos)];
  const pt = clamp(1 - better / (slots + 1.2), 0, 1);
  const pros = (state.pros && state.pros[team] || []).filter(y => y >= state.year - 4).length;
  const draft = clamp(0.55 * (T.prestige || 30) / 100 + 0.45 * Math.min(1, pros / 5), 0, 1);
  const teamQ = C.pw ? C.pct(C.pwS, C.pw[team] ?? 0) : (T.prestige || 30) / 100;
  const fund = T.prog ? T.prog.nil.fund : 0;
  const brand = clamp(0.45 * (T.prestige || 30) / 100 + 0.2 * C.pct(C.lv, (T.level || 0) + (T.lvAdj || 0)) + 0.15 * C.pct(C.funds, fund) + 0.2 * C.pct(C.fac, facOverall(T.fac)), 0, 1);   // + facilities
  const nil = clamp((offer || 0) / Math.max(5, r.ask), 0, 1.4) / 1.4;
  return { prox, pt, rel: clamp((rel ?? 30) / 100, 0, 1), draft, team: teamQ, brand, nil, acad: clamp((T.acad ?? 45) / 100, 0, 1) };
}
export const utility = (r, f) => U_SCALE * FACTORS.reduce((s, [k]) => s + (r.w[k] || 0) * (f[k] || 0), 0);

// an AI program's implied offer (its collective's clout x the market) and its relationship (its staff's reach)
// (each signing spends from the collective: a program that has already promised most of its fund can't keep outbidding)
function aiOffer(state, team, r) {
  const C = ctx(state), T = state.teams[team], fund = T.prog ? T.prog.nil.fund : 0;
  const left = clamp(1 - ((state._aiSpend && state._aiSpend[team]) || 0) / Math.max(40, fund * 0.6), 0.1, 1);
  return r.ask * (0.45 + 0.9 * C.pct(C.funds, fund)) * left;
}
export function aiSign(state, team, r) { (state._aiSpend = state._aiSpend || {})[team] = (state._aiSpend[team] || 0) + aiOffer(state, team, r); }
function aiRel(state, team) { const T = state.teams[team], rec = T.prog && T.prog.staff.REC ? T.prog.staff.REC.r : 45; return 22 + (T.prestige || 30) * 0.3 + (rec - 45) * 0.3; }

/** the best rival for recruit r among programs at his level: { team, u } */
export function bestRival(state, r, exclude) {
  const need = r.appeal ?? 0;
  let best = null, bu = -1e9;
  for (const T of Object.values(state.teams)) {
    if (T.name === exclude || (T.prestige || 0) < need - 22) continue;
    const u = utility(r, factors(state, T.name, r, aiOffer(state, T.name, r), aiRel(state, T.name)));
    if (u > bu) { bu = u; best = T.name; }
  }
  return { team: best, u: bu };
}

/** the user's relationship with a recruit: base + effort points + visits + recruiting coordinator */
export function relationship(state, r, effort = 0) {
  const T = state.teams[state.user], rec = T && T.prog && T.prog.staff.REC ? T.prog.staff.REC.r : 45;
  // high-schoolers: the staff has known them for years (base 25); transfers arrive as near-strangers (base 5)
  return clamp((r.transfer ? 5 : 25) + (effort || 0) * 1.1 + (r.vs || 0) * 0.6 + (rec - 45) * 0.35 + (r.relAdj || 0), 0, 100);
}

/** everything the board shows for the user's pursuit of r */
export function pursuit(state, r, effort = 0) {
  profile(state, r);
  const offer = r.offer || 0, rel = relationship(state, r, effort);
  const f = factors(state, state.user, r, offer, rel), u = utility(r, f);
  const riv = bestRival(state, r, state.user);
  const rf = riv.team ? factors(state, riv.team, r, aiOffer(state, riv.team, r), aiRel(state, riv.team)) : null;
  return { f, u, rel, rival: riv.team, ru: riv.u, rf, edge: u - riv.u };
}

// ── NIL negotiation: make an offer, the recruit answers ──
export function negotiate(state, r, amount) {
  profile(state, r);
  const a = Math.max(0, Math.round(+amount || 0)), ratio = a / Math.max(5, r.ask);
  if (ratio >= 1) { r.offer = a; r.nilState = 'accepted'; return { ok: true, msg: `${r.name} accepts $${a}k a year.` }; }
  if (ratio >= 0.8) { const c = Math.round((a + r.ask) / 2 / 5) * 5; r.offer = a; r.counter = c; r.nilState = 'counter'; return { ok: false, msg: `${r.name}'s camp counters at $${c}k.` }; }
  if (ratio >= 0.5) { r.offer = a; r.nilState = 'low'; return { ok: false, msg: `${r.name} is lukewarm — he's looking for about $${r.ask}k.` }; }
  r.offer = a; r.nilState = 'insulted'; r.relAdj = (r.relAdj || 0) - 6;
  return { ok: false, msg: `${r.name}'s family felt lowballed (relationship −6).` };
}
export function acceptCounter(state, r) { if (r.counter) { r.offer = r.counter; r.ask = r.counter; r.nilState = 'accepted'; r.counter = null; } }
export const committedNIL = state => (state.rclass || (state.off && state.off.recruits) || []).filter(r => r.offer && r.nilState === 'accepted').reduce((s, r) => s + r.offer, 0);

/** signing-day odds for the user: logistic on the edge over the best rival (+ visits, + difficulty) */
export function userOdds(state, r, effort, extra = 0) {
  const p = pursuit(state, r, effort);
  const x = p.edge * 0.9 + (r.vb || 0) + extra;
  return 1 / (1 + Math.exp(-x));
}

/** AI signing: the recruit picks the program (among those with a spot) whose offer he likes most */
export function pickSchool(state, r, open, rng) {
  profile(state, r);
  let best = null, bu = -1e9;
  for (const t of open) {
    const u = utility(r, factors(state, t, r, aiOffer(state, t, r), aiRel(state, t))) + rng.normal(0, 1.6);   // his own reasons
    if (u > bu) { bu = u; best = t; }
  }
  return best;
}
export function notePro(state, team) { (state.pros = state.pros || {})[team] = ((state.pros[team] || []).concat([state.year])).slice(-12); }
