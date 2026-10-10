// Coaching Legacy (Oct 2026): the user's coach grows over a career. Results earn LEGACY POINTS (wins, titles, March
// runs, players drafted, awards, recruiting classes, beating expectations); enough of them and the coach reaches a new
// COACH LEVEL (1-50, a long curve — the top takes a whole career), and every level is a point to spend on TRAITS in
// three DISCIPLINES. Nobody can have everything: 15 traits x 3 ranks cost 90 points, a 50-level career earns ~52.
//   SIDELINE    — game coaching (scheme installs, timeouts, crunch time, halftime, road games)
//   PIPELINE    — talent acquisition (scouting, visits, NIL deals, the portal, closing recruiting battles)
//   LOCKER ROOM — keeping and growing players (persuasion, loyalty, expectations, development, injuries)
// Effects apply to the user's program only (the AI coaches have their ratings, coaching.js). The legacy belongs to
// the coach and moves with him to a new job. Pure: works on the state object.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const DISCIPLINES = [['side', 'Sideline'], ['pipe', 'Pipeline'], ['room', 'Locker Room']];
export const TRAITS = {
  install:  { d: 'side', name: 'Quick Install', per: 'Players learn your schemes {15}% faster.', v: [0.15, 0.3, 0.45] },
  tmo:      { d: 'side', name: 'Timeout Whisperer', per: 'Your timeouts\' set play and breather are {30}% stronger.', v: [0.3, 0.6, 0.9] },
  crunch:   { d: 'side', name: 'Crunch-Time Script', per: 'Your team gets an edge in the last four minutes of a close game — more with each rank.', v: [0.03, 0.06, 0.09] },
  half:     { d: 'side', name: 'Halftime Fix', per: 'Trailing at the half, your team plays the second half sharper — more with each rank.', v: [0.012, 0.024, 0.036] },
  road:     { d: 'side', name: 'Road Warrior', per: 'Takes {20}% off the home crowd\'s edge when you play away.', v: [0.2, 0.4, 0.6] },
  film:     { d: 'pipe', name: 'Film Junkie', per: 'Your scouting reads recruits {20}% more accurately.', v: [0.25, 0.5, 0.75] },
  flyer:    { d: 'pipe', name: 'Frequent Flyer', per: 'Visits cost {20}% less, and one more official visit per rank.', v: [0.2, 0.4, 0.6] },
  handshake:{ d: 'pipe', name: 'Handshake Deals', per: 'Recruits and transfers settle for {5}% less NIL.', v: [0.05, 0.1, 0.15] },
  hawk:     { d: 'pipe', name: 'Portal Hawk', per: '+{1} call a day in the transfer portal, and every call lands harder.', v: [1, 2, 3] },
  closer:   { d: 'pipe', name: 'Living-Room Closer', per: 'Your final pushes in recruiting battles hit harder — more with each rank.', v: [0.12, 0.24, 0.36] },
  door:     { d: 'room', name: 'Open Door', per: '+{1} conversation with players headed for the portal, and each one is likelier to work.', v: [1, 2, 3] },
  ourguys:  { d: 'room', name: 'Our Guys', per: 'Your players are {10}% less tempted by the portal.', v: [0.1, 0.2, 0.3] },
  players:  { d: 'room', name: 'Player\'s Coach', per: 'Players\' expectations of you are {4} points lower.', v: [4, 8, 12] },
  grind:    { d: 'room', name: 'Grinders', per: 'Your players develop {3}% more each summer.', v: [0.03, 0.06, 0.09] },
  nextman:  { d: 'room', name: 'Next Man Up', per: 'Your injured players are back {15}% sooner.', v: [0.15, 0.3, 0.45] },
};
export const MAX_RANK = 3, MAX_LEVEL = 50;
/** total legacy points to reach level L (L1 = 0, L2 = 100, L5 = 800, L10 = 2.7k, L20 = 8.3k, L50 = 34k) */
export const lpFor = L => Math.round(100 * Math.pow(Math.max(0, L - 1), 1.5));
export const levelOf = lp => { let L = 1; while (L < MAX_LEVEL && lp >= lpFor(L + 1)) L++; return L; };

export function ensureLegacy(state) {
  if (!state.legacy) state.legacy = { lp: 0, level: 1, pts: 3, traits: {}, log: [] };
  return state.legacy;
}
/** the user's rank (0-3) in a trait */
export const rank = (state, k) => (state.legacy && state.legacy.traits[k]) || 0;
/** the trait's value at the user's rank (0 when not owned) */
export const tv = (state, k) => { const r = rank(state, k); return r ? TRAITS[k].v[r - 1] : 0; };
export const cost = (state, k) => rank(state, k) + 1;   // rank 1 = 1 point, rank 2 = 2, rank 3 = 3

export function buyTrait(state, k) {
  const L = ensureLegacy(state), T = TRAITS[k]; if (!T) return 'Unknown trait.';
  if (rank(state, k) >= MAX_RANK) return `${T.name} is maxed out.`;
  const c = cost(state, k); if (L.pts < c) return `You need ${c} point${c > 1 ? 's' : ''} (you have ${L.pts}).`;
  L.pts -= c; L.traits[k] = rank(state, k) + 1;
  return null;
}

/** add legacy points (with a reason); level-ups give a point each */
export function award(state, n, why) {
  const L = ensureLegacy(state); if (!n) return;
  L.lp += Math.round(n);
  const lv = levelOf(L.lp);
  if (lv > L.level) { L.pts += lv - L.level; L.level = lv; L.log.push({ y: state.year, why: `Reached coach level ${lv}`, n: 0, up: true }); }
  L.log.push({ y: state.year, why, n: Math.round(n) });
  if (L.log.length > 200) L.log.splice(0, L.log.length - 200);
}

/** the season's legacy (call once at the end of a season, after awards + the draft) */
export function seasonLegacy(state, info) {
  const { w, perf, post, confReg, confTour, rankedWins, drafted, awards, coy, confCoy, nit } = info;
  award(state, 3 * w, `${w} wins`);
  if (perf > 0) award(state, 40 * perf, 'Beat expectations');
  if (confReg) award(state, 40, 'Regular-season conference title');
  if (confTour) award(state, 40, 'Conference tournament title');
  const P = { 'Round of 64': 30, 'Round of 32': 55, 'Sweet 16': 85, 'Elite Eight': 120, 'Final Four': 190, 'Runner-up': 240, Champion: 380, 'First Four': 20 }[post] || 0;
  if (P) award(state, P, `NCAA tournament: ${post}`);
  if (nit) award(state, 30, 'NIT champions');
  if (rankedWins) award(state, 8 * rankedWins, `${rankedWins} wins over top-25 teams`);
  for (const d of drafted || []) award(state, d.round === 1 ? 60 : 30, `${d.name} drafted (No. ${d.pick})`);
  for (const a of awards || []) award(state, a.n, a.why);
  if (coy) award(state, 100, 'National Coach of the Year');
  if (confCoy) award(state, 40, 'Conference Coach of the Year');
}
export const pct = L => clamp((L.lp - lpFor(L.level)) / Math.max(1, lpFor(L.level + 1) - lpFor(L.level)), 0, 1);
