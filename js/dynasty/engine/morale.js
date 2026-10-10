// Player expectations (Oct 2026): every player has a DEALBREAKER — the one thing he has to have — and how well his
// program delivers it is graded 0-100 each season:
//   pt    Playing time       his minutes vs what his talent says he should play
//   nil   NIL money          what he's paid vs what he could get (a well-funded collective pays)
//   win   Winning            his team's record
//   conf  League stature     how good his conference is
//   pro   Pro path           players the program has sent to the draft lately + its prestige
// His EXPECTATION rises with how good he is (a 1-star walk-on is easy to please; a star wants more), so a breakout
// player at a small program can outgrow it — the big fish in a small pond who transfers up. A broken dealbreaker
// is the biggest single push toward the portal (markDepartures). The user can talk to his own portal-bound players
// (a few conversations each offseason). Pure: works on the state object.
import { makeRng, hashSeed } from './rng.js?v=73';
import { effOvr } from './league.js?v=73';
import { record_ } from './season.js?v=73';
import { tv } from './legacy.js?v=73';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const DB = [['pt', 'Playing time'], ['nil', 'NIL money'], ['win', 'Winning'], ['conf', 'League stature'], ['pro', 'Pro path']];
const DB_W = { pt: 38, nil: 24, win: 18, conf: 7, pro: 13 };
export const letter = g => (g >= 93 ? 'A+' : g >= 85 ? 'A' : g >= 80 ? 'A-' : g >= 76 ? 'B+' : g >= 70 ? 'B' : g >= 65 ? 'B-' : g >= 60 ? 'C+' : g >= 52 ? 'C' : g >= 45 ? 'C-' : g >= 38 ? 'D' : 'F');

export function dealbreaker(state, p) {
  if (p.db) return p.db;
  const rng = makeRng(hashSeed(`${state.seed}:db:${p.id}`)), ks = Object.keys(DB_W);
  const w = ks.map(k => DB_W[k] * (k === 'pro' && (p.stars >= 4 || effOvr(p, state) >= 80) ? 1.6 : 1) * (k === 'nil' && p.home !== 'INTL' && /G/.test(p.pos || '') ? 1.3 : 1));
  return (p.db = ks[rng.pick(w)]);
}

// league-wide context, cached per call site
function ctx(state) {
  const funds = Object.values(state.teams).map(t => (t.prog ? t.prog.nil.fund : 0)).sort((a, b) => a - b);
  const lvl = {}; for (const t of Object.values(state.teams)) (lvl[t.conf] = lvl[t.conf] || []).push((t.level || 0) + (t.lvAdj || 0));
  const confAvg = Object.fromEntries(Object.entries(lvl).map(([c, a]) => [c, a.reduce((x, y) => x + y, 0) / a.length]));
  const cs = Object.values(confAvg).sort((a, b) => a - b);
  const pct = (arr, v) => arr.filter(x => x < v).length / Math.max(1, arr.length - 1);
  const picks = {}; for (const d of state.drafts || []) if (d.y >= state.year - 4) picks[d.team] = (picks[d.team] || 0) + (d.pick <= 30 ? 1 : 0.5);
  const roleRank = {};
  for (const t of Object.values(state.teams)) t.players.map(id => state.players[id]).filter(Boolean).sort((a, b) => effOvr(b, state) - effOvr(a, state)).forEach((q, i) => { roleRank[q.id] = i; });
  return { funds, confAvg, cs, pct, picks, roleRank, rec: {} };
}
const EXP_MPG = [32, 30, 28, 26, 24, 18, 15, 12, 8, 5, 3, 2, 1, 1, 1];

/** how well his program delivers each thing (0-100) */
export function grades(state, p, C) {
  const t = state.teams[p.team]; if (!t) return null;
  C = C || ctx(state);
  // the minutes a player this good would play on an average team (a buried 75 at a stacked program feels it)
  const s = state.stats[p.id], mpg = s && s.g ? s.min / s.g : p.mpg || 0, want = clamp((effOvr(p, state) - 60) * 1.5, 4, 32);
  const r = C.rec[t.name] = C.rec[t.name] || record_(state, t.name), wp = r.w + r.l ? r.w / (r.w + r.l) : 0.5;
  return {
    pt: Math.round(clamp(25 + 75 * mpg / Math.max(6, want), 0, 100)),
    nil: Math.round(clamp(25 + 65 * C.pct(C.funds, t.prog ? t.prog.nil.fund : 0) + (p.nil ? 15 : 0), 0, 100)),
    win: Math.round(clamp(15 + 95 * wp, 0, 100)),
    conf: Math.round(clamp(20 + 80 * C.pct(C.cs, C.confAvg[t.conf]), 0, 100)),
    pro: Math.round(clamp(20 + 0.45 * (t.prestige || 30) + 12 * (C.picks[t.name] || 0), 0, 100)),
  };
}
/** what he expects (rises with talent); Player's Coach lowers it for the user's players */
export function expectation(state, p) {
  const o = effOvr(p, state);
  return clamp(48 + (o - 72) * 1.4 + (p.stars >= 4 ? 5 : 0) - (p.team === state.user ? tv(state, 'players') : 0), 30, 92);
}
/** 0..1: how badly his dealbreaker is broken */
export function violation(state, p, C) {
  const g = grades(state, p, C); if (!g) return 0;
  return clamp((expectation(state, p) - g[dealbreaker(state, p)]) / 30, 0, 1);
}
/** the roster view: dealbreaker, its grade vs his expectation, and a mood */
export function mood(state, p, C) {
  const g = grades(state, p, C); if (!g) return null;
  const k = dealbreaker(state, p), e = Math.round(expectation(state, p)), v = clamp((e - g[k]) / 30, 0, 1);
  return { k, label: DB.find(x => x[0] === k)[1], grade: g[k], exp: e, v, mood: v >= 0.6 ? 'Wants out' : v >= 0.25 ? 'Restless' : g[k] >= e + 10 ? 'Happy' : 'Content', all: g };
}
export const moodCtx = state => ctx(state);

// ── the user's conversations with players headed for the portal ──
export const talksFor = state => 2 + Math.round(tv(state, 'door'));
export function talk(state, id) {
  const O = state.off, p = state.players[id];
  if (!O || O.leaving[id] !== 'portal' || !p || p.team !== state.user) return { ok: false, msg: 'He isn\'t headed for the portal.' };
  O.talks = O.talks || { used: 0, tried: {} };
  if (O.talks.used >= talksFor(state)) return { ok: false, msg: 'You\'ve used all your conversations this offseason.' };
  if (O.talks.tried[id]) return { ok: false, msg: 'You already talked to him — his mind is made up.' };
  O.talks.used++; O.talks.tried[id] = true;
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:talk:${id}`));
  const v = violation(state, p), chance = clamp(0.38 - 0.3 * v + 0.08 * tv(state, 'door') + (p.yr >= 3 ? 0.06 : 0), 0.05, 0.85);
  if (rng.chance(chance)) { delete O.leaving[id]; O.portal = O.portal.filter(x => x !== id); return { ok: true, msg: `${p.name} is staying. Good talk.` }; }
  return { ok: false, msg: `${p.name} listened, but he's still leaving${v > 0.4 ? ` — ${DB.find(x => x[0] === dealbreaker(state, p))[1].toLowerCase()} is a dealbreaker for him` : ''}.` };
}
