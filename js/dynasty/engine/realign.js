// Conference realignment (Oct 2026, owner: "realignment, acceptable or deniable by whoever is simming … advantages
// and disadvantages depending on the league … to move up you have to be excelling, and there are contracts").
//
// Every offseason (after the season's power ratings are in) a realignment period runs:
//   • each conference gets a VALUE (0-100, smoothed: 80% memory) from its members' power and league level, a TIER
//     (Power / High-major / Mid-major / Low-major by value rank) and a MEDIA DEAL (revenue $k per member, locked
//     until the deal is renegotiated — a league that got stronger cashes in only at renewal)
//   • every program has a GRANT OF RIGHTS (t.gor.until): leave before it runs out and you owe an exit fee, paid off
//     over 3 seasons out of the collective; new members get a reduced revenue share (50%, then 75%, then full)
//   • conferences below their target size — or, now and then, any league with room — invite programs from lower-value
//     leagues that are EXCELLING: a 3-year power average at least the inviting league's median member (min 2 seasons)
//   • AI programs accept or decline on their own (value gain vs the exit fee); invitations to the user's program wait
//     for the user (state.off.invites; accept/decline in the offseason). Moves take effect next season (applyMoves,
//     before the schedule is built) — a departure opens a slot that league backfills next period (the cascade).
// What a league does for a program: revenue (staff budget + NIL deposit), exposure (brand in recruiting via
// t.lvAdj), the competition (harder league = more losses but a better NCAA résumé; weaker = an easier auto bid —
// that part simply happens on the court), and travel (miles to league opponents cost money).
// Pure: works on the state object.
import { makeRng, hashSeed } from './rng.js?v=54';
import { power } from './season.js?v=54';
import { miles } from './recruit.js?v=54';
import { news } from './injuries.js?v=54';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rngFor = (state, tag) => makeRng(hashSeed(`${state.seed}:${state.year}:realign:${tag}`));
export const TIERS = ['Power', 'High-major', 'Mid-major', 'Low-major'];
const TIER_OF = rank => (rank < 5 ? 0 : rank < 11 ? 1 : rank < 21 ? 2 : 3);
const MAX_SIZE = 18, MIN_SIZE = 7, CLOSED = new Set(['Ivy']);   // the Ivy doesn't realign
const GOR_YEARS = [8, 6, 4, 4];                            // the contract a new member signs, by tier
const DEAL_YEARS = 6, MAX_MOVES = 5, MAX_JUMP = 35;
export const revFor = val => Math.round(60 + 1500 * (clamp(val, 0, 100) / 100) ** 2.2);   // $k a member a year
const SHARE = [0.5, 0.75, 1];

export const members = (state, conf) => Object.values(state.teams).filter(t => t.conf === conf).map(t => t.name);
const confNames = state => [...new Set(Object.values(state.teams).map(t => t.conf))];
const pp3 = t => (t.pph && t.pph.length ? t.pph.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, t.pph.length) : 0);
const confLevel = (state, conf) => { const m = members(state, conf).map(n => state.teams[n].level || 0); return m.length ? m.reduce((a, b) => a + b, 0) / m.length : 0; };
export function travel(state, team, conf) {
  const T = state.teams[team], o = members(state, conf).filter(n => n !== team);
  return o.length ? Math.round(o.reduce((s, n) => s + miles(T.state, state.teams[n].state), 0) / o.length) : 0;
}
const travelCost = mi => Math.round(mi * 0.06);                     // $k a year

/** what a program earns from a league right now ($k/yr): deal × its share − travel */
export function revenueOf(state, team, conf = state.teams[team].conf, joinedNow = false) {
  const C = state.confs && state.confs[conf], T = state.teams[team];
  if (!C) return 0;
  const yrs = joinedNow ? 0 : T.joined != null ? state.year - T.joined : 9;
  return Math.round(C.deal.rev * SHARE[clamp(yrs, 0, 2)] - travelCost(travel(state, team, conf)));
}
/** the fee for leaving `team`'s league now ($k): a quarter of a year's revenue per year left on the grant of rights (max 1.5 years) */
export function exitFee(state, team) {
  const T = state.teams[team], left = T.gor ? T.gor.until - state.year : 0;
  return left > 0 ? Math.round(Math.min(1.5, left * 0.25) * (state.confs[T.conf] ? state.confs[T.conf].deal.rev : 0)) : 0;
}

// league values + tiers + media deals; every team's power percentile history
function rate(state) {
  const rng = rngFor(state, 'rate');
  const pw = power(state), order = Object.keys(pw).sort((a, b) => pw[b] - pw[a]), n = order.length;
  order.forEach((t, i) => { const T = state.teams[t]; (T.pph = T.pph || []).push(+(1 - i / Math.max(1, n - 1)).toFixed(3)); if (T.pph.length > 4) T.pph.shift(); });
  const C = confNames(state), now = {};
  const lv = C.map(c => confLevel(state, c)).sort((a, b) => a - b), pct = (arr, v) => arr.filter(x => x < v).length / Math.max(1, arr.length - 1);
  const pwm = c => { const m = members(state, c); return m.reduce((s, t) => s + state.teams[t].pph.at(-1), 0) / Math.max(1, m.length); };
  const pm = C.map(pwm).sort((a, b) => a - b);
  for (const c of C) now[c] = 100 * (0.5 * pct(lv, confLevel(state, c)) + 0.5 * pct(pm, pwm(c)));
  const S = state.confs = state.confs || {};
  for (const c of C) {
    if (!S[c]) S[c] = { val: now[c], size0: members(state, c).length, deal: { rev: revFor(now[c]), until: state.year + 1 + rng.int(DEAL_YEARS) } };
    else S[c].val = 0.8 * S[c].val + 0.2 * now[c];
    if (state.year >= S[c].deal.until) {                  // the media deal is up: repriced on what the league is now
      const old = S[c].deal.rev; S[c].deal = { rev: revFor(S[c].val), until: state.year + DEAL_YEARS, prev: old };
      if (Math.abs(S[c].deal.rev - old) >= 40 && members(state, c).includes(state.user)) news(state, `${state.year}-06-01`, 'conf', `The ${c} signed a new media deal: $${S[c].deal.rev}k a school a year (was $${old}k)`, state.user, null);
    }
  }
  for (const c of Object.keys(S)) if (!C.includes(c)) delete S[c];
  C.slice().sort((a, b) => S[b].val - S[a].val).forEach((c, i) => { S[c].tier = TIER_OF(i); S[c].rank = i + 1; });
  // first period: every program's contract + its baseline revenue (only CHANGES from here move budgets)
  for (const T of Object.values(state.teams)) {
    if (!T.gor) T.gor = { until: state.year + 1 + rng.int(GOR_YEARS[S[T.conf].tier] + 2) };
    if (T.rev0 == null) { T.rev0 = revenueOf(state, T.name); T.conf0 = T.conf; T.lv0 = confLevel(state, T.conf); }
    if (state.year >= T.gor.until) T.gor = { until: state.year + GOR_YEARS[S[T.conf].tier] };   // rolls over
  }
}

/** the offseason realignment period: rate the leagues, then the invitations (AI decides now, the user later) */
export function realignWindow(state) {
  rate(state);
  const S = state.confs, rng = rngFor(state, 'period'), U = state.user;
  const inv = [], moving = new Set(), leaving = {};
  const size = c => members(state, c).length + inv.filter(x => x.to === c).length - (leaving[c] || 0);
  for (const c of Object.keys(S).sort((a, b) => S[b].val - S[a].val)) {
    if (inv.length >= MAX_MOVES) break;
    if (CLOSED.has(c)) continue;
    const C = S[c], mem = members(state, c), med = mem.map(n => pp3(state.teams[n])).sort((a, b) => a - b)[mem.length >> 1] || 0;
    const pres = mem.reduce((a, n) => a + (state.teams[n].prestige || 30), 0) / Math.max(1, mem.length);
    // a league backfills toward the size it started at; now and then a strong league adds one more
    let slots = Math.max(0, Math.min(C.size0 || 10, MAX_SIZE) - size(c));
    if (slots && rng.chance(0.4)) slots = 0;                 // (not every league backfills the year it loses one)
    if (!slots && C.tier <= 1 && size(c) < MAX_SIZE && rng.chance(0.12)) slots = 1;
    if (!slots) continue;
    // to move up you have to be excelling: three seasons at or above the league's median member, real stature, and
    // a step up of about one tier at most
    const cands = Object.values(state.teams).filter(t => t.conf !== c && !moving.has(t.name) && !CLOSED.has(t.conf) && S[t.conf]
        && S[t.conf].val < C.val - 6 && S[t.conf].val > C.val - MAX_JUMP && (t.pph || []).length >= 3 && (t.joined == null || state.year - t.joined >= 3)
        && pp3(t) >= Math.max(0.6, med + 0.03) && (t.prestige || 30) >= pres - 20 && size(t.conf) - 1 >= MIN_SIZE)
      .map(t => ({ t, s: pp3(t) + 0.15 * (t.prestige || 30) / 100 - travel(state, t.name, c) / 4000 }))
      .sort((a, b) => b.s - a.s).slice(0, Math.min(slots, 2));
    for (const { t } of cands) {
      const x = { team: t.name, from: t.conf, to: c, fee: exitFee(state, t.name), decision: null };
      if (t.name !== U) x.decision = aiDecides(state, x, rng) ? 'accept' : 'decline';
      inv.push(x); moving.add(t.name); if (x.decision !== 'decline') leaving[t.conf] = (leaving[t.conf] || 0) + 1;
    }
  }
  state.off.invites = inv;
  for (const x of inv) if (x.decision === 'accept') news(state, `${state.year}-05-20`, 'conf', `[[${x.team}]] accepts an invitation to the ${x.to} (from the ${x.from}) — starts next season`, x.team, null);
  const mine = inv.find(x => x.team === U);
  if (mine) news(state, `${state.year}-05-15`, 'conf', `The ${mine.to} has invited [[${U}]] to join — your call`, U, null);
}
function aiDecides(state, x, rng) {
  const gain = state.confs[x.to].val - state.confs[x.from].val, revGain = Math.max(1, state.confs[x.to].deal.rev - state.confs[x.from].deal.rev);
  const p = 0.4 + gain / 60 - (x.fee > 2 * revGain ? 0.25 : 0);
  return rng.chance(clamp(p, 0.05, 0.92));
}

/** the user's answer to an invitation */
export function decide(state, accept) {
  const x = (state.off && state.off.invites || []).find(i => i.team === state.user && !i.done); if (!x) return;
  const d = accept ? 'accept' : 'decline'; if (x.decision === d) return;
  x.decision = d;                                          // (you can change your mind until the new season starts)
  news(state, `${state.year}-05-25`, 'conf', accept ? `[[${x.team}]] is leaving the ${x.from} for the ${x.to} (from next season)` : `[[${x.team}]] turned down the ${x.to} and stays in the ${x.from}`, x.team, null);
}

/** at the start of the next season: the accepted moves happen (exit fees, new contracts, phased revenue share) */
export function applyMoves(state) {
  const inv = state.off && state.off.invites || [];
  const rng = rngFor(state, 'apply');
  for (const x of inv) {
    if (x.decision == null) x.decision = x.team === state.user ? 'decline' : aiDecides(state, x, rng) ? 'accept' : 'decline';   // (a coach who changed jobs leaves it to the AD)
    if (x.decision !== 'accept' || x.done) continue;
    const T = state.teams[x.team]; if (!T || T.conf !== x.from) continue;
    x.fee = exitFee(state, x.team);
    if (x.fee > 0) T.debt = { per: Math.round(x.fee / 3), left: 3 };
    T.conf = x.to; T.joined = state.year + 1; T.gor = { until: state.year + 1 + GOR_YEARS[state.confs[x.to].tier] };
    x.done = true;
  }
}

/** each new season: a league's money and exposure, relative to where the program started (so only change counts) */
export function applyRevenue(state) {
  if (!state.confs) return;
  for (const T of Object.values(state.teams)) {
    const P = T.prog; if (!P || T.rev0 == null || !state.confs[T.conf]) continue;
    const delta = revenueOf(state, T.name) - T.rev0;
    const b = Math.round(0.5 * delta);                     // staff budget overlay (replaces last year's, never stacks)
    P.budget = Math.round(clamp(P.budget - 0.85 * (T.revB || 0) + b, 300, 3200)); T.revB = b;   // (the yearly 85/15 budget blend kept 85% of last year's)
    let dep = Math.round(0.35 * delta);                    // the collective's share
    if (T.debt && T.debt.left > 0) { dep -= T.debt.per; T.debt.left -= 1; if (!T.debt.left) T.debt = null; }
    P.nil.fund = Math.max(0, P.nil.fund + dep);
    // exposure: the league's level phases into the program's brand over ~2 seasons
    const target = confLevel(state, T.conf) - (T.lv0 ?? confLevel(state, T.conf));
    T.lvAdj = Math.round(((T.lvAdj || 0) + 0.5 * (target - (T.lvAdj || 0))) * 100) / 100;
  }
}

/** everything the user needs to weigh an invitation: money, contract, competition, travel, exposure */
export function inviteInfo(state, x) {
  const S = state.confs, U = x.team, pw = power(state);
  const rankIn = c => { const m = members(state, c).filter(n => n !== U).concat([U]); return { r: m.sort((a, b) => (pw[b] ?? 0) - (pw[a] ?? 0)).indexOf(U) + 1, n: m.length }; };
  const avgP = c => { const m = members(state, c).filter(n => n !== U); return m.reduce((s, n) => s + (state.teams[n].pph || [0.5]).at(-1), 0) / Math.max(1, m.length); };
  const now = revenueOf(state, U), full = Math.round(S[x.to].deal.rev - travelCost(travel(state, U, x.to)));
  const yr1 = Math.round(S[x.to].deal.rev * SHARE[0] - travelCost(travel(state, U, x.to)));
  const lvGain = confLevel(state, x.to) - confLevel(state, x.from);
  const info = {
    from: { conf: x.from, tier: TIERS[S[x.from].tier], rank: S[x.from].rank, rev: now, travel: travel(state, U, x.from), me: rankIn(x.from), avg: avgP(x.from), until: state.teams[U].gor.until },
    to: { conf: x.to, tier: TIERS[S[x.to].tier], rank: S[x.to].rank, rev: full, yr1, travel: travel(state, U, x.to), me: rankIn(x.to), avg: avgP(x.to), deal: S[x.to].deal.until, gor: state.year + 1 + GOR_YEARS[S[x.to].tier], members: members(state, x.to) },
    fee: exitFee(state, U),
  };
  const pro = [], con = [];
  (full > now ? pro : con).push(`${full > now ? '+' : '−'}$${Math.abs(full - now)}k a year once at a full share (staff budget + NIL collective)${full > now ? ` — $${yr1}k in year 1 (new members start at half)` : ''}`);
  if (lvGain > 1) pro.push('More exposure: a bigger brand in recruiting'); else if (lvGain < -1) con.push('Less exposure: a smaller brand in recruiting');
  if (info.to.avg > info.from.avg + 0.05) { con.push(`A tougher league — you'd rank #${info.to.me.r} of ${info.to.me.n} by power (#${info.from.me.r} of ${info.from.me.n} now): more losses, a harder auto bid`); pro.push('Better NCAA résumé: more quality wins on the table every night'); }
  else if (info.to.avg < info.from.avg - 0.05) pro.push(`An easier path to the auto bid (#${info.to.me.r} of ${info.to.me.n} by power)`);
  if (info.to.travel > info.from.travel + 250) con.push(`More travel: ${info.to.travel} miles to the average league opponent (${info.from.travel} now)`);
  else if (info.to.travel < info.from.travel - 250) pro.push(`Less travel: ${info.to.travel} miles to the average league opponent (${info.from.travel} now)`);
  if (info.fee > 0) con.push(`Exit fee: $${info.fee}k (your grant of rights runs through ${info.from.until}) — paid out of the collective over 3 seasons`);
  pro.push(`A ${info.to.gor - state.year - 1}-year grant of rights in the ${x.to} (through ${info.to.gor})`);
  return Object.assign(info, { pro, con });
}

/** the leagues a program could step up to (about one tier up), what each needs over 3 seasons, and where it stands */
export function ladder(state, team) {
  const S = state.confs, T = state.teams[team]; if (!S || !S[T.conf]) return [];
  return Object.keys(S).filter(c => c !== T.conf && !CLOSED.has(c) && S[c].val > S[T.conf].val + 6 && S[c].val < S[T.conf].val + MAX_JUMP)
    .sort((a, b) => S[a].val - S[b].val).slice(0, 4).map(c => {
      const mem = members(state, c), med = mem.map(n => pp3(state.teams[n])).sort((a, b) => a - b)[mem.length >> 1] || 0;
      return { conf: c, tier: TIERS[S[c].tier], rev: S[c].deal.rev, size: mem.length, need: Math.max(0.6, med + 0.03) };
    });
}
export const powerAvg = t => pp3(t);
