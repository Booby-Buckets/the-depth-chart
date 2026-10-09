// Head coaches, job security and the coaching carousel (Oct 2026 rebuild, owner: "add the coaching carousel and
// staff hiring"). Every program has a head coach (the real 2026-27 hires to start) who is a real person here:
//   coach = { id, name, age, r (overall), off, def, rec, dev (sub-ratings), yrs (tenure), cont (contract years left),
//             pay ($k), hot (hot seat: 0.55 memory + this season vs expectations), car: { w, l, ncaa, ff, titles, jobs } }
// A coach's quality nudges how his program runs (AI programs only — the user IS the coach): practice by off/def,
// recruiting by rec, development by dev, all RELATIVE to what a program of that stature usually has, so better
// coaches overachieve and the league's balance stays where it is. Coaches develop into their late 40s, decline
// after 60 and retire.
// The carousel runs in two halves around the user's decision:
//   1. evaluateCoaches (season's end): results vs expectations -> hot seats; firings (with buyouts paid from the
//      collective) and retirements open jobs; the user's security moves and offers come from openings that want him
//   2. runCarousel (after the user accepts an offer or stays): openings fill best job first — a sitting coach from a
//      smaller program moving up (his job opens: the cascade), a top assistant getting his first head job (his
//      program loses a staffer), a fired coach getting another chance, or a new name
// Pure: works on the state object.
import { power, record_ } from './season.js?v=49';
import { powerFeatures } from './league.js?v=49';
import { ncaaResult } from './postseason.js?v=49';
import { makeRng, hashSeed } from './rng.js?v=49';
import { DIFFS } from './program.js?v=49';
import { news } from './injuries.js?v=49';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const BUMP = { Champion: 3, 'Runner-up': 2.3, 'Final Four': 2, 'Elite Eight': 1.2, 'Sweet 16': 0.6, 'Round of 32': 0.2 };
/** the coach a program of this prestige usually has (a blue blood ~80, a low-major ~55) */
export const wantFor = prestige => 48 + (prestige || 30) * 0.35;
const payHC = (r, prestige) => Math.round((150 + (r * r) / 9) * (0.45 + (prestige || 30) / 110));   // $k a year
let seq = 0;

function makeCoach(state, rng, name, r, opts = {}) {
  r = Math.round(clamp(r, 35, 95));
  const sub = () => Math.round(clamp(r + rng.normal(0, 6), 30, 99));
  return Object.assign({ id: `c${state.year}-${(seq++).toString(36)}-${rng.int(1e6).toString(36)}`, name, age: 38 + rng.int(26), r, off: sub(), def: sub(), rec: sub(), dev: sub(),
    yrs: 0, cont: 5, hot: 0, car: { w: 0, l: 0, ncaa: 0, ff: 0, titles: 0, jobs: 1 } }, opts);
}

export function initCoaches(state, snap, userName) {
  const byName = Object.fromEntries((snap ? snap.teams.concat(snap.shells || []) : []).map(t => [t.name, t.coach]));
  const rng = makeRng(hashSeed(`${state.seed}:coaches`));
  for (const t of Object.values(state.teams)) {
    if (t.name === state.user) { t.coach = { name: userName || 'You', yrs: 0, user: true, hot: 0, car: { w: 0, l: 0, ncaa: 0, ff: 0, titles: 0, jobs: 1 } }; continue; }
    t.coach = makeCoach(state, rng, byName[t.name] || randomName(state, rng), wantFor(t.prestige) + rng.normal(0, 7), { yrs: 1 + rng.int(12), cont: 1 + rng.int(6) });
    t.coach.pay = payHC(t.coach.r, t.prestige);
  }
  state.job = { security: 60, seasons: 0, offers: [], fired: false, log: [], rep: Math.round(wantFor(state.teams[state.user] ? state.teams[state.user].prestige : 50) - 4) };
  state.coachPool = [];
}
/** saves from before coach ratings: give every coach attributes (keeps names, tenure, hot seats) */
export function ensureCoaches(state) {
  const rng = makeRng(hashSeed(`${state.seed}:coaches2`));
  for (const t of Object.values(state.teams)) {
    const c = t.coach; if (!c) continue;
    if (c.user) { c.car = c.car || { w: 0, l: 0, ncaa: 0, ff: 0, titles: 0, jobs: 1 }; continue; }
    if (c.r == null) Object.assign(c, makeCoach(state, rng, c.name, wantFor(t.prestige) + rng.normal(0, 7), { yrs: c.yrs || 0, cont: 1 + rng.int(5), hot: c.hot || 0 }), { name: c.name });
    if (c.pay == null) c.pay = payHC(c.r, t.prestige);
  }
  if (state.job && state.job.rep == null) state.job.rep = Math.round(wantFor(state.teams[state.user] ? state.teams[state.user].prestige : 50) - 4);
  state.coachPool = state.coachPool || [];
}

/** an AI program's area multiplier from its head coach, relative to what its stature usually brings (~0.85-1.2) */
export function coachMult(team, area) {
  const c = team.coach; if (!c || c.user || c.r == null) return 1;
  const sub = area === 'practice' ? (c.off + c.def) / 2 : area === 'recruiting' ? c.rec : area === 'development' ? c.dev : c.r;
  return clamp(1 + (sub - wantFor(team.prestige)) / 120, 0.82, 1.22);
}

function randomName(state, rng) {
  if (state.names) return `${state.names.f[rng.int(state.names.f.length)]} ${state.names.l[rng.int(state.names.l.length)]}`;   // frozen pool
  const ps = Object.values(state.players);
  const a = ps[rng.int(ps.length)].name.split(' ')[0], b = ps[rng.int(ps.length)].name.split(' ').slice(1).join(' ') || 'Smith';
  return `${a} ${b}`;
}
const age1 = (c, rng) => {                                   // a year older: growth early, decline late
  c.age = (c.age || 50) + 1;
  const d = c.age < 42 ? 0.8 : c.age < 52 ? 0.1 : c.age < 60 ? -0.5 : -1.5;
  for (const k of ['r', 'off', 'def', 'rec', 'dev']) c[k] = Math.round(clamp(c[k] + d + rng.normal(0, 1.2), 30, 99));
};

/** in-season hot seat: last year's heat + how this season is going vs the preseason roster rating */
export function hotNow(state) {
  const pw = power(state), T = Object.keys(state.teams);
  const prior = Object.fromEntries(T.map(t => [t, powerFeatures(state.teams[t], state.players, state.maps).reduce((s, x, i) => s + x * state.powerFit[i], 0)]));
  const rankBy = m => Object.fromEntries(T.slice().sort((a, b) => m[b] - m[a]).map((t, i) => [t, i + 1]));
  const pre = rankBy(prior), fin = rankBy(pw), out = {};
  for (const t of T) { const c = state.teams[t].coach; out[t] = 0.55 * ((c && c.hot) || 0) + (pre[t] - fin[t]) / 25; }
  return out;
}

// ── 1. season's end: judge, age, fire / retire, the user's job + offers ──
export function evaluateCoaches(state) {
  ensureCoaches(state);
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:carousel`));
  const pw = power(state), T = Object.keys(state.teams);
  const prior = Object.fromEntries(T.map(t => [t, powerFeatures(state.teams[t], state.players, state.maps).reduce((s, x, i) => s + x * state.powerFit[i], 0)]));
  const rankBy = m => Object.fromEntries(T.slice().sort((a, b) => m[b] - m[a]).map((t, i) => [t, i + 1]));
  const pre = rankBy(prior), fin = rankBy(pw);
  const perf = {};
  const lastDay = state.schedule.reduce((m, g) => (g.d > m ? g.d : m), '');
  const open = [];
  for (const t of T) {
    const r = ncaaResult(state, t), c = state.teams[t].coach, rec = record_(state, t);
    perf[t] = (pre[t] - fin[t]) / 25 + (BUMP[r] || 0) - (!r && pre[t] <= 30 ? 0.8 : 0);
    if (!c) continue;
    const car = c.car = c.car || { w: 0, l: 0, ncaa: 0, ff: 0, titles: 0, jobs: 1 };
    car.w += rec.w; car.l += rec.l; if (r) car.ncaa++; if (['Final Four', 'Runner-up', 'Champion'].includes(r)) car.ff++; if (r === 'Champion') car.titles++;
    if (c.user) continue;
    c.hot = 0.55 * (c.hot || 0) + perf[t];
    c.yrs = (c.yrs || 0) + 1; c.cont = Math.max(0, (c.cont ?? 3) - 1);
    age1(c, rng);
    const P = state.teams[t].prestige || 30, grace = P > 70 ? 2 : 3;
    const fireP = c.yrs < grace ? 0 : c.hot < -2 ? 0.75 : c.hot < -1.2 ? (P > 70 ? 0.45 : 0.3) : 0;
    const retireP = c.age >= 70 ? 0.5 : c.age >= 65 ? 0.18 : c.age >= 60 ? 0.05 : 0.01;
    if (rng.chance(fireP)) {
      const buy = Math.round(Math.min(c.cont, 4) * (c.pay || 300) * 0.5);   // the buyout comes out of the collective
      const pr = state.teams[t].prog; if (pr && buy) pr.nil.fund = Math.max(0, pr.nil.fund - buy);
      open.push({ team: t, why: 'fired', prev: c.name, buyout: buy });
      news(state, lastDay, 'coach', `[[${t}]] fires ${c.name}${buy ? ` ($${buy}k buyout)` : ''}`, t);
      (state.coachPool = state.coachPool || []).push(Object.assign(c, { hot: 0, fired: state.year }));
      state.teams[t].coach = null;
    } else if (rng.chance(retireP)) {
      open.push({ team: t, why: 'retired', prev: c.name });
      news(state, lastDay, 'coach', `${c.name} retires at [[${t}]] after ${c.yrs} season${c.yrs === 1 ? '' : 's'}`, t);
      state.teams[t].coach = null;
    } else if (c.cont <= 0) { c.cont = 2 + rng.int(4); c.pay = payHC(c.r, state.teams[t].prestige); }   // extension
  }
  for (const c of state.coachPool || []) age1(c, rng);
  state.coachPool = (state.coachPool || []).filter(c => c.age < 68 && state.year - (c.fired || state.year) <= 4).sort((a, b) => b.r - a.r).slice(0, 60);
  // the user: security, reputation, offers, the axe
  const J = state.job, U = state.user, up = state.teams[U].prestige;
  J.seasons++;
  const p = perf[U];
  const jk = (DIFFS[state.diff || 'pro'] || DIFFS.pro).jobK, dj = 14 * p;   // harder levels: losing costs more, winning buys less
  J.security = Math.round(clamp(J.security + (dj < 0 ? dj * jk : dj / Math.sqrt(jk)) - (J.seasons <= 1 ? 0 : 2), 0, 100));
  J.rep = Math.round(clamp((J.rep ?? wantFor(up) - 4) + 3.2 * p, 30, 97));
  J.log.push({ year: state.year, perf: Math.round(p * 10) / 10, security: J.security, pre: pre[U], fin: fin[U], rep: J.rep });
  J.offers = []; J.fired = false;
  if (J.security < 15 && J.seasons >= 2) {
    J.fired = true;
    news(state, lastDay, 'coach', `You have been fired at [[${U}]]`, U);
    // a step down: openings that will take a chance on you, and smaller programs that would make room
    let o = open.filter(x => state.teams[x.team].prestige < up - 5).map(x => x.team);
    if (o.length < 3) o = o.concat(T.filter(t => t !== U && !o.includes(t) && state.teams[t].prestige < up - 8 && wantFor(state.teams[t].prestige) <= J.rep + 8).sort(() => rng.next() - 0.5).slice(0, 3 - o.length));
    J.offers = o.slice(0, 4);
  } else {
    // openings at bigger programs whose AD would hire you (your reputation vs the coach they want)
    J.offers = open.filter(x => state.teams[x.team].prestige > up + 3 && wantFor(state.teams[x.team].prestige) <= J.rep + 4).map(x => x.team)
      .sort((a, b) => state.teams[b].prestige - state.teams[a].prestige).slice(0, 4);
  }
  state.carousel = { year: state.year, open, hires: [], done: false, offers: J.offers.slice() };
  return perf;
}

// ── the user's call ──
/** take another job (an offer): the user moves, his old program joins the openings */
export function takeJob(state, team) {
  const old = state.teams[state.user], nu = state.teams[team];
  const me = old.coach;
  old.coach = null; old.minutes = null; old.starters = null;
  const C = state.carousel;
  if (C && !C.done) { C.open = C.open.filter(x => x.team !== team); C.open.push({ team: old.name, why: 'left', prev: me.name }); }
  else old.coach = { name: 'Interim coach', yrs: 0, hot: 0, r: 50, off: 50, def: 50, rec: 50, dev: 50, age: 45, cont: 1, car: { w: 0, l: 0, ncaa: 0, ff: 0, titles: 0, jobs: 1 } };
  if (nu.coach && !nu.coach.user) (state.coachPool = state.coachPool || []).push(Object.assign(nu.coach, { fired: state.year }));   // he made room
  nu.coach = Object.assign({}, me, { yrs: 0, user: true }); nu.coach.car.jobs = (nu.coach.car.jobs || 1) + 1;
  nu.minutes = null; nu.starters = null;
  news(state, `${state.year}-03-30`, 'coach', `You are the new head coach at [[${team}]]`, team);
  state.user = team;
  state.job = { security: 60, seasons: 0, offers: [], fired: false, log: state.job.log, rep: state.job.rep };
  if (state.off) { state.off.offers = {}; state.off.board = {}; }
}

// ── 2. the AI fills every opening, best job first, with the cascade ──
export function runCarousel(state) {
  const C = state.carousel; if (!C || C.done) return;
  ensureCoaches(state);
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:carousel2`));
  const T = Object.keys(state.teams), U = state.user, moved = new Set(), d = `${state.year}-04-02`;
  const queue = C.open.slice();
  let guard = 0;
  while (queue.length && guard++ < 400) {
    queue.sort((a, b) => state.teams[b.team].prestige - state.teams[a.team].prestige);
    const o = queue.shift(), T0 = state.teams[o.team];
    if (T0.coach) continue;                                   // (filled already)
    const want = wantFor(T0.prestige), cands = [];
    // sitting head coaches at smaller programs who have earned a step up
    for (const t of T) {
      const c = state.teams[t].coach;
      if (!c || c.user || moved.has(t) || t === o.team || (c.yrs || 0) < 2) continue;
      if (state.teams[t].prestige > T0.prestige - 8 || (c.hot < 0.5 && c.r < want + 3)) continue;
      cands.push({ kind: 'hc', from: t, c, s: c.r + 2 + 4 * c.hot - Math.max(0, c.age - 58) + rng.next() * 4 });
    }
    // top assistants ready for a first head job
    for (const t of T) {
      const P = state.teams[t].prog; if (!P) continue;
      for (const [k, s] of Object.entries(P.staff)) if (s && s.r >= 74 && (s.age || 45) <= 58) cands.push({ kind: 'asst', from: t, role: k, s0: s, s: s.r - 9 + rng.next() * 5 });   // unproven as a head coach
    }
    // fired coaches looking for another chance
    for (const c of state.coachPool || []) cands.push({ kind: 'pool', c, s: c.r - 6 + rng.next() * 4 });
    const pick = cands.filter(x => x.s >= want - 12).sort((a, b) => b.s - a.s)[0];
    let coach, from = null, kind = 'new';
    if (pick && pick.kind === 'hc') {
      coach = pick.c; from = pick.from; kind = 'hc'; moved.add(from);
      const F = state.teams[from];
      T0.sysDef = Math.round((0.5 * (T0.sysDef || 0) + 0.5 * (F.sysDef || 0)) * 100) / 100;   // his defense comes along
      F.coach = null; queue.push({ team: from, why: 'left', prev: coach.name });
      news(state, d, 'coach', `${coach.name} leaves [[${from}]] for [[${o.team}]]`, o.team);
    } else if (pick && pick.kind === 'asst') {
      const s = pick.s0, F = state.teams[pick.from]; from = pick.from; kind = 'asst';
      coach = makeCoach(state, rng, s.name, s.r - 2, { age: s.age || 45 });
      F.prog.staff[pick.role] = null;
      if (pick.from === U) news(state, d, 'staff', `Your ${pick.role} ${s.name} is the new head coach at [[${o.team}]]`, U);
      news(state, d, 'coach', `[[${o.team}]] hires ${s.name}, an assistant at [[${from}]]`, o.team);
    } else if (pick && pick.kind === 'pool') {
      coach = pick.c; kind = 'pool'; state.coachPool = state.coachPool.filter(x => x !== coach); delete coach.fired;
      news(state, d, 'coach', `[[${o.team}]] gives ${coach.name} another chance`, o.team);
    } else {
      coach = makeCoach(state, rng, randomName(state, rng), want - 5 + rng.normal(0, 6));
      T0.sysDef = Math.round(clamp(rng.normal(0, 2.5), -6, 6) * 100) / 100;
      news(state, d, 'coach', `[[${o.team}]] hires ${coach.name}`, o.team);
    }
    coach.yrs = 0; coach.hot = 0.3; coach.cont = 5 + rng.int(2); coach.pay = payHC(coach.r, T0.prestige);
    if (kind !== 'new') coach.car = Object.assign({ w: 0, l: 0, ncaa: 0, ff: 0, titles: 0, jobs: 1 }, coach.car); if (kind === 'hc' || kind === 'pool') coach.car.jobs++;
    T0.coach = coach;
    C.hires.push({ team: o.team, why: o.why, prev: o.prev, name: coach.name, kind, from, r: coach.r });
  }
  for (const t of T) if (!state.teams[t].coach) state.teams[t].coach = makeCoach(state, rng, randomName(state, rng), wantFor(state.teams[t].prestige) - 6);   // safety
  C.done = true;
}
