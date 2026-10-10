// Facilities (Oct 2026, owner: "we need facility rankings for schools"). Every program has four, 0-100:
//   arena     — seeded from its REAL 2025-26 home attendance (data/dynasty-facilities.json, scripts/
//               build_dynasty_facilities.py) + prestige: the home crowd (home-court edge) and official visits
//   practice  — practice facility: how much a week of practice gets done
//   medical   — strength & sports medicine: injury risk
//   amen      — player amenities (locker room, lounge, housing): keeping players out of the portal
// The overall (35/25/20/20) is a recruiting draw (part of a program's brand) and the national facilities ranking.
// Everything ages a little every year; programs build (the user from the Program tab, the AI by its money), paid
// out of the NIL collective — donors give to buildings or to players, not both. Effects are centred on an average
// facility (50), so a league of average facilities plays exactly as before. Pure: works on the state object.
import { makeRng, hashSeed } from './rng.js?v=55';
import { news } from './injuries.js?v=55';

export const PARTS = [['arena', 'Arena'], ['practice', 'Practice facility'], ['medical', 'Strength & medical'], ['amen', 'Player amenities']];
const W = { arena: 0.35, practice: 0.25, medical: 0.2, amen: 0.2 };
const MID = 50;                                   // ≈ the league's average facility
// a project per part: cost ($k from the collective), rating points, seasons to build
export const PROJECTS = {
  arena: { label: 'Arena renovation', cost: 1800, gain: 14, seasons: 2 },
  practice: { label: 'New practice facility', cost: 900, gain: 16, seasons: 1 },
  medical: { label: 'Sports-science center', cost: 600, gain: 15, seasons: 1 },
  amen: { label: 'Locker room + player lounge', cost: 450, gain: 15, seasons: 1 },
};
const DECAY = { arena: 0.35, practice: 1.3, medical: 1.4, amen: 1.5 };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pctOf = (arr, v) => { let n = 0; for (const x of arr) if (x < v) n++; return n / Math.max(1, arr.length - 1); };

export const facOverall = f => (f ? Math.round(PARTS.reduce((s, [k]) => s + W[k] * f[k], 0)) : MID);

/** every program's facilities (new leagues; older saves on load). data = { team: { venue, att, max } } or null */
export function initFacilities(state, data) {
  const T = Object.values(state.teams).filter(t => !t.fac);
  if (!T.length) return;
  const rng = makeRng(hashSeed(`${state.seed}:facilities`));
  const atts = Object.values(state.teams).map(t => data && data[t.name] && data[t.name].att).filter(Boolean).map(a => Math.log(a)).sort((a, b) => a - b);
  const lv = Object.values(state.teams).map(t => t.level || 0).sort((a, b) => a - b);
  const funds = Object.values(state.teams).map(t => (t.prog ? t.prog.nil.fund : 0)).sort((a, b) => a - b);
  for (const t of T) {
    const d = data && data[t.name], P = t.prestige || 30;
    const lvP = pctOf(lv, t.level || 0), fP = pctOf(funds, t.prog ? t.prog.nil.fund : 0);
    // arena: the real crowd (75%) + the program's stature (25%)
    const crowd = d && d.att ? pctOf(atts, Math.log(d.att)) : null;
    const arena = crowd != null ? 22 + 70 * (0.75 * crowd + 0.25 * P / 100) + rng.normal(0, 3) : 25 + 0.5 * P + 10 * lvP + rng.normal(0, 8);
    const base = () => 22 + 0.38 * P + 10 * lvP + 10 * fP + rng.normal(0, 13);
    t.fac = { arena: Math.round(clamp(arena, 15, 99)), practice: Math.round(clamp(base(), 15, 99)), medical: Math.round(clamp(base(), 15, 99)), amen: Math.round(clamp(base(), 15, 99)),
      venue: d && d.venue || null, att: d && d.att || null, proj: [] };
  }
}

// ── effects (all centred on an average facility) ──
export const hcaMult = t => (t && t.fac ? clamp(1 + (t.fac.arena - MID) / 300, 0.85, 1.15) : 1);          // home-court edge
export const injuryMult = t => (t && t.fac ? clamp(1 - (t.fac.medical - MID) / 500, 0.9, 1.1) : 1);  // injury risk
export const practiceMult = t => (t && t.fac ? clamp(1 + (t.fac.practice - MID) / 700, 0.94, 1.07) : 1);
export const visitBonus = t => (t && t.fac ? (t.fac.arena - MID) / 300 : 0);                            // official-visit logit
/** portal temptation multiplier from amenities (0.9 = 10% less likely to leave) */
export function retainMult(state, t) {
  if (!t || !t.fac) return 1;
  const a = Object.values(state.teams).map(x => (x.fac ? x.fac.amen : MID)).sort((x, y) => x - y);
  return 1.1 - 0.2 * pctOf(a, t.fac.amen);
}
/** facilities percentile 0..1 (recruiting brand) */
export function facPct(state, t) {
  const o = Object.values(state.teams).map(x => facOverall(x.fac)).sort((a, b) => a - b);
  return pctOf(o, facOverall(t && t.fac));
}

/** national facilities ranking: [{ team, overall, rank, parts: {arena: {v, rank}, ...} }] */
export function facRanks(state) {
  const T = Object.values(state.teams).filter(t => t.fac);
  const rk = {};
  for (const [k] of PARTS) T.slice().sort((a, b) => b.fac[k] - a.fac[k]).forEach((t, i) => { (rk[t.name] = rk[t.name] || {})[k] = i + 1; });
  return T.map(t => ({ team: t.name, overall: facOverall(t.fac), fac: t.fac, rk: rk[t.name] })).sort((a, b) => b.overall - a.overall).map((x, i) => Object.assign(x, { rank: i + 1 }));
}

/** the user starts a project (paid now from the collective); returns an error string or null */
export function startProject(state, part) {
  const t = state.teams[state.user], P = PROJECTS[part], F = t.fac;
  if (!F || !P) return 'Unknown project.';
  if ((F.proj || []).some(x => x.part === part)) return `${P.label} is already under way.`;
  if (F[part] >= 97) return 'That facility is already the best there is.';
  const cost = projCost(state, t, part);
  if (!t.prog || t.prog.nil.fund < cost) return `Your collective has $${t.prog ? t.prog.nil.fund : 0}k — this costs $${cost}k.`;
  t.prog.nil.fund -= cost;
  (F.proj = F.proj || []).push({ part, left: P.seasons, gain: P.gain, cost });
  news(state, state.cal || `${state.year}-06-01`, 'fac', `[[${t.name}]] breaks ground: ${P.label.toLowerCase()} ($${cost}k, ready in ${P.seasons} season${P.seasons > 1 ? 's' : ''})`, t.name, null);
  return null;
}
/** a project costs more the better the facility already is (going from good to elite is expensive) */
export const projCost = (state, t, part) => Math.round(PROJECTS[part].cost * (0.7 + (t.fac[part] || 50) / 120) / 10) * 10;

/** each new season: projects finish, everything ages, AI programs build with what their collectives can spare */
export function facilitiesSeason(state) {
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:facilities`)), U = state.user;
  const funds = Object.values(state.teams).map(t => (t.prog ? t.prog.nil.fund : 0)).sort((a, b) => a - b);
  for (const t of Object.values(state.teams)) {
    const F = t.fac; if (!F) continue;
    for (const x of F.proj || []) if (--x.left <= 0) { F[x.part] = Math.min(99, F[x.part] + x.gain); if (t.name === U) news(state, `${state.year - 1}-10-01`, 'fac', `${PROJECTS[x.part].label} is open at [[${t.name}]]`, U, null); }
    F.proj = (F.proj || []).filter(x => x.left > 0);
    for (const [k] of PARTS) F[k] = Math.max(10, Math.round((F[k] - DECAY[k] + rng.normal(0, 0.6)) * 10) / 10);
    if (t.name === U || !t.prog) continue;
    // the AI builds on its weakest facility when its collective can spare it (richer programs build more often)
    const fp = pctOf(funds, t.prog.nil.fund), k = PARTS.map(([p]) => p).filter(p => !(F.proj || []).some(x => x.part === p)).sort((a, b) => F[a] - F[b])[0];
    if (!k) continue;
    const cost = projCost(state, t, k);
    if (t.prog.nil.fund > cost * 1.4 && rng.chance(0.16 + 0.4 * fp)) { t.prog.nil.fund -= cost; F.proj.push({ part: k, left: PROJECTS[k].seasons, gain: PROJECTS[k].gain, cost }); }
  }
}
