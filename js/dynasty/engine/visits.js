// Recruiting visits (Oct 2026). The next recruiting class exists all season (state.rclass, made at season start), so
// the user can scout and host it while playing:
//   • OFFICIAL visits — up to OFFICIAL_MAX per class, each tied to one of the user's upcoming HOME games. How it
//     goes depends on that night: a win, the margin, a ranked opponent, the program's prestige and a league game's
//     crowd. Every visit also gives the staff a long look at the kid (scouting error shrinks).
//   • HOME visits — the head coach in the living room, any time: a week of recruiting momentum for a smaller boost.
// What a visit earns lives on the recruit (r.vb = landing-odds logit, r.vs = scouting effort equivalent) and carries to
// signing day (offseason.landOdds adds vb; the board's scouting view adds vs). Pure: works on the state object.
import { power } from './season.js?v=60';
import { news as push } from './injuries.js?v=60';
import { visitBonus } from './facilities.js?v=60';
import { rank, tv } from './legacy.js?v=60';
import { profile, miles, factors, relationship } from './recruit.js?v=60';
import { visitInterest } from './commits.js?v=60';

export const OFFICIAL_MAX = 5;
// VISIT WEEKENDS (Oct 2026): every official visit has a FOCUS — what you show him. It pays off when it matches what
// he values AND you're strong there; it backfires when you're weak on something he cares about. Twice a season a home
// game can be a BIG WEEKEND: up to 6 recruits instead of 3, and recruits on the same weekend bond (+ per extra guest).
export const VISIT_FOCUS = [['pt', 'Meet the team', 'Playing time — the rotation he could join'], ['team', 'Game-day atmosphere', 'Winning now — the crowd and the show'],
  ['nil', 'Booster dinner', 'NIL money — meet the collective'], ['acad', 'Campus tour', 'Academics — classes, the degree'], ['draft', 'Pro development', 'Draft path — film, alumni in the pros'],
  ['prox', 'Family weekend', 'Close to home — his family comes too'], ['brand', 'Brand day', 'Brand — gear, media, the conference']];
export const BIG_MAX = 2;
export const isBig = (state, gid) => (state.bigW || []).includes(gid);
/** make a home game a big visit weekend (or undo it); returns an error string or null */
export function toggleBig(state, gid) {
  const B = state.bigW = state.bigW || [];
  if (B.includes(gid)) { if ((state.visits || []).filter(v => v.gid === gid && !v.done).length > 3) return 'Move some visits off this weekend first (a normal game hosts three).'; B.splice(B.indexOf(gid), 1); return null; }
  const g = state.schedule.find(x => x.id === gid);
  if (!g || g.r || g.h !== state.user || g.n) return 'Big weekends are upcoming home games.';
  if (B.length >= BIG_MAX) return `You get ${BIG_MAX} big weekends a season.`;
  B.push(gid); return null;
}
export function setFocus(state, rid, gid, focus) { const v = (state.visits || []).find(x => x.rid === rid && x.gid === gid && !x.done); if (v) v.focus = focus; }
/** official visits this class: 5, +1 per rank of Frequent Flyer (legacy.js) */
export const officialMax = state => OFFICIAL_MAX + rank(state, 'flyer');
/** what a visit costs in weeks of recruiting momentum: by how far he lives (EA-style location-based visits) */
export function visitCost(state, r) {
  const T = state.teams[state.user]; profile(state, r);
  const base = r.home === 'INTL' ? 2 : r.home === T.state ? 0.4 : (m => (m < 400 ? 0.7 : m < 1000 ? 1 : 1.4))(miles(r.home, T.state));
  return Math.round(base * (1 - tv(state, 'flyer')) * 10) / 10;
}
const VB_CAP = 1.2;                                    // a recruit's total visit boost (logit) is capped

export function visitsLeft(state) { return officialMax(state) - (state.visits || []).filter(v => v.type === 'official').length; }
export const visitsFor = (state, rid) => (state.visits || []).filter(v => v.rid === rid);
// targets: the recruits the staff works all season (their relationship warms every week with recruiting hours,
// program.programWeek). High-school recruiting is the long game the portal is not.
export const TARGET_MAX = 15;
export function toggleTarget(state, rid) {
  const T = state.targets = state.targets || [];
  const i = T.indexOf(rid); if (i >= 0) { T.splice(i, 1); return null; }
  if (T.length >= TARGET_MAX) return `You can work at most ${TARGET_MAX} targets at once.`;
  T.push(rid); return null;
}
export function upcomingHomeGames(state) {
  return state.schedule.filter(g => !g.r && g.h === state.user && !g.n && !g.t);
}

/** schedule an official visit for recruit `rid` at home game `gid`; returns an error string or null */
export function scheduleOfficial(state, rid, gid, focus) {
  const r = (state.rclass || []).find(x => x.id === rid); if (!r) return 'That recruit is no longer available.';
  const g = state.schedule.find(x => x.id === gid);
  if (!g || g.r || g.h !== state.user || g.n) return 'Official visits are hosted at one of your upcoming home games.';
  if (visitsFor(state, rid).some(v => v.type === 'official')) return `${r.name} already has an official visit with you.`;
  if (visitsLeft(state) <= 0) return `You've used all ${officialMax(state)} official visits for this class.`;
  const cap = isBig(state, gid) ? 6 : 3;
  if ((state.visits || []).filter(v => v.gid === gid).length >= cap) return cap === 3 ? 'A normal game hosts three recruits — make it a big weekend to host six.' : 'A big weekend hosts six recruits.';
  (state.visits = state.visits || []).push({ rid, gid, d: g.d, type: 'official', done: false, focus: focus || null });
  return null;
}
export function cancelVisit(state, rid, gid) {
  state.visits = (state.visits || []).filter(v => !(v.rid === rid && v.gid === gid && !v.done));
}

/** the head coach visits the recruit at home now: costs a week of recruiting momentum */
export function homeVisit(state, rid) {
  const r = (state.rclass || []).find(x => x.id === rid); if (!r) return 'That recruit is no longer available.';
  if (visitsFor(state, rid).some(v => v.type === 'home')) return `You've already been to ${r.name}'s home.`;
  const P = state.teams[state.user].prog;
  // two summer evaluation-period visits are free each season; after that each costs a week of recruiting momentum
  const c = visitCost(state, r);
  if (P && (P.hvFree ?? 2) > 0) P.hvFree = (P.hvFree ?? 2) - 1;
  else if (!P || P.acc.recruiting < c) return `No free home visits left — this trip costs ${c} week${c === 1 ? '' : 's'} of recruiting momentum and you have ${P ? P.acc.recruiting.toFixed(1) : 0}.`;
  else P.acc.recruiting -= c;
  const gain = 0.22 + (state.teams[state.user].prestige || 30) / 100 * 0.1;
  r.vb = Math.min(VB_CAP, (r.vb || 0) + gain); r.vs = (r.vs || 0) + 20;
  (state.visits = state.visits || []).push({ rid, type: 'home', d: null, done: true, res: 'good', gain: +gain.toFixed(2) });
  news(state, `${r.stars}★ ${r.name} hosted the head coach at home`, r);
  return null;
}

/** after a user home game is recorded: every official visit at that game resolves from what happened */
export function resolveVisits(state, g) {
  const V = (state.visits || []).filter(v => v.gid === g.id && !v.done); if (!V.length) return;
  const won = g.r[0] > g.r[1], margin = g.r[0] - g.r[1];
  const pw = power(state), order = Object.keys(pw).sort((a, b) => pw[b] - pw[a]);
  const ranked = order.indexOf(g.a) >= 0 && order.indexOf(g.a) < 25;
  const pres = (state.teams[state.user].prestige || 30) / 100;
  const rival = (state.rivals || []).some(([a, b]) => (a === g.h && b === g.a) || (a === g.a && b === g.h));
  const big = isBig(state, g.id), n = V.length;
  for (const v of V) {
    const r = (state.rclass || []).find(x => x.id === v.rid); v.done = true; if (!r) continue;
    profile(state, r);
    // the night, part by part — kept on the visit so the board can say why it went the way it did
    const parts = [['The program', 0.3 + pres * 0.25], ['Arena & crowd', visitBonus(state.teams[state.user]) + (big ? 0.05 : 0)],
      [won ? `The win (${g.r[0]}-${g.r[1]})` : `The loss (${g.r[0]}-${g.r[1]})`, (won ? 0.25 : -0.12) + (won && margin >= 15 ? 0.1 : 0)]];
    if (ranked) parts.push([won ? 'Beat a ranked team' : 'Ranked opponent', won ? 0.25 : 0.05]);
    if (rival) parts.push(['Rivalry game', won ? 0.15 : 0.03]);
    if (g.c) parts.push(['League game', 0.05]);
    if (big && n > 1) parts.push([`Big weekend · ${n - 1} other recruit${n === 2 ? '' : 's'}`, Math.min(0.3, 0.08 * (n - 1))]);
    if (v.focus) {
      const f = factors(state, state.user, r, r.offer || 0, relationship(state, r, 0))[v.focus], care = Math.min(2.2, (r.w[v.focus] || 0) / 0.125);
      const fg = 0.35 * care * (f - 0.5) * 2, lab = (VISIT_FOCUS.find(x => x[0] === v.focus) || [0, 'Focus'])[1];
      parts.push([`${lab} (${care >= 1.3 ? 'he cares a lot' : care >= 0.8 ? 'he cares' : 'not his priority'})`, fg]);
    }
    let gain = parts.reduce((t, x) => t + x[1], 0);
    gain = Math.round(gain * 100) / 100;
    v.parts = parts.map(([l, x]) => [l, Math.round(x * 100) / 100]);
    r.vb = Math.max(-0.4, Math.min(VB_CAP, (r.vb || 0) + gain)); r.vs = (r.vs || 0) + 35;
    visitInterest(state, r, gain);   // the recruiting race: a great visit is worth a lot of interest (commits.js)
    const P = state.teams[state.user].prog; if (P) P.acc.recruiting = Math.max(0, P.acc.recruiting - visitCost(state, r) * 0.5);   // flying him in (half a home visit's time)
    v.res = gain >= 0.6 ? 'great' : gain >= 0.3 ? 'good' : gain > 0 ? 'meh' : 'bad'; v.gain = gain;
    const how = { great: 'left raving about the atmosphere', good: 'enjoyed the visit', meh: 'came away lukewarm', bad: 'left unimpressed' }[v.res];
    news(state, `${r.stars}★ ${r.name} ${how} (${won ? 'W' : 'L'} ${g.r[0]}-${g.r[1]} vs [[${g.a}]])`, r, g.d);
  }
}
function news(state, t, r, d) { push(state, d || state.cal || '', 'recruit', t, state.user, null); }
