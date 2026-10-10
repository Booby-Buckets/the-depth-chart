// Season schedules (Oct 2026 rebuild, owner: "rivalries carried forward, tiered non-conference scheduling with
// guarantee money, a scheduling step for my program, conference refinements"). Every generated season:
//   1. CONFERENCE — leagues of <= 11 play a double round robin; bigger leagues play everyone once plus rematches up to
//      18 (20 in the top tier) games, the rematches going to PROTECTED partners first (pairs that met twice the year
//      before — the real 2026-27 slate seeds them), then the nearest schools. Every single-meeting pair alternates its
//      home floor year to year (state.series). Leagues that really do (Big Ten, ACC, Big East) open in December.
//   2. MULTI-TEAM EVENTS (mte.js) — the user can pick his event or skip it.
//   3. LOCKED — annual non-conference rivalries (data/dynasty-rivals.json: met in 4+ of the last 6 seasons; home
//      alternates, neutral series stay neutral) and home-and-home return games owed from last season (state.hah).
//   4. THE USER'S PICKS (state.off.sched, the offseason scheduling step).
//   5. EVERYONE ELSE, BY TIER — the top programs play 1-2 marquee games (neutral, or home-and-home) and host
//      "buy games" against lower-tier schools who travel for a guarantee check (g.pay, paid host -> visitor from the
//      NIL collectives when the game is played: zero-sum); then peers fill the rest; low-majors short of games host
//      non-D-I teams.
//   6. DATES — every non-conference game lands on an open day (a day's rest on both sides when possible), rivalries
//      near their traditional date.
// Pure: works on the state object.
import { planMTEs, EVENTS, ccOpponent } from './mte.js?v=54';
import { miles } from './recruit.js?v=54';

const ISO = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const addD = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayN = iso => Math.round(Date.parse(iso + 'T12:00:00Z') / 864e5);
export const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
export const TIER_PAY = [100, 75, 45, 25];                       // $k a host pays for a one-off buy game, by its tier
export const TIER_NAME = ['Power', 'High-major', 'Mid-major', 'Low-major'];
const DEC_ROUNDS = { B10: ['12-03', '12-06'], ACC: ['12-02'], 'Big-East': ['12-17', '12-20'] };   // league games before Christmas
const TOTAL = 31;                                                 // a regular season, events included

function circle(teams) {
  const t = teams.length % 2 ? teams.concat([null]) : teams.slice(), n = t.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) { const a = t[i], b = t[n - 1 - i]; if (a && b) pairs.push(r % 2 ? [a, b] : [b, a]); }
    rounds.push(pairs); t.splice(1, 0, t.pop());
  }
  return rounds;
}

/** 0 Power .. 3 Low-major: realign.js's league tiers, or (first season) league level rank */
export function tiers(state) {
  const out = {};
  if (state.confs) for (const t of Object.values(state.teams)) out[t.name] = state.confs[t.conf] ? state.confs[t.conf].tier : 3;
  else {
    const lv = {}; for (const t of Object.values(state.teams)) (lv[t.conf] = lv[t.conf] || []).push(t.level || 0);
    const order = Object.keys(lv).sort((a, b) => lv[b].reduce((x, y) => x + y, 0) / lv[b].length - lv[a].reduce((x, y) => x + y, 0) / lv[a].length);
    const ct = Object.fromEntries(order.map((c, i) => [c, i < 5 ? 0 : i < 11 ? 1 : i < 21 ? 2 : 3]));
    for (const t of Object.values(state.teams)) out[t.name] = ct[t.conf];
  }
  return out;
}
/** league games a team plays in a league of n (tier = the league's tier) */
export const confGames = (n, tier) => (n <= 11 ? 2 * (n - 1) : tier === 0 ? 20 : 18);

// protected partners: pairs that met twice in league play last season (the real slate the first time)
function learnProtected(state) {
  if (state.protected) return;
  const cnt = {};
  for (const g of state.schedule || []) if (g.c && !g.t && state.teams[g.h] && state.teams[g.a] && state.teams[g.h].conf === state.teams[g.a].conf) { const k = pairKey(g.h, g.a); cnt[k] = (cnt[k] || 0) + 1; }
  state.protected = Object.keys(cnt).filter(k => cnt[k] >= 2);
}

function conference(state, rng, add) {
  const T = tiers(state), confs = {};
  for (const t of Object.values(state.teams)) (confs[t.conf] = confs[t.conf] || []).push(t.name);
  const prot = new Set(state.protected || []), S = state.series = state.series || {};
  const y = state.year;
  for (const [conf, members] of Object.entries(confs)) {
    const n = members.length; if (n < 2) continue;
    const R = circle(members.slice().sort(() => rng.next() - 0.5));
    let rounds;
    if (n <= 11) rounds = R.concat(R.map(rd => rd.map(([h, a]) => [a, h])));
    else {
      // one meeting each (home alternates year to year) + rematches: protected partners, then neighbours
      const single = R.map(rd => rd.map(([h, a]) => { const k = pairKey(h, a); const home = S[k] ? (S[k] === h ? a : h) : h; S[k] = home; return home === h ? [h, a] : [a, h]; }));
      const firstHome = {}; single.flat().forEach(([h, a]) => { firstHome[pairKey(h, a)] = h; });
      const k = confGames(n, T[members[0]]) - (n - 1);
      const st = Object.fromEntries(members.map(m => [m, state.teams[m].state]));
      const edges = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = members[i], b = members[j];
        edges.push([a, b, (prot.has(pairKey(a, b)) ? 3 : 0) + (1 - Math.min(2000, miles(st[a], st[b])) / 2000) + rng.next() * 0.35]);
      }
      edges.sort((x, z) => z[2] - x[2]);
      const used = new Set(), extra = [], newProt = [];
      for (let r = 0; r < k; r++) {
        const busy = new Set(), rd = [];
        for (const [a, b] of edges) {
          const key = pairKey(a, b);
          if (used.has(key) || busy.has(a) || busy.has(b)) continue;
          busy.add(a); busy.add(b); used.add(key); newProt.push(key);
          const h0 = firstHome[key]; rd.push(h0 === a ? [b, a] : [a, b]);   // the rematch flips the floor
        }
        extra.push(rd);
      }
      state.protected = (state.protected || []).filter(x => !members.some(m => x.startsWith(m + '|') || x.endsWith('|' + m))).concat(newProt);
      // rematches spread through the second half of league play
      rounds = single.slice();
      extra.forEach((rd, i) => rounds.splice(Math.min(rounds.length, Math.floor(single.length * 0.45) + i * Math.ceil(single.length / (k + 1))), 0, rd));
    }
    // dates: any December rounds, then from Dec 30 (top leagues) or Jan 2 to the first week of March
    const dec = (DEC_ROUNDS[conf] || []).slice(0, Math.max(0, rounds.length - 14));
    const start = T[members[0]] <= 1 ? ISO(y - 1, 12, 30) : ISO(y, 1, 2), end = ISO(y, 3, 7);
    const rest = rounds.length - dec.length, step = Math.max(2, Math.floor((dayN(end) - dayN(start)) / Math.max(1, rest - 1)));
    rounds.forEach((rd, i) => {
      const d = i < dec.length ? `${y - 1}-${dec[i]}` : addD(start, Math.min(dayN(end) - dayN(start), (i - dec.length) * step));
      rd.forEach(([h, a]) => add(d, h, a, false, true));
    });
  }
}

/** non-conference games each program plays (its league slate known) */
export function ncNeed(state, team, confN, tier) { return Math.max(8, Math.min(15, TOTAL - confGames(confN, tier))); }
const mteGames = m => (m.showcase ? 1 : m.size === 8 ? 3 : 2);

export function makeSchedule(state, rngFor) {
  learnProtected(state);
  const rng = rngFor(state, 'schedule'), y = state.year, games = [];
  let gid = 0;
  const add = (d, h, a, n, c, extra) => { const g = Object.assign({ id: `${y}-${gid++}`, d, h, a, n, c, r: null }, extra || {}); games.push(g); return g; };
  conference(state, rng, add);
  // multi-team events (the user may have picked one, or none)
  const M = planMTEs(state, rngFor(state, 'mte'), state.off && state.off.sched ? state.off.sched.event : undefined);
  M.games.forEach(g => games.push(g)); state.pending = M.pending;

  const T = tiers(state), names = Object.keys(state.teams), U = state.user;
  const confN = {}; for (const t of names) confN[state.teams[t].conf] = (confN[state.teams[t].conf] || 0) + 1;
  const need = {}, opp = {};
  for (const t of names) { need[t] = ncNeed(state, t, confN[state.teams[t].conf], T[t]); opp[t] = new Set(); }
  for (const m of state.mtes || []) for (const x of m.teams) need[x.team] -= mteGames(m);
  for (const g of M.games) if (opp[g.h] && opp[g.a]) { opp[g.h].add(g.a); opp[g.a].add(g.h); }   // an event's day-one / showcase opponent: not again
  const nc = [];                                    // non-conference games still to date: { h, a, n, pay, md, kind }
  const can = (a, b) => a !== b && state.teams[a] && state.teams[b] && state.teams[a].conf !== state.teams[b].conf && !opp[a].has(b);
  const book = (h, a, n, kind, extra = {}) => { opp[h].add(a); opp[a].add(h); need[h]--; need[a]--; nc.push(Object.assign({ h, a, n, kind }, extra)); };
  const hah = state.hah || []; state.hah = [];
  const owe = (h, a) => state.hah.push({ h, a, y: y + 1 });   // next season's return game

  // locked: home-and-home returns owed this season, then the annual rivalries (home alternates)
  for (const x of hah) if (x.y === y && can(x.h, x.a)) book(x.h, x.a, false, 'return');
  const S = state.series = state.series || {};
  for (const [a, b, neu, md, last] of state.rivals || []) {
    if (!can(a, b)) continue;
    const k = pairKey(a, b), prev = S[k] || last;
    const h = neu ? (rng.chance(0.5) ? a : b) : prev === a ? b : a;
    S[k] = h; book(h, h === a ? b : a, !!neu, 'rivalry', { md });
  }
  // the user's own picks (the offseason scheduling step)
  const req = state.off && state.off.sched ? state.off.sched.games || [] : [];
  for (const r of req) {
    if (!can(U, r.opp)) continue;
    const [h, a] = r.v === 'A' ? [r.opp, U] : [U, r.opp];
    book(h, a, r.v === 'N', r.kind || 'pick', r.pay ? { pay: r.pay } : {});
    if (r.kind === 'hah') owe(a, h);
  }
  const ai = () => true;                            // (the user's open slots are filled by the same rules: 'my AD fills the rest')
  const pr = t => state.teams[t].prestige || 30;
  const shuffled = arr => arr.slice().sort(() => rng.next() - 0.5);

  // marquee: the top programs play each other (neutral showcases or home-and-homes)
  const marq = {}; for (const t of names) if (ai(t) && (T[t] === 0 || (T[t] === 1 && pr(t) >= 60))) marq[t] = Math.min(need[t], pr(t) >= 75 ? 2 : 1);
  for (const a of shuffled(Object.keys(marq))) {
    while (marq[a] > 0 && need[a] > 0) {
      const b = Object.keys(marq).filter(x => marq[x] > 0 && need[x] > 0 && can(a, x)).sort((x, z) => Math.abs(pr(x) - pr(a)) - Math.abs(pr(z) - pr(a)) + (rng.next() - 0.5) * 30)[0];
      if (!b) { marq[a] = 0; break; }
      marq[a]--; marq[b]--;
      if (rng.chance(0.45)) book(a, b, true, 'marquee');
      else { const [h, w] = rng.chance(0.5) ? [a, b] : [b, a]; book(h, w, false, 'marquee'); owe(w, h); }
    }
  }
  // buy games: bigger programs host, lower-tier schools travel for a guarantee
  const supply = {}; for (const t of names) if (ai(t) && T[t] >= 2) supply[t] = Math.min(need[t], T[t] === 3 ? 5 : 2);
  const hosts = names.filter(t => ai(t) && T[t] <= 1).sort((a, b) => pr(b) - pr(a));
  for (let pass = 0; pass < 12; pass++) {
    let any = false;
    for (const h of hosts) {
      if (need[h] <= (T[h] === 0 ? 0 : 2)) continue;
      const cands = Object.keys(supply).filter(v => supply[v] > 0 && need[v] > 0 && T[v] > T[h] && can(h, v));
      if (!cands.length) continue;
      const st = state.teams[h].state;
      const v = cands.sort((x, z) => miles(st, state.teams[x].state) - miles(st, state.teams[z].state) + (rng.next() - 0.5) * 900)[0];
      supply[v]--; book(h, v, false, 'buy', { pay: TIER_PAY[T[h]] }); any = true;
    }
    if (!any) break;
  }
  // everyone else: peers, home and away
  for (let pass = 0; pass < 3; pass++) {
    const left = shuffled(names.filter(t => ai(t) && need[t] > 0)).sort((a, b) => T[a] - T[b]);
    for (const a of left) {
      while (need[a] > 0) {
        const b = left.find(x => need[x] > 0 && Math.abs(T[x] - T[a]) <= (pass === 2 ? 3 : 1) && can(a, x));
        if (!b) break;
        const n = rng.chance(0.08), [h, w] = rng.chance(0.5 + (pr(a) - pr(b)) / 200) ? [a, b] : [b, a];
        book(h, w, n, 'peer');
      }
    }
  }
  // low-majors still short host a non-D-I opponent
  const ext = Object.keys((state.ext && state.ext.teams) || {}).sort();
  let ek = 0;
  for (const t of names) while (need[t] > 0 && ext.length && T[t] >= 2) { nc.push({ h: t, a: ext[ek++ % ext.length], n: false, kind: 'nond1', fill: true }); need[t]--; }

  // dates: Nov 3 – Dec 29, both sides open with a day's rest when possible; rivalries near their usual date
  const busy = {}; const mark = (t, d) => (busy[t] = busy[t] || new Set()).add(dayN(d));
  for (const g of games) { mark(g.h, g.d); mark(g.a, g.d); }
  for (const m of state.mtes || []) for (const x of m.teams) for (const d of m.days) mark(x.team, d);   // an event's later days too
  const free = (t, n, gap) => { const B = busy[t]; if (!B) return true; for (let k = -gap; k <= gap; k++) if (B.has(n + k)) return false; return true; };
  const first = dayN(ISO(y - 1, 11, 3)), last = dayN(ISO(y - 1, 12, 29));
  const order = { return: 0, rivalry: 0, pick: 1, buy: 3, hah: 1, gtee: 1, neutral: 1, marquee: 2, peer: 4, nond1: 5 };
  nc.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || rng.next() - 0.5);
  const xmas = [dayN(ISO(y - 1, 12, 24)), dayN(ISO(y - 1, 12, 25))];   // nobody plays on Christmas Eve / Day
  const days = []; for (let n = first; n <= last; n++) if (!xmas.includes(n)) days.push(n);
  for (const g of nc) {
    const pref = g.md ? dayN(`${y - 1}-${g.md}`) : null;
    const cand = pref && pref >= first && pref <= last ? days.slice().sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref)) : days.slice().sort(() => rng.next() - 0.5);
    let d = null;
    for (const gap of [2, 1, 0]) { d = cand.find(n => free(g.h, n, gap) && free(g.a, n, gap)); if (d != null) break; }
    if (d == null) continue;                                   // nowhere to put it: dropped
    const iso = new Date(d * 864e5).toISOString().slice(0, 10);
    mark(g.h, iso); mark(g.a, iso);
    add(iso, g.h, g.a, g.n, false, Object.assign(g.pay ? { pay: g.pay } : {}, g.fill ? { fill: true } : {}, { k: g.kind }));
  }
  return games.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

// ── the user's scheduling step (offseason) ──
/** what's already set for next season + how many games the user still picks */
export function userSchedInfo(state) {
  const U = state.user, O = state.off, inv = (O.invites || []).find(i => i.team === U && i.decision === 'accept' && !i.done);
  const conf = inv ? inv.to : state.teams[U].conf, T = tiers(state);
  const confTier = state.confs && state.confs[conf] ? state.confs[conf].tier : T[U];
  const n = Object.values(state.teams).filter(t => t.conf === conf && t.name !== U).length + 1;
  const cg = confGames(n, confTier), target = TOTAL - cg;
  const sameConf = t => state.teams[t].conf === conf;
  const locked = [];
  for (const x of state.hah || []) if (x.y === state.year + 1 && (x.h === U || x.a === U)) { const o = x.h === U ? x.a : x.h; if (state.teams[o] && !sameConf(o)) locked.push({ opp: o, v: x.h === U ? 'H' : 'A', why: 'Return game (home-and-home)' }); }
  const S = state.series || {};
  for (const [a, b, neu, md, last] of state.rivals || []) {
    if (a !== U && b !== U) continue;
    const o = a === U ? b : a; if (!state.teams[o] || sameConf(o) || locked.some(l => l.opp === o)) continue;
    const prev = S[pairKey(a, b)] || last;
    locked.push({ opp: o, v: neu ? 'N' : prev === U ? 'A' : 'H', why: 'Annual rivalry', md });
  }
  const cc = ccOpponent(U, state.year + 1);
  if (cc && state.teams[cc] && !locked.some(l => l.opp === cc)) locked.push({ opp: cc, v: 'N', why: 'Champions Classic' });
  const sched = O.sched = O.sched || { event: undefined, games: [] };
  const evGames = sched.event === null ? 0 : sched.event ? (eventOptions(state).find(e => e.name === sched.event) || { games: 3 }).games : 3;
  const open = Math.max(0, target - evGames - locked.length - sched.games.length);
  return { conf, confGames: cg, target, locked, open, evGames, sched, tier: T[U] };
}

/** the events that would invite the user's program (by its stature), with how many games each is */
export function eventOptions(state) {
  const U = state.user, order = Object.values(state.teams).sort((a, b) => (b.prestige || 30) - (a.prestige || 30)).map(t => t.name);
  const r = order.indexOf(U), tier = r < 62 ? 0 : r < 230 ? 1 : 2;
  return EVENTS_FOR(tier);
}
const EVENTS_FOR = tier => EVENTS.filter(e => e.tier === tier || (tier > 0 && e.tier === tier - 1 && e.size === 4)).map(e => ({ name: e.name, site: e.site, size: e.size, tier: e.tier, games: e.size === 8 ? 3 : 2 }));

/** would `opp` agree to play the user there? -> { ok, msg, kind, pay } (deterministic: the same ask gets the same answer) */
export function askGame(state, opp, v) {
  const U = state.user, T = tiers(state), pu = state.teams[U].prestige || 30, po = state.teams[opp].prestige || 30;
  const tu = T[U], to = T[opp], name = opp;
  if (v === 'H') {
    if (to > tu) return { ok: true, kind: 'buy', pay: -TIER_PAY[tu], msg: `${name} will come — for a $${TIER_PAY[tu]}k guarantee (a buy game).` };
    if (to === tu) return po <= pu + 15 ? { ok: true, kind: 'hah', pay: 0, msg: `${name} agrees to a home-and-home: here this season, at their place next season.` } : { ok: false, msg: `${name} wants you to come to them first.` };
    return pu >= po - 5 ? { ok: true, kind: 'hah', pay: 0, msg: `${name} agrees to a home-and-home: here this season, at their place next season.` } : { ok: false, msg: `${name} won't play a true road game at a ${TIER_NAME[tu].toLowerCase()} program.` };
  }
  if (v === 'A') {
    if (to < tu) return { ok: true, kind: 'gtee', pay: TIER_PAY[to], msg: `${name} will host you and pay a $${TIER_PAY[to]}k guarantee.` };
    if (to === tu) return { ok: true, kind: 'hah', pay: 0, msg: `${name} agrees to a home-and-home: at their place this season, at yours next season.` };
    return { ok: true, kind: 'road', pay: 0, msg: `${name} would love to host you — a big night for them, no money for you.` };
  }
  return Math.abs(po - pu) <= 25 || po < pu ? { ok: true, kind: 'neutral', pay: 0, msg: `${name} agrees to a neutral-site game.` } : { ok: false, msg: `${name} isn't interested in a neutral-site game with you.` };
}
export function addGame(state, opp, v) {
  const I = userSchedInfo(state);
  if (I.open <= 0) return { ok: false, msg: 'Your schedule is full — remove a game or skip your event to free a slot.' };
  if (I.locked.some(l => l.opp === opp) || I.sched.games.some(g => g.opp === opp)) return { ok: false, msg: 'You already play them.' };
  const r = askGame(state, opp, v); if (!r.ok) return r;
  I.sched.games.push({ opp, v, kind: r.kind, pay: Math.abs(r.pay || 0) });   // pay = what the host sends the visitor
  return r;
}
export const removeGame = (state, opp) => { const s = state.off.sched; s.games = s.games.filter(g => g.opp !== opp); };
export const chooseEvent = (state, name) => { (state.off.sched = state.off.sched || { games: [] }).event = name; };
