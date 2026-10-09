// Running a program (Oct 2026, owner design): difficulty, the coaching staff, the head coach's weekly hours, season
// practice goals (two focus pillars + an offensive and a defensive scheme), scheme familiarity that grows the
// longer a group runs a scheme, and the NIL collective. Every team runs on these rules (the AI with sensible
// defaults), so the league stays balanced; the user makes the calls. Pure: works on the state object.
//
//   state.diff = 'rookie' | 'pro' | 'aa' | 'hof'
//   team.prog  = { staff:{OC,DC,REC,DEV,GM}, budget, hours:{practice,recruiting,nil,development}, focus:[p1,p2],
//                  off, def (scheme keys), nil:{fund, wk}, acc:{practice,recruiting,nil,development, weeks} }
//   player.fam = { o:{scheme: 0-100}, d:{scheme: 0-100} }   — familiarity follows the player (transfers keep it)
import { makeRng, hashSeed } from './rng.js?v=48';
import { attributes } from './ratings.js?v=48';
import { news } from './injuries.js?v=48';

export const DIFFS = {
  rookie: { label: 'Rookie', blurb: 'Your staff handles what you leave alone, recruits like you, boosters are patient and the job is safe.', recruit: 0.6, jobK: 0.5, nilK: 1.25, need: 0.85, aiPlan: 0.6, scandal: 0 },
  pro:    { label: 'Pro', blurb: 'The real thing: every program plays by the same rules.', recruit: 0, jobK: 1, nilK: 1, need: 1, aiPlan: 0.85, scandal: 0.5 },
  aa:     { label: 'All-American', blurb: 'Recruits are harder to land, boosters expect results and the AI coaches run their best schemes.', recruit: -0.4, jobK: 1.25, nilK: 0.9, need: 1.1, aiPlan: 1, scandal: 1 },
  hof:    { label: 'Hall of Fame', blurb: 'As hard as it gets: every hour matters, recruits and boosters are demanding, a bad year can cost you the job.', recruit: -0.8, jobK: 1.6, nilK: 0.8, need: 1.25, aiPlan: 1, scandal: 1.6 },
};
export const HOURS = 60;                                   // the head coach's week
export const AREAS = [['practice', 'Practice'], ['recruiting', 'Recruiting'], ['nil', 'NIL & boosters'], ['development', 'Player development']];
export const ROLES = [['OC', 'Offensive coordinator', 'practice'], ['DC', 'Defensive coordinator', 'practice'], ['REC', 'Recruiting coordinator', 'recruiting'],
  ['DEV', 'Player development coach', 'development'], ['GM', 'General manager (NIL)', 'nil']];
// hours-equivalent per area that make an AVERAGE program (default hours + an average staff = 1.0)
const AREA_NEED = { practice: 24, recruiting: 19, nil: 13, development: 17 };

export const OFF = {
  motion: { label: 'Motion', blurb: 'Ball and player movement, read-and-react. Needs passers and shooters.', need: { PLY: 0.35, SHT: 0.25, SEC: 0.2, SCO: 0.2 }, tempo: 0, r3: 0 },
  pace:   { label: 'Pace & Space', blurb: 'Run, spread the floor, live at the three-point line.', need: { SHT: 0.45, SCO: 0.25, PLY: 0.15, SEC: 0.15 }, tempo: 0.05, r3: 0.14 },
  pnr:    { label: 'Pick & Roll', blurb: 'Ball-screen offense built around a creator and a roll man.', need: { PLY: 0.4, FIN: 0.35, SHT: 0.25 }, tempo: 0, r3: 0.04 },
  post:   { label: 'Inside-Out', blurb: 'Through the post first: paint touches, kick-outs, second chances.', need: { FIN: 0.45, REB: 0.35, SCO: 0.2 }, tempo: -0.02, r3: -0.12 },
  grind:  { label: 'Grind', blurb: 'Slow, low-turnover half-court basketball.', need: { SEC: 0.4, REB: 0.3, FIN: 0.3 }, tempo: -0.06, r3: -0.05 },
};
export const DEF = {
  pack:   { label: 'Pack-Line Man', blurb: 'Sag into the lane, take away drives, finish possessions with a rebound.', need: { DEF: 0.5, REB: 0.3, SEC: 0.2 }, press: 0, tempo: 0 },
  press:  { label: 'Full-Court Pressure', blurb: 'Press and trap for turnovers; gives up some easy looks and fouls.', need: { DEF: 0.55, SCO: 0.15, SEC: 0.3 }, press: 1, tempo: 0.04 },
  zone:   { label: '2-3 Zone', blurb: 'Protect the paint with length; concedes threes.', need: { REB: 0.4, DEF: 0.45, FIN: 0.15 }, press: 0, tempo: -0.01 },
  switch: { label: 'Switch Everything', blurb: 'Versatile defenders switch every screen.', need: { DEF: 0.6, SHT: 0.2, PLY: 0.2 }, press: 0, tempo: 0 },
};
export const PIL_LABEL = { SCO: 'Scoring', SHT: 'Shooting', FIN: 'Finishing', PLY: 'Playmaking', SEC: 'Ball security', REB: 'Rebounding', DEF: 'Defense' };
export const FOCUS_LABEL = Object.assign({}, PIL_LABEL, { STA: 'Conditioning' });   // practice focus options (STA = stamina)

// STAMINA (owner, Oct 2026: wear depends on the position and the player): 15-95. Guards carry more than bigs, height
// costs a little, a player who really logged 33+ minutes a night proved it, plus a personal component. A player
// starts to wear down past 28 + sta/9 minutes a night (sta 25 -> ~31, 50 -> ~34, 80 -> ~37, 95 -> ~38.5).
export const tireAt = p => 28 + (p.sta ?? 50) / 9;
export function staminaOf(p, rng) {
  const g = /C|PF/.test(p.pos || '') ? 44 : /SF|F/.test(p.pos || '') ? 52 : 58;
  const real = (p.mpg || 0) >= 33 ? 12 : (p.mpg || 0) >= 30 ? 6 : 0;
  return Math.round(clamp(g - ((p.ht || 77) - 77) * 1.3 + real + rng.normal(0, 10), 15, 95));
}
export function ensureStamina(state) {
  const rng = rngFor(state, 'stamina');
  for (const p of Object.values(state.players)) if (p.sta == null) p.sta = staminaOf(p, rng);
  if (state.ext) for (const p of Object.values(state.ext.players)) if (p.sta == null) p.sta = staminaOf(p, rng);
}

// effect sizes (logit on makes per unit, DRtg points per unit) — modest by design: a great fit run by a group that
// knows it is worth ~2-3 points per 100 possessions; a brand-new scheme the roster doesn't fit costs about that
const K = { OFIT: 0.045, OFAM: 0.035, DFIT: 1.6, DFAM: 1.2, FATIGUE: 0.004, FOCUS_WK: 0.06, FAM_WK: 0.9, FAM_GAME: 0.45, FAM_KEEP: 0.85, FAM_NEW: 15 };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rngFor = (state, tag) => makeRng(hashSeed(`${state.seed}:${state.year}:prog:${tag}`));

// ── staff ──
const FIRST = ['Mike', 'Chris', 'Tony', 'Ryan', 'Kevin', 'Brian', 'Jason', 'Matt', 'Derek', 'Marcus', 'Andre', 'Josh', 'Tim', 'Greg', 'Darius', 'Sean', 'Luke', 'Eric', 'Will', 'Jamal'];
const LAST = ['Johnson', 'Miller', 'Davis', 'Brooks', 'Carter', 'Hayes', 'Foster', 'Reed', 'Bennett', 'Coleman', 'Walsh', 'Porter', 'Dixon', 'Hughes', 'Sullivan', 'Price', 'Ward', 'Grant', 'Pierce', 'Lane'];
export const payFor = r => Math.round(40 + (r * r) / 22);                 // $k a year: a 50 earns ~150k, an 85 ~370k
function staffer(rng, role, mean, age) {
  const r = Math.round(clamp(mean + rng.normal(0, 9), 25, 95));
  return { role, name: `${FIRST[rng.int(FIRST.length)]} ${LAST[rng.int(LAST.length)]}`, r, pay: payFor(r), yrs: 1 + rng.int(4), age: age || 30 + rng.int(30), id: `s${rng.int(1e9).toString(36)}` };
}
// every program starts somewhere different: budget + staff quality from prestige and league, with noise
function budgetFor(t, rng) { return Math.round(clamp(500 + (t.prestige || 30) * 14 + (t.level || 0) * 25 + rng.normal(0, 120), 380, 2400)); }

// ── hours: what each area actually gets (head coach hours + staff coverage), 1.0 = an average program ──
export function cover(prog, area) {
  let h = 0;
  for (const [k, , a] of ROLES) if (a === area && prog.staff[k]) h += Math.max(0, (prog.staff[k].r - 30) / 70) * (area === 'practice' ? 7 : 12);
  return h;
}
export function effort(state, team, area) {
  const P = team.prog, d = DIFFS[state.diff || 'pro'], me = team.name === state.user;
  return clamp((P.hours[area] * (me ? 1 : coachMult(team, area)) + cover(P, area)) / (AREA_NEED[area] * (me ? d.need : 1)), 0, 2.2);   // an AI head coach's quality (coaching.js)
}
// (mirrors coaching.coachMult without the import cycle: coaching.js imports this module)
function coachMult(team, area) {
  const c = team.coach; if (!c || c.user || c.r == null) return 1;
  const sub = area === 'practice' ? (c.off + c.def) / 2 : area === 'recruiting' ? c.rec : area === 'development' ? c.dev : c.r;
  return clamp(1 + (sub - (48 + (team.prestige || 30) * 0.35)) / 120, 0.82, 1.22);
}
const defaultHours = () => ({ practice: 20, recruiting: 16, nil: 10, development: 14 });

// ── schemes: roster fit (minutes-weighted pillar match, 0 = average) and familiarity (0-100) ──
export function fitOf(state, team, side, key) {
  const S = (side === 'o' ? OFF : DEF)[key]; if (!S) return 0;
  let w = 0, s = 0;
  for (const id of team.players) {
    const p = state.players[id] || (state.ext && state.ext.players[id]); if (!p || !p.mpg) continue;
    let v = 0; for (const [k, c] of Object.entries(S.need)) v += c * ((p.pillars[k] ?? 50) - 50) / 15;
    s += v * p.mpg; w += p.mpg;
  }
  return w ? s / w : 0;
}
export function famOf(state, team, side, key) {
  let w = 0, s = 0;
  for (const id of team.players) {
    const p = state.players[id]; if (!p || !p.mpg) continue;
    s += ((p.fam && p.fam[side] && p.fam[side][key]) || 0) * p.mpg; w += p.mpg;
  }
  return w ? s / w : 0;
}
const bestScheme = (state, team, side) => Object.keys(side === 'o' ? OFF : DEF).map(k => [k, fitOf(state, team, side, k)]).sort((a, b) => b[1] - a[1])[0][0];

// ── init: every team, at dynasty start (and old saves on load) ──
export function initProgram(state, diff) {
  state.diff = DIFFS[diff] ? diff : (state.diff || 'pro');
  const rng = rngFor(state, 'init');
  for (const t of Object.values(state.teams)) {
    if (t.prog) continue;
    const mean = 38 + (t.prestige || 30) * 0.42;          // blue bloods hire better
    const staff = Object.fromEntries(ROLES.map(([k]) => [k, staffer(rng, k, mean)]));
    const budget = budgetFor(t, rng);
    let pay = Object.values(staff).reduce((s, x) => s + x.pay, 0);
    while (pay > budget) { const k = ROLES[rng.int(ROLES.length)][0]; if (staff[k].r <= 28) break; staff[k].r -= 2; staff[k].pay = payFor(staff[k].r); pay = Object.values(staff).reduce((s, x) => s + x.pay, 0); }
    t.prog = { staff, budget, hours: defaultHours(), focus: null, off: null, def: null,
      nil: { fund: Math.round(clamp(150 + (t.prestige || 30) * 18 + (t.level || 0) * 30 + rng.normal(0, 150), 50, 3500)), wk: 0, hist: [] },
      acc: { practice: 0, recruiting: 0, nil: 0, development: 0, weeks: 0 } };
    t.prog.off = bestScheme(state, t, 'o'); t.prog.def = bestScheme(state, t, 'd');
    t.prog.focus = autoFocus(state, t);
    // returning players already know their program's schemes; newcomers don't
    for (const id of t.players) {
      const p = state.players[id]; if (!p) continue;
      p.fam = p.fam || { o: {}, d: {} };
      const known = p.fresh || p.yr === 1 ? K.FAM_NEW : clamp(45 + rng.normal(10, 12), 20, 85);
      p.fam.o[t.prog.off] = Math.max(p.fam.o[t.prog.off] || 0, Math.round(known));
      p.fam.d[t.prog.def] = Math.max(p.fam.d[t.prog.def] || 0, Math.round(known));
    }
  }
}
// the AI (and Rookie auto-coach) works on the roster's two weakest rotation pillars
function autoFocus(state, t) {
  const tot = {}; let w = 0;
  for (const id of t.players) { const p = state.players[id]; if (!p || !p.mpg) continue; for (const k in PIL_LABEL) tot[k] = (tot[k] || 0) + p.pillars[k] * p.mpg; w += p.mpg; }
  return Object.keys(PIL_LABEL).sort((a, b) => tot[a] - tot[b]).slice(0, 2);
}

// ── the sim: scheme fit x familiarity -> prepared-team adjustments (called from season.prepared) ──
export function schemeMods(state, team, prep, C) {
  const P = team.prog; if (!P || !prep || state.noProg) return prep;
  const ofit = fitOf(state, team, 'o', P.off), dfit = fitOf(state, team, 'd', P.def);
  const ofam = famOf(state, team, 'o', P.off), dfam = famOf(state, team, 'd', P.def);
  const amp = f => 0.4 + 0.6 * f / 100;                  // familiarity unlocks the fit
  const O = OFF[P.off] || OFF.motion, D = DEF[P.def] || DEF.pack;
  prep.shotQ += K.OFIT * ofit * amp(ofam) + K.OFAM * (ofam - 50) / 50;
  prep.sysDef += K.DFIT * dfit * amp(dfam) + K.DFAM * (dfam - 50) / 50;
  prep.tempo *= 1 + O.tempo + D.tempo;
  prep.r3m *= 1 + O.r3;
  prep.press += D.press;
  // minutes matter, player by player: each one wears down past his own stamina threshold (possession.js reads .fat)
  for (const e of prep.roster) { const p = state.players[e.id]; e.fat = p ? Math.max(0, e.target - tireAt(p)) : 0; }
  prep.scheme = { ofit, dfit, ofam, dfam };
  return prep;
}

// ── the week: hours turn into familiarity, focus growth, recruiting points, NIL money (every team) ──
export function programWeek(state, weeks = 1) {
  if (state.noProg) return;
  const d = DIFFS[state.diff || 'pro'];
  for (const t of Object.values(state.teams)) {
    const P = t.prog; if (!P) continue;
    P.hours = P.hours || defaultHours();
    const E = Object.fromEntries(AREAS.map(([a]) => [a, effort(state, t, a)]));
    for (const a in E) P.acc[a] += E[a] * weeks;
    P.acc.weeks += weeks;
    for (const id of t.players) {
      const p = state.players[id]; if (!p) continue;
      p.fam = p.fam || { o: {}, d: {} };
      const g = K.FAM_WK * E.practice * weeks;
      p.fam.o[P.off] = clamp((p.fam.o[P.off] || 0) + g, 0, 100);
      p.fam.d[P.def] = clamp((p.fam.d[P.def] || 0) + g, 0, 100);
      // in-season focus growth: practice time on two pillars, more for young players who play
      // (pillars stay whole numbers: growth banks in p.gx until it reaches a point)
      const young = p.yr <= 2 ? 1.3 : p.yr === 3 ? 1 : 0.7, play = 0.5 + Math.min(1, (p.mpg || 0) / 25);
      let moved = false;
      for (const k of P.focus || []) {
        p.gx = p.gx || {}; p.gx[k] = (p.gx[k] || 0) + K.FOCUS_WK * E.practice * young * play * weeks * (k === 'STA' ? 2 : 1);
        if (k === 'STA') { while (p.gx[k] >= 1 && (p.sta ?? 50) < 95) { p.sta = (p.sta ?? 50) + 1; p.gx[k] -= 1; } continue; }   // conditioning
        while (p.gx[k] >= 1 && p.pillars[k] < 99) { p.pillars[k] += 1; p.gx[k] -= 1; moved = true; }
      }
      if (moved) p.attr = attributes(p, state.maps);
    }
    // NIL collective: boosters respond to engagement (hours + GM), prestige and winning
    const wp = winPct(state, t.name);
    const inc = (10 + 26 * E.nil + (t.prestige || 30) * 0.35 + (wp - 0.5) * 40) * (t.name === state.user ? d.nilK : 1) * weeks;
    P.nil.wk = Math.round(inc); P.nil.fund = Math.max(0, Math.round(P.nil.fund + inc));
    // high-school recruiting is a long game: the user's targets warm up every week with the recruiting effort
    if (t.name === state.user) for (const id of state.targets || []) { const r = (state.rclass || []).find(x => x.id === id); if (r) r.relAdj = Math.min(70, (r.relAdj || 0) + 1.1 * E.recruiting * weeks); }
  }
}
function winPct(state, team) {
  let w = 0, n = 0; for (const g of state.schedule) { if (!g.r || (g.h !== team && g.a !== team)) continue; n++; if ((g.h === team) === (g.r[0] > g.r[1])) w++; }
  return n ? w / n : 0.5;
}
// games played in a scheme teach it too (called after every game for both teams)
export function programGame(state, g, sim) {
  for (const [rows, team] of [[sim.box.home, g.h], [sim.box.away, g.a]]) {
    const t = state.teams[team]; if (!t || !t.prog) continue;
    for (const r of rows) {
      const p = state.players[r.id]; if (!p || !(r.min > 0)) continue;
      p.fam = p.fam || { o: {}, d: {} };
      const g2 = K.FAM_GAME * r.min / 30;
      p.fam.o[t.prog.off] = clamp((p.fam.o[t.prog.off] || 0) + g2, 0, 100);
      p.fam.d[t.prog.def] = clamp((p.fam.d[t.prog.def] || 0) + g2, 0, 100);
    }
  }
}

// ── offseason hooks ──
// development multiplier from the season's development effort (dev coach + hours): 0.8 - 1.3
export const devMult = t => !t || t.noProg || !t.prog || !t.prog.acc.weeks ? 1 : clamp(0.65 + 0.35 * t.prog.acc.development / t.prog.acc.weeks, 0.8, 1.3);
// the season's practice on the focus pillars carries into the summer
export const focusBonus = t => !t || !t.prog || !t.prog.acc.weeks ? 0 : clamp(1.2 * t.prog.acc.practice / t.prog.acc.weeks, 0, 2.4);
// recruiting effort points for signing day (the board budget): 40 minimum, ~100 for an average season
export const recruitPoints = (state, t) => !t || !t.prog || !t.prog.acc.weeks ? 100 : Math.round(clamp(100 * t.prog.acc.recruiting / t.prog.acc.weeks, 40, 190));
// NIL: what the collective can pay keeps players from the portal and sweetens offers
export function nilRetention(state, t) {
  if (!t || !t.prog) return 0;
  const funds = Object.values(state.teams).map(x => x.prog ? x.prog.nil.fund : 0).sort((a, b) => a - b);
  const pct = funds.findIndex(f => f >= t.prog.nil.fund) / Math.max(1, funds.length - 1);
  return clamp(0.15 + 0.45 * pct, 0, 0.6);                // share of portal temptation the collective buys off
}
export function nilOffer(state, t) {
  if (!t || !t.prog) return 0;
  const funds = Object.values(state.teams).map(x => x.prog ? x.prog.nil.fund : 0).sort((a, b) => a - b);
  const pct = funds.findIndex(f => f >= t.prog.nil.fund) / Math.max(1, funds.length - 1);
  return (pct - 0.5) * 1.2;                                // logit on landing a recruit / transfer
}
export function newSeasonProgram(state) {
  const rng = rngFor(state, 'season');
  const d = DIFFS[state.diff || 'pro'];
  for (const t of Object.values(state.teams)) {
    const P = t.prog; if (!P) continue;
    // NIL: the roster's deals are paid from the fund (~half); a scandal can hit any program (more often on harder levels)
    P.nil.hist.push({ y: state.year - 1, fund: P.nil.fund });
    if (P.nil.hist.length > 6) P.nil.hist.shift();
    P.nil.fund = Math.round(P.nil.fund * 0.5);
    if (rng.chance(0.03 * d.scandal) && t.name === state.user) { P.nil.fund = Math.round(P.nil.fund * 0.6); news(state, `${state.year - 1}-08-01`, 'nil', `A booster dispute cost [[${t.name}]]'s collective 40% of its fund`, t.name, null); }
    P.acc = { practice: 0, recruiting: 0, nil: 0, development: 0, weeks: 0 };
    P.hvFree = 2;                                          // summer home visits (visits.js)
    // (staff contracts, departures and hiring happen in the offseason staff market: openStaffMarket / closeStaffMarket)
    if (t.name !== state.user) for (const [k] of ROLES) if (!P.staff[k]) P.staff[k] = staffer(rng, k, 38 + (t.prestige || 30) * 0.42);
    P.budget = Math.round(clamp(P.budget * 0.85 + budgetFor(t, rng) * 0.15, 380, 2600));
    if (t.name !== state.user || state.diff === 'rookie') { P.off = bestScheme(state, t, 'o'); P.def = bestScheme(state, t, 'd'); P.focus = autoFocus(state, t); }
  }
  // familiarity fades over a summer; newcomers start from scratch in the new program's schemes
  for (const p of Object.values(state.players)) {
    if (!p.fam) continue;
    for (const side of ['o', 'd']) for (const k in p.fam[side]) p.fam[side][k] = Math.round(p.fam[side][k] * K.FAM_KEEP);
  }
  if (!state.staffPool || !state.staffPool.length) state.staffPool = hiringPool(state);
}
export function hiringPool(state) {
  const rng = rngFor(state, 'pool'), pool = [];
  for (const [k] of ROLES) for (let i = 0; i < 6; i++) { const s = staffer(rng, k, 35 + i * 9); s.id = `${k}-${state.year}-${i}`; pool.push(s); }
  return pool;
}
export const payroll = P => ROLES.reduce((s, [k]) => s + (P.staff[k] ? P.staff[k].pay : 0), 0);

// ── the offseason staff market (Oct 2026): after the head-coach carousel, every staff gets a year older (young
// assistants grow, old ones fade and retire), contracts tick down — the AI keeps most of its people, the rest hit the
// market with the user's expired deals, fired head coaches (as coordinators in their best area) and young
// up-and-comers. The user hires first (offers: salary + years; they accept, counter or pass) and can poach another
// program's assistant with a raise; then every AI program fills its empty seats, best job first. ──
const ROLE_OF = { off: 'OC', def: 'DC', rec: 'REC', dev: 'DEV' };
const ageStaff = (s, rng) => { s.age = (s.age || 45) + 1; const d = s.age < 38 ? 1.2 : s.age < 48 ? 0.2 : s.age < 58 ? -0.5 : -1.5; s.r = Math.round(clamp(s.r + d + rng.normal(0, 1.5), 25, 95)); };
export function openStaffMarket(state) {
  if (state.staffMarket && state.staffMarket.year === state.year) return;
  const rng = rngFor(state, 'market'), U = state.user, pool = [], d = `${state.year}-04-20`;
  for (const t of Object.values(state.teams)) {
    const P = t.prog; if (!P) continue;
    for (const [k] of ROLES) {
      const s = P.staff[k]; if (!s) continue;
      ageStaff(s, rng); s.yrs -= 1; s.id = s.id || `s${rng.int(1e9).toString(36)}`; s.age = s.age || 45;
      if (s.age >= 66 && rng.chance(0.4)) { P.staff[k] = null; if (t.name === U) news(state, d, 'staff', `${s.name} retired from your staff`, U, null); continue; }
      if (s.yrs > 0) continue;
      if (t.name !== U && rng.chance(0.65) && payroll(P) <= P.budget) { s.yrs = 1 + rng.int(3); s.pay = payFor(s.r); continue; }   // re-signed
      P.staff[k] = null;
      pool.push(Object.assign(s, { from: t.name, mine: t.name === U }));
      if (t.name === U) news(state, d, 'staff', `${s.name}'s contract is up — he's on the market (you can re-sign him first)`, U, null);
    }
  }
  // fired head coaches, as coordinators in their best area
  for (const c of state.coachPool || []) {
    if (rng.chance(0.5)) continue;
    const best = ['off', 'def', 'rec', 'dev'].sort((a, b) => (c[b] || 0) - (c[a] || 0))[0], r = Math.round(clamp((c[best] || c.r || 60) - 3, 30, 92));
    pool.push({ role: ROLE_OF[best], name: c.name, r, pay: payFor(r), yrs: 2, age: c.age || 55, id: `s${rng.int(1e9).toString(36)}`, exHC: true, cid: c.id });
  }
  // young up-and-comers (cheaper, still growing)
  for (const [k] of ROLES) for (let i = 0; i < 5; i++) { const s = staffer(rng, k, 40 + i * 6, 27 + rng.int(9)); s.young = true; pool.push(s); }
  for (const s of pool) { s.ask = Math.round(payFor(s.r) * (s.exHC ? 1.15 : s.young ? 0.9 : 1) * (1 + rng.next() * 0.15)); s.pay = s.ask; }
  state.staffMarket = { year: state.year, pool, log: [], open: true };
}
/** what a candidate wants from the user's program: his ask, more from a smaller program if he's good */
export function staffAsk(state, s) {
  const pr = state.teams[state.user].prestige || 30, want = s.r >= 80 ? 60 : s.r >= 70 ? 45 : 0;
  return Math.round((s.mine ? s.ask * 0.92 : s.ask) * (pr < want ? 1 + (want - pr) / 60 : 1));
}
/** the user offers a market candidate `pay` ($k) for `yrs` years */
export function offerStaff(state, id, pay, yrs) {
  const M = state.staffMarket, P = state.teams[state.user].prog; if (!M || !M.open) return { ok: false, msg: 'The staff market is closed until the offseason.' };
  const s = M.pool.find(x => x.id === id); if (!s) return { ok: false, msg: 'He has already taken another job.' };
  pay = Math.round(+pay || 0); yrs = clamp(Math.round(+yrs || 2), 1, 5);
  const cur = P.staff[s.role];
  if (payroll(P) - (cur ? cur.pay : 0) + pay > P.budget) return { ok: false, msg: `That puts you over your staff budget ($${P.budget}k).` };
  const ask = staffAsk(state, s) * (yrs >= 4 ? 0.95 : 1);
  if (pay < ask * 0.85) return { ok: false, msg: `${s.name} passes — he's looking for about $${Math.round(ask)}k.` };
  if (pay < ask) return { ok: false, counter: Math.round(ask), msg: `${s.name} counters at $${Math.round(ask)}k.` };
  if (cur) { cur.yrs = 0; M.pool.push(Object.assign(cur, { ask: cur.pay, from: state.user })); }   // the man he replaces hits the market
  P.staff[s.role] = { role: s.role, name: s.name, r: s.r, pay, yrs, age: s.age, id: s.id };
  M.pool = M.pool.filter(x => x !== s);
  if (s.cid) state.coachPool = (state.coachPool || []).filter(c => c.id !== s.cid);
  news(state, `${state.year}-04-25`, 'staff', `You hired ${s.name} as your ${s.role} ($${pay}k, ${yrs} yr${yrs > 1 ? 's' : ''})`, state.user, null);
  return { ok: true, msg: `${s.name} accepts: $${pay}k for ${yrs} year${yrs > 1 ? 's' : ''}.` };
}
/** what it takes to pry an assistant away from his program: a raise, more if his school is bigger or his deal is long */
export function poachAsk(state, team, role) {
  const s = state.teams[team].prog.staff[role]; if (!s) return null;
  const gap = (state.teams[team].prestige || 30) - (state.teams[state.user].prestige || 30);
  return Math.round(s.pay * (1.2 + Math.max(0, gap) / 50 + (s.yrs >= 2 ? 0.1 : 0)));
}
export function poachStaff(state, team, role, pay, yrs) {
  const M = state.staffMarket, P = state.teams[state.user].prog; if (!M || !M.open) return { ok: false, msg: 'You can only poach in the offseason.' };
  const s = state.teams[team].prog.staff[role]; if (!s) return { ok: false, msg: 'That seat is empty.' };
  pay = Math.round(+pay || 0); yrs = clamp(Math.round(+yrs || 2), 1, 5);
  const cur = P.staff[role];
  if (payroll(P) - (cur ? cur.pay : 0) + pay > P.budget) return { ok: false, msg: `That puts you over your staff budget ($${P.budget}k).` };
  const ask = poachAsk(state, team, role);
  if (pay < ask) return { ok: false, counter: ask, msg: `${s.name} stays at ${team} unless you go to about $${ask}k.` };
  if (cur) { cur.yrs = 0; M.pool.push(Object.assign(cur, { ask: cur.pay, from: state.user })); }
  state.teams[team].prog.staff[role] = null;
  P.staff[role] = { role, name: s.name, r: s.r, pay, yrs, age: s.age, id: s.id };
  news(state, `${state.year}-04-25`, 'staff', `You hired ${s.name} away from [[${team}]] as your ${role} ($${pay}k)`, state.user, null);
  return { ok: true, msg: `${s.name} is coming: $${pay}k for ${yrs} year${yrs > 1 ? 's' : ''}.` };
}
/** the AI fills every empty seat, best programs first; what's left stays on the market (in-season hires) */
export function closeStaffMarket(state) {
  const M = state.staffMarket; if (!M || !M.open) return;
  const rng = rngFor(state, 'market2'), U = state.user;
  const teams = Object.values(state.teams).filter(t => t.prog && t.name !== U).sort((a, b) => (b.prestige || 30) - (a.prestige || 30));
  for (const t of teams) {
    const P = t.prog;
    for (const [k] of ROLES) {
      if (P.staff[k]) continue;
      const room = P.budget - payroll(P);
      const c = M.pool.filter(s => s.role === k && s.ask <= room).sort((a, b) => b.r - a.r)[0];
      if (c && rng.chance(0.85)) { M.pool = M.pool.filter(x => x !== c); if (c.cid) state.coachPool = (state.coachPool || []).filter(x => x.id !== c.cid); P.staff[k] = { role: k, name: c.name, r: c.r, pay: c.ask, yrs: 1 + rng.int(4), age: c.age, id: c.id }; M.log.push({ team: t.name, role: k, name: c.name, r: c.r }); }
      else P.staff[k] = staffer(rng, k, 34 + (t.prestige || 30) * 0.38);
    }
  }
  M.open = false;
  state.staffPool = M.pool.filter(s => s.r >= 40).sort((a, b) => b.r - a.r).slice(0, 40).map(s => Object.assign({}, s, { pay: s.ask }));
}
export function hire(state, id) {
  const t = state.teams[state.user], P = t.prog, s = (state.staffPool || []).find(x => x.id === id);
  if (!s) return 'That candidate is gone.';
  const cur = P.staff[s.role];
  if (payroll(P) - (cur ? cur.pay : 0) + s.pay > P.budget) return `Over your staff budget ($${P.budget}k).`;
  P.staff[s.role] = { role: s.role, name: s.name, r: s.r, pay: s.pay, yrs: 3, age: s.age, id: s.id };
  state.staffPool = state.staffPool.filter(x => x.id !== id);
  return null;
}
export function fire(state, role) { const P = state.teams[state.user].prog; P.staff[role] = null; }
// one-off NIL plays: a booster event (hours this week -> money now) costs recruiting momentum
export function boosterEvent(state) {
  const P = state.teams[state.user].prog, d = DIFFS[state.diff || 'pro'];
  if (P.acc.recruiting < 2) return 'Not enough recruiting momentum to spare this week.';
  const gain = Math.round((60 + (state.teams[state.user].prestige || 30) * 2.2) * d.nilK);
  P.nil.fund += gain; P.acc.recruiting -= 2;
  return `+$${gain}k from the booster event (recruiting momentum −2 weeks).`;
}
