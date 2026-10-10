// The transfer portal as a live 10-day window (Oct 2026, owner: "like recruiting but much faster paced").
// Players enter after departures; each day the user can contact players and make NIL offers, and the uncommitted
// players commit with rising odds (the best ones first). Transfers are proven (true ratings, real stats), ask more
// NIL than high-schoolers, and start with almost no relationship. AI programs sign them too (<= PORTAL_CAP each).
// Pure: works on the state object.
import { makeRng, hashSeed } from './rng.js?v=50';
import { effOvr } from './league.js?v=50';
import { profile, factors, negotiate, acceptCounter } from './recruit.js?v=50';
import { admitP, admissible } from './people.js?v=50';

export const PORTAL_DAYS = 10, PORTAL_CAP = 3, CONTACTS_PER_DAY = 4;
const SCHOL = 13;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const eff = (state, p) => effOvr(p, state);
const spots = (state, t) => Math.max(0, SCHOL - state.teams[t].players.length);
const rngFor = (state, tag) => makeRng(hashSeed(`${state.seed}:${state.year}:portal:${tag}`));

// what a proven transfer asks ($k a year): 70 -> ~50k, 76 -> ~115k, 80 -> ~200k, 85 -> ~400k, 90 -> ~800k
export const transferAsk = o => Math.round(Math.max(10, 50 * Math.exp((o - 70) / 7.2)) / 5) * 5;

export function openPortal(state) {
  const O = state.off;
  O.pday = 0; O.pfeed = []; O.contacts = {}; O.took = {}; O.offers = O.offers || {};
  for (const id of O.portal) {
    const p = state.players[id]; if (!p) continue;
    const o = eff(state, p);
    p.transfer = true; p.scout = Math.round(o); p.stars = clamp(Math.round((o - 50) / 7), 1, 5);
    profile(state, p);
    if (!p.askSet) { p.ask = Math.round(transferAsk(o) * (p.w && p.w.nil >= 0.22 ? 1.3 : 1) / 5) * 5; p.askSet = true; }
  }
}

// a program's pull on a transfer: prestige, the minutes he'd get there, closeness to home, money; the user's
// relationship work and NIL offer count only for the user (AI programs carry an implied offer in their prestige)
function score(state, t, p) {
  const T = state.teams[t];
  const os = T.players.map(id => state.players[id]).filter(Boolean).map(q => eff(state, q)).sort((a, b) => b - a);
  const minutes = clamp((eff(state, p) - (os[6] ?? 50)) / 6, -1.5, 1.5);
  const f = factors(state, t, p, 0, 30);
  let s = (T.prestige || 30) / 25 + minutes + 0.8 * f.prox;
  if (t === state.user) {
    const o = state.off.offers[p.id];
    s += 0.6 + (o && o.nil ? 1.4 * Math.min(1.3, o.nil / Math.max(5, p.ask)) : 0) + ((p.relAdj || 0) / 100) * 1.6;
  } else {
    const fund = T.prog ? T.prog.nil.fund : 0; s += Math.min(1, fund / 3000) * 0.8;
  }
  if (T.conf === state.teams[p.from]?.conf) s -= 0.3;    // rarely within the league
  return s;
}
const eligible = (state, p, t) => t !== p.from && spots(state, t) > 0 && (t === state.user ? !!state.off.offers[p.id] && admitP(state, t, p, true) > 0 : (state.off.took[t] || 0) < PORTAL_CAP && admissible(state, t, p, true));   // + admissions (people.js)

// a transfer hears from a handful of serious suitors: the SUITORS AI programs that want him most (+ the user if he
// offered). He decides by a softmax over them (Gumbel noise at TAU in portalDay), so the odds shown are exactly real.
const TAU = 0.55, SUITORS = 5;
function field(state, p) {
  const ai = [];
  for (const t of Object.keys(state.teams)) if (t !== state.user && eligible(state, p, t)) ai.push([t, score(state, t, p)]);
  ai.sort((a, b) => b[1] - a[1]);
  const F = ai.slice(0, SUITORS);
  if (eligible(state, p, state.user)) F.push([state.user, score(state, state.user, p)]);
  return F;
}
const softmax = F => { const m = Math.max(...F.map(x => x[1])), e = F.map(x => Math.exp((x[1] - m) / TAU)), Z = e.reduce((a, b) => a + b, 0); return F.map((x, i) => [x[0], e[i] / Z]); };

/** who's in on him, where he's leaning, and the user's real chance if he decided today */
export function leaning(state, p) {
  const F = field(state, p); if (!F.length) return { team: null, rival: null, odds: 0, suitors: [] };
  const pr = softmax(F).sort((a, b) => b[1] - a[1]);
  const mine = pr.find(x => x[0] === state.user), rival = pr.find(x => x[0] !== state.user);
  return { team: pr[0][0], rival: rival ? rival[0] : null, odds: mine ? mine[1] : 0, suitors: pr };
}

/** the user reaches out (relationship +12, a few calls a day) */
export function contact(state, id) {
  const O = state.off, p = state.players[id]; if (!p || p.team) return 'He has already committed.';
  const today = O.contacts[O.pday] = O.contacts[O.pday] || [];
  if (today.length >= CONTACTS_PER_DAY) return `You've made your ${CONTACTS_PER_DAY} calls today.`;
  if (today.includes(id)) return 'You already called him today.';
  today.push(id); p.relAdj = Math.min(60, (p.relAdj || 0) + 12);
  return null;
}
/** an NIL offer (or a plain scholarship offer with amount 0) */
export function offer(state, id, amount) {
  const O = state.off, p = state.players[id]; if (!p || p.team) return { ok: false, msg: 'He has already committed.' };
  if (admitP(state, state.user, p, true) <= 0.02) return { ok: false, msg: `${p.name} can't be admitted at your school as a transfer.` };
  const r = (+amount || 0) > 0 ? negotiate(state, p, amount) : { ok: true, msg: `Scholarship offer sent to ${p.name}.` };
  O.offers[id] = { nil: p.nilState === 'accepted' ? p.offer : (+amount || 0) };
  return r;
}
export function takeCounter(state, id) { const p = state.players[id]; if (p) { acceptCounter(state, p); state.off.offers[id] = { nil: p.offer }; } }
export function withdraw(state, id) { delete state.off.offers[id]; }

// one day of the portal period: uncommitted players decide with rising odds (the best first)
export function portalDay(state) {
  const O = state.off; if (O.pday >= PORTAL_DAYS) return [];
  O.pday += 1;
  const rng = rngFor(state, 'day' + O.pday), U = state.user, out = [];
  const open = O.portal.map(id => state.players[id]).filter(p => p && !p.team).sort((a, b) => eff(state, b) - eff(state, a));
  const last = O.pday >= PORTAL_DAYS;
  for (const p of open) {
    const o = eff(state, p);
    const pc = last ? 1 : clamp(0.06 + 0.07 * O.pday + Math.max(0, o - 72) * 0.012, 0, 0.95);
    if (!rng.chance(pc)) continue;
    let best = null, bs = -1e9;
    for (const [t, sc] of field(state, p)) {
      const v = sc - TAU * Math.log(-Math.log(Math.max(1e-12, rng.next())));   // Gumbel: a softmax choice
      if (v > bs) { bs = v; best = t; }
    }
    if (!best || (best !== U && o < 58)) { if (last) { O.pfeed.push({ d: O.pday, name: p.name, to: null, ovr: Math.round(o) }); delete state.players[p.id]; } continue; }
    if (best === U && !rng.chance(admitP(state, U, p, true))) { delete O.offers[p.id]; O.pfeed.push({ d: O.pday, name: p.name, to: null, ovr: Math.round(o), denied: true }); continue; }   // he chose you; admissions said no
    p.team = best; state.teams[best].players.push(p.id);
    if (best !== U) O.took[best] = (O.took[best] || 0) + 1;
    else { const of = O.offers[p.id]; if (of && of.nil && state.teams[U].prog) state.teams[U].prog.nil.fund = Math.max(0, state.teams[U].prog.nil.fund - of.nil); }
    const ev = { d: O.pday, id: p.id, name: p.name, to: best, from: p.from, ovr: Math.round(o), nil: best === U && O.offers[p.id] ? O.offers[p.id].nil : 0 };
    O.pfeed.push(ev); out.push(ev);
  }
  return out;
}
export const portalOpen = state => state.off && state.off.pday != null && state.off.pday < PORTAL_DAYS;
