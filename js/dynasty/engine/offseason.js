// The offseason: recap -> departures (graduation, early pro entry, transfer portal entrants) -> portal
// (offers + AI placement) -> recruiting (a generated high-school class, the user's board, AI signing) ->
// development + a generated schedule -> next season. Pure: everything works on the state object; each step
// has its own seeded stream so a save replays identically.
//
// Calibrated to the snapshot: freshmen enter at a median OVR ~59 (top 1% ~77); players gain ~+5 Fr->So,
// ~+3 So->Jr, ~+1.5 after; teams lose ~3.4 upperclassmen a year; rosters carry 13 scholarships.
import { overall, attributes } from './ratings.js?v=48';
import { makeRng, hashSeed } from './rng.js?v=48';
import { record_, power, touch } from './season.js?v=48';
import { ncaaResult, postResult } from './postseason.js?v=48';
import { effOvr } from './league.js?v=48';
import { evaluateCoaches, runCarousel } from './coaching.js?v=48';
import { healAll } from './injuries.js?v=48';
import { profile, userOdds, pickSchool, notePro, factors, utility, relationship, aiSign } from './recruit.js?v=48';
import { openPortal, portalDay, PORTAL_DAYS } from './portal.js?v=48';
import { realignWindow, applyMoves, applyRevenue } from './realign.js?v=48';
import { makeSchedule } from './schedule.js?v=48';
import { runDraft } from './draft.js?v=48';
import { compactAwards } from './awards.js?v=48';
import { DIFFS, devMult, focusBonus, recruitPoints, nilRetention, nilOffer, newSeasonProgram, staminaOf, ensureStamina, openStaffMarket, closeStaffMarket } from './program.js?v=48';

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
    year: state.year, champ: N && N.champ, top: order.slice(0, 5), awards: compactAwards(state.awards),
    coach: state.teams[state.user] && state.teams[state.user].coach ? state.teams[state.user].coach.name : null,
    user: state.user && Object.assign({ team: state.user, rank: order.indexOf(state.user) + 1, post: postResult(state, state.user) || 'No postseason' }, rec),
  });
  // prestige: 65% memory, 35% this season (power percentile + a tournament bump)
  const bump = { Champion: 25, 'Runner-up': 18, 'Final Four': 14, 'Elite Eight': 9, 'Sweet 16': 6, 'Round of 32': 3, 'Round of 64': 1, 'NIT Champion': 2 };
  order.forEach((t, i) => {
    const pct = 100 * (1 - i / (order.length - 1));
    const T = state.teams[t];
    // (and 6% back toward the middle every year: without it prestige kept concentrating — sd 21.7 -> 25 — and
    // recruiting, which sorts by prestige, widened the talent spread season after season)
    T.prestige = Math.round(clamp(0.06 * 50 + 0.94 * (0.65 * T.prestige + 0.35 * Math.min(100, pct + (bump[postResult(state, t)] || 0))), 1, 100));
  });
  state.phase = 'offseason';
  state.off = { step: 'carousel', leaving: {}, portal: [], offers: {}, recruits: null, board: {}, signed: {}, log: [],
    budget: state.user ? recruitPoints(state, state.teams[state.user]) : 100 };   // the season's recruiting hours = signing-day effort
  markDepartures(state);
  runDraft(state);                  // early entrants -> a 60-pick draft (draft.js)
  realignWindow(state);             // conference realignment: league values, contracts, invitations (realign.js)
}

// who leaves: graduates (all 5th years, ~75% of 4th years), early pro entrants (elite players), portal entrants
function markDepartures(state) {
  const rng = rngFor(state, 'departures'), L = state.off.leaving;
  // early entry by LEAGUE RANK among returning (non-senior) rotation players — a steady ~60 a year, like real
  // drafts + pro contracts. (A percentile bar rose with the league, so as rosters got better fewer stars left —
  // 33 then 11 a year — and the top programs hoarded talent: the multi-season spread blew up 8.7 -> 13.5.)
  const rankOf = {};
  Object.values(state.players).filter(p => p.team && p.yr <= 4 && (p.mpg || 0) >= 8).sort((a, b) => eff(state, b) - eff(state, a)).forEach((p, i) => { rankOf[p.id] = i + 1; });
  const proP = r => !r ? 0 : r <= 25 ? 0.9 : r <= 50 ? 0.65 : r <= 90 ? 0.32 : r <= 150 ? 0.1 : 0;
  const roles = {};   // expected next-season minutes rank within each team (by OVR)
  for (const t of Object.values(state.teams)) {
    t.players.map(id => state.players[id]).filter(Boolean).sort((a, b) => eff(state, b) - eff(state, a)).forEach((p, i) => { roles[p.id] = i; });
  }
  for (const p of Object.values(state.players)) {
    if (!p.team) continue;
    const o = eff(state, p);
    if (p.yr >= 5 || (p.yr === 4 && rng.chance(0.75))) { L[p.id] = 'graduated'; continue; }
    // early entry: the best players go pro (a top-1% sophomore+ almost always, a top freshman sometimes)
    const pro = proP(rankOf[p.id]);
    if (pro && rng.chance(p.yr === 1 ? pro * 0.8 : pro)) { L[p.id] = 'pro'; notePro(state, p.team); continue; }   // the program's draft pipeline
    // portal: buried players with game transfer most; everyone has a small base rate
    const buried = roles[p.id] >= 8 && o >= 62, starved = roles[p.id] >= 6 && o >= 70;
    // the NIL collective buys off part of the temptation (a well-funded program keeps its players)
    const pp = (0.07 + (buried ? 0.35 : 0) + (starved ? 0.2 : 0) + (p.yr === 4 ? 0.25 : 0)) * (1 - nilRetention(state, state.teams[p.team]));
    if (rng.chance(pp)) L[p.id] = 'portal';
  }
}

// ── NIL retention: one of YOUR players headed for the portal names his price to stay ──
export function retainAsk(state, p) {
  const o = eff(state, p);
  return Math.round(Math.max(10, 6 * Math.exp((o - 60) / 7.5)) / 5) * 5;    // ~70 -> 25k, 78 -> 70k, 84 -> 160k, 90 -> 330k
}
export function retain(state, id) {
  const L = state.off && state.off.leaving, p = state.players[id];
  if (!L || L[id] !== 'portal' || !p || p.team !== state.user) return 'He is not entering the portal.';
  const P = state.teams[state.user].prog, ask = retainAsk(state, p);
  if (!P || P.nil.fund < ask) return `Your collective can't cover his $${ask}k ask.`;
  P.nil.fund -= ask; delete L[id]; (state.off.kept = state.off.kept || []).push({ id, name: p.name, nil: ask });
  return null;
}

// ── 2. departures take effect; portal opens ──
/** the offseason's first two steps: the head-coach carousel, then the staff market (the UI runs them one at a time;
 *  anything that skips ahead — the AI-only harnesses — gets them here) */
export function finishCarousel(state) { runCarousel(state); openStaffMarket(state); }
export function finishStaff(state) { finishCarousel(state); closeStaffMarket(state); if (state.off.step === 'carousel' || state.off.step === 'staff') state.off.step = 'departures'; }
export function processDepartures(state) {
  finishStaff(state);
  const L = state.off.leaving;
  for (const [id, why] of Object.entries(L)) {
    const p = state.players[id]; if (!p) continue;
    const t = state.teams[p.team]; if (t) t.players = t.players.filter(x => x !== id);
    if (why === 'portal') { p.from = p.team; p.team = null; state.off.portal.push(id); }
    else delete state.players[id];
  }
  state.off.portal.sort((a, b) => eff(state, state.players[b]) - eff(state, state.players[a]));
  state.off.step = 'portal';
  openPortal(state);                                     // the 10-day window (portal.js)
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
// the window is played day by day from the UI (portal.js); this closes it — any days left run without the user
export function resolvePortal(state) {
  if (state.off.pday == null) openPortal(state);
  while (state.off.pday < PORTAL_DAYS) portalDay(state);
  const U = state.user, O = state.off.offers || {};
  state.off.portalResults = (state.off.pfeed || []).filter(e => e.to && (e.to === U || O[e.id])).map(e => ({ id: e.id, name: e.name, to: e.to, from: e.from, ovr: e.ovr, nil: e.nil }));
  for (const id of state.off.portal) if (state.players[id] && !state.players[id].team) delete state.players[id];   // unsigned: out of D-I
  state.off.step = 'recruiting';
  // the class has existed all season (visits, scouting) — fall back to a fresh one for old saves
  state.off.recruits = state.rclass && state.rclass.length ? state.rclass : makeClass(state);
  state.rclass = null;
}

// ── 4. recruiting ──
const STAR_OVR = [null, [47, 54], [53, 61], [60, 68], [67, 74], [73, 80]];
export function makeClass(state, nIn) {
  const rng = rngFor(state, 'class');
  const spots = Object.keys(state.teams).reduce((s, t) => s + openSpots(state, t), 0);
  const n = nIn || spots + 300;   // enough that the last teams to sign still find D-I-level players
  // templates: real freshmen pillar profiles (position + height + shape), rescaled to each recruit's level
  const tpl = state.templates && state.templates.length ? state.templates
    : Object.values(state.players).filter(p => p.yr <= 2).map(p => ({ pos: p.pos, ht: p.ht, pillars: p.pillars }));
  const NP = state.names || { f: Object.values(state.players).map(p => p.name.split(' ')[0]), l: Object.values(state.players).map(p => p.name.split(' ').slice(1).join(' ')).filter(Boolean) };
  const firsts = NP.f, lasts = NP.l;   // the frozen pool (league.namePool), so names never thin out
  const out = [];
  for (let i = 0; i < n; i++) {
    const stars = i < 25 ? 5 : i < 125 ? 4 : i < 525 ? 3 : i < 1100 ? 2 : 1;
    const [lo, hi] = STAR_OVR[Math.max(1, stars)];
    const target = hi - (hi - lo) * rng.next() ** 1.4;
    const t = tpl[rng.int(tpl.length)];
    const r = { id: `r${state.year}-${i}`, name: `${firsts[rng.int(firsts.length)]} ${lasts[rng.int(lasts.length)]}`,
      pos: t.pos, ht: t.ht, stars, pillars: Object.assign({}, t.pillars), yr: 1,
      pot: Math.round((stars * 1.6 + 2 + rng.normal(0, 2)) * 10) / 10 };
    // BUSTS + DIAMONDS (hidden): ~9% of recruits barely grow (most painful among the stars), ~6% of 1-3 star kids
    // (2% of 4-5 stars) blossom far beyond their ranking. The scouting report doesn't know which is which.
    if (rng.chance(stars >= 4 ? 0.11 : 0.08)) { r.pot = Math.max(0, r.pot - 8 - rng.next() * 3); r.arc = 'bust'; }
    else if (rng.chance(stars <= 3 ? 0.06 : 0.02)) { r.pot = r.pot + 7 + rng.next() * 4; r.arc = 'gem'; }
    r.pot = Math.round(r.pot * 10) / 10;
    shiftTo(state, r, target, rng);
    r.sta = staminaOf(r, rng);
    // the scouting error is fixed per recruit (z ~ N(0,1) per rating); how much of it you see depends on your
    // recruiting coordinator and the effort you put on him (scoutView)
    r.z = Object.fromEntries(PIL.concat(['STA', 'POT']).map(k => [k, Math.round(rng.normal(0, 1) * 100) / 100]));
    r.scout = Math.round(ovr(state, r) + rng.normal(0, 2.5));      // the national ranking's estimate (what everyone sees)
    out.push(r);
  }
  out.sort((a, b) => b.scout - a.scout).forEach((r, i) => { r.rank = i + 1; });
  return out;
}

// ── the scouting report: what YOUR staff sees of a recruit (true ratings + his fixed error, scaled by how good your
// recruiting coordinator is and how much effort you put on him — visits and evaluations sharpen it) ──
export function scoutSD(state, effort = 0) {
  const t = state.teams[state.user], rec = t && t.prog && t.prog.staff.REC ? t.prog.staff.REC.r : 40;
  return clamp(9.5 - (rec - 30) / 10, 3, 9.5) / (1 + (effort || 0) / 20);   // high-schoolers are harder to read than transfers
}
export function scoutView(state, r, effort = 0) {
  const sd = scoutSD(state, effort), z = r.z || {};
  const pillars = Object.fromEntries(PIL.map(k => [k, clamp(Math.round(r.pillars[k] + (z[k] || 0) * sd), 1, 99)]));
  const pot = (r.pot || 0) + (z.POT || 0) * sd * 0.6;
  const grade = pot >= 12 ? 'A+' : pot >= 10.5 ? 'A' : pot >= 9 ? 'B+' : pot >= 7.5 ? 'B' : pot >= 6 ? 'C+' : pot >= 4.5 ? 'C' : pot >= 3 ? 'D' : 'F';
  const v = { pillars, ht: r.ht, pos: r.pos };
  return { pillars, sta: clamp(Math.round((r.sta ?? 50) + (z.STA || 0) * sd), 15, 95), ovr: Math.round(ovr(state, v)), grade, sd: Math.round(sd * 10) / 10, tags: tagsOf(pillars, r.ht, r.sta) };
}
// identity tags: the statistical role a set of ratings points to (players and recruits)
export function tagsOf(P, ht = 77, sta = 50) {
  const t = [];
  if (P.SHT >= 72) t.push('Sharpshooter');
  if (P.SCO >= 72) t.push('Bucket getter');
  if (P.PLY >= 70) t.push('Floor general');
  if (P.FIN >= 72) t.push(ht >= 80 ? 'Rim runner' : 'Slasher');
  if (P.REB >= 70) t.push('Glass cleaner');
  if (P.DEF >= 72) t.push(ht >= 81 ? 'Rim protector' : 'Lockdown defender');
  if (P.SEC >= 75) t.push('Steady hands');
  if (sta >= 78) t.push('Iron man');
  if (!t.length) { const k = Object.keys(P).sort((a, b) => P[b] - P[a])[0]; t.push({ SCO: 'Scorer', SHT: 'Shooter', FIN: 'Finisher', PLY: 'Passer', SEC: 'Low-mistake', REB: 'Rebounder', DEF: 'Defender' }[k] + ' (raw)'); }
  return t.slice(0, 3);
}

// the in-season class is made before anyone knows the open spots: ~3.4 per team leave a year, plus slack
export const classSize = state => Math.round(Object.keys(state.teams).length * 3.4 + 300);

// how much prestige a recruit expects: where the AI order would send him
function recruitAppeal(state, rank) {
  const pres = Object.values(state.teams).map(t => t.prestige).sort((a, b) => b - a);
  return pres[Math.min(pres.length - 1, Math.floor((rank - 1) / 4))];
}
// the user's odds: his 7-factor view of your program vs the best rival (recruit.js) + visits + difficulty
export function landOdds(state, r, effort) {
  r.appeal = recruitAppeal(state, r.rank);
  return userOdds(state, r, effort, DIFFS[state.diff || 'pro'].recruit || 0);
}

export function resolveRecruiting(state) {
  const rng = rngFor(state, 'signing'), U = state.user, B = state.off.board || {}, signed = [];
  const pool = state.off.recruits.slice();
  const take = (r, team) => {
    const p = { id: r.id, name: r.name, team, pos: r.pos, ht: r.ht, yr: 1, pillars: r.pillars, pot: r.pot, stars: r.stars, arc: r.arc || null, home: r.home || null, w: r.w || null, ask: r.ask,
      sta: r.sta, lvl: state.lvlRef || 0, mpg: 0, injured: false, fresh: true };
    state.players[p.id] = p; state.teams[team].players.push(p.id);
    pool.splice(pool.indexOf(r), 1);
  };
  // the user's board: best targets first, while spots last
  for (const r of pool.filter(r => B[r.id] > 0).sort((a, b) => a.rank - b.rank)) {
    if (!openSpots(state, U)) break;
    const won = rng.chance(landOdds(state, r, B[r.id]));
    signed.push({ id: r.id, name: r.name, stars: r.stars, rank: r.rank, won, nil: won ? (r.offer || 0) : 0 });
    if (won) { take(r, U); if (r.offer && state.teams[U].prog) state.teams[U].prog.nil.fund = Math.max(0, state.teams[U].prog.nil.fund - r.offer); }
  }
  state._aiSpend = {}; const elite = {};                    // this class's NIL promises + 4-5 star signings, per program
  // everyone else: in rank order, each recruit picks the program (with a spot) he likes most — proximity,
  // playing time, relationships, draft path, winning, brand, NIL (recruit.js). Candidates: programs at or above his
  // level (prestige within 25 of where his ranking points) plus a random handful, so a hometown school can win him.
  const pres = Object.values(state.teams).map(t => t.prestige).sort((a, b) => b - a);
  const names = Object.keys(state.teams).filter(t => t !== U);
  // in ROUNDS, like a real signing period: each program lands at most one recruit per round (a round ends when every
  // program with a spot has signed one), and within a round the recruits choose — pure rank order let the best
  // programs fill every spot before anyone else signed, and the freshman-quality gap doubled
  let round = new Set();
  for (const r of pool.slice()) {
    let open = names.filter(t => openSpots(state, t) > 0);
    if (!open.length) break;
    if (open.every(t => round.has(t))) round = new Set();
    open = open.filter(t => !round.has(t));
    const need = pres[Math.min(pres.length - 1, Math.floor((r.rank - 1) / 4))] - 40;
    // a program signs at most 3 four/five-star recruits a class (real blue bloods land a handful, not every one)
    const cands = open.filter(t => (state.teams[t].prestige >= need || rng.chance(0.06)) && !(r.stars >= 4 && (elite[t] || 0) >= 3));
    const t = pickSchool(state, r, cands.length ? cands : open, rng) || open[0];
    aiSign(state, t, r); if (r.stars >= 4) elite[t] = (elite[t] || 0) + 1; round.add(t);
    take(r, t);
    if (state._rc && state._rc.roster[t]) { const g = /C|PF/.test(r.pos || '') ? 'B' : /SF|F/.test(r.pos || '') ? 'W' : 'G'; state._rc.roster[t][g].push(r.scout || 60); state._rc.roster[t][g].sort((a, b) => b - a); }
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
    // growth tapers near the ceiling (an 85 doesn't add like a 65), so loaded rosters can't keep climbing
    const room = clamp((94 - before) / 22, 0.15, 1.15);
    const arc = p.arc === 'bust' ? 0.35 : p.arc === 'gem' ? 1.3 : 1;   // a bust stalls, a diamond in the rough takes off
    // a freshman's first summer swings more than a veteran's (high-schoolers are volatile)
    const g = (GROW[p.yr] || 0.6) * (0.55 + (p.pot || 0) / 12) * devMult(T) * room * arc + rng.normal(0, p.yr === 1 ? 3 : 1.8);   // development staff + hours
    shiftTo(state, p, before + g, rng, 0.8);
    // the season's practice focus carries into the summer
    const fb = focusBonus(T); if (fb && T.prog && T.prog.focus) for (const k of T.prog.focus) p.pillars[k] = clamp(Math.round(p.pillars[k] + fb), 1, 99);
    p.pot = Math.max(0, Math.round(((p.pot || 0) - Math.max(0, g) * 0.5) * 10) / 10);
    p.yr = Math.min(5, p.yr + 1);
    if (p.yr <= 3) p.sta = Math.min(95, (p.sta ?? 50) + 1 + rng.int(3));   // bodies mature
    if (p.team === state.user) state.off.progress[p.id] = Math.round(ovr(state, p) - before);
  }
  healAll(state);
  ensureStamina(state);
  for (const p of Object.values(state.players)) p.attr = attributes(p, state.maps);
  for (const t of Object.values(state.teams)) {
    defaultMinutes(state, t); t.minutes = null; t.starters = null;
    // scheme edges fade (staff turnover, the league adapts): system defense regresses 20% a year toward 0
    t.sysDef = Math.round((t.sysDef || 0) * 0.8 * 100) / 100;
  }
  applyMoves(state);                // accepted realignment moves take effect (exit fees, new contracts)
  newSeasonProgram(state);          // NIL payroll, staff contracts + poaching, familiarity fades, hiring pool
  state.year += 1;
  applyRevenue(state);              // league money + exposure vs where each program started
  state.schedule = makeSchedule(state, rngFor);
  state.visits = []; state.targets = []; state.rclass = makeClass(state, classSize(state));   // next year's class, recruitable all season
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

// the schedule itself is built in schedule.js (conference, events, rivalries, the user's picks, tiered fill)

