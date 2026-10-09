// Postseason: every conference's tournament (single elimination, seeded by league record, byes to the top
// seeds; the Ivy takes four), then the 68-team NCAA tournament: automatic bids for the conference champions,
// at-large bids by power rating, an S-curve into four regions of 16, First Four play-ins (the four lowest
// automatic bids for two 16 seeds, the last four at-large teams for two 11 seeds). All neutral floors.
// Alongside it (Oct 2026): the NIT (32 of the best teams left — regular-season conference champions that lost their
// tournament get a bid — higher seed hosts through the quarterfinals, then a neutral final four) and the CBI (16
// mid-majors on a neutral floor). Conference tournaments follow each league's format (CT_FORMAT: who qualifies,
// early rounds on the higher seed's floor). projectField = in-season bracketology.
// Pure: brackets live in state.post; their games are appended to state.schedule as they become known.
import { standings, power } from './season.js?v=48';

const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

// standard bracket order: seeds 1..size laid out so 1 and 2 can only meet in the final
export function seedOrder(size) {
  let o = [1];
  while (o.length < size) { const n = o.length * 2; o = o.flatMap(s => [s, n + 1 - s]); }
  return o;
}

// conference tournament formats: n = teams that qualify (default all), home = rounds on the higher seed's floor
const CT_FORMAT = { Ivy: { n: 4 }, MAC: { n: 8 }, Summit: { n: 8 }, 'Big West': { n: 8 }, 'Big-East': {}, ACC: { n: 15 }, B10: { n: 15 },
  Patriot: { home: 3 }, AEC: { home: 3 }, Horizon: { home: 2 }, NEC: { n: 8, home: 3 }, ASUN: { home: 1 }, 'Big South': { home: 0 }, MEAC: {}, SWAC: { n: 8 },
  'Sun Belt': {}, CAA: {}, 'PAC-12': {}, WCC: {}, MWC: {}, Southland: { n: 8 }, OVC: { n: 8 }, MAAC: { n: 10 }, UAC: { n: 8 } };
export const ctFormat = conf => CT_FORMAT[conf] || {};

function newGame(state, br, rd, i, h, a, date) {
  const id = `${br.id}-${rd}-${i}`;
  const g = { id, d: date, h: h.team, a: a.team, n: !(br.home && rd <= br.home), c: false, r: null, t: br.kind, br: br.id };
  state.schedule.push(g);
  return id;
}

function winner(state, slot) {
  if (!slot) return null;
  if (slot.team) return slot;                       // a bye / already decided slot
  const g = state.schedule.find(x => x.id === slot.game);
  if (!g || !g.r) return undefined;                 // not played yet
  const homeWon = g.r[0] > g.r[1];
  return homeWon ? slot.h : slot.a;
}

// build round `rd` of a bracket from the previous round's winners (round 0 = the seeded field)
function buildRound(state, br, rd, date) {
  const prev = br.rounds[rd - 1];
  const field = prev.map(s => winner(state, s));
  if (field.some(x => x === undefined)) return false;
  const round = [];
  for (let i = 0; i < field.length; i += 2) {
    const h = field[i], a = field[i + 1];
    if (h && a) {
      const top = h.seed <= a.seed ? h : a, low = top === h ? a : h;
      round.push({ game: newGame(state, br, rd, i / 2, top, low, date), h: top, a: low });
    } else round.push(h || a ? Object.assign({}, h || a) : null);   // bye or empty
  }
  br.rounds.push(round);
  if (round.length === 1 && round[0] && round[0].team) br.champ = round[0].team;
  return true;
}

function seededField(teams, size) {
  // teams: [{team, seed}] best first -> round-0 slots in bracket order, with byes as single-team slots
  const order = seedOrder(size);
  const bySeed = Object.fromEntries(teams.map(t => [t.seed, t]));
  return order.map(s => (bySeed[s] ? { team: bySeed[s].team, seed: s } : null));
}

// round 0 = slots; round 1 = first games (pairs of slots), etc.
function startBracket(state, br, field, date) {
  br.rounds = [field];
  buildRound(state, br, 1, date);
}

export function startConferenceTournaments(state) {
  const st = standings(state);
  const last = state.schedule.filter(g => !g.t).reduce((m, g) => (g.d > m ? g.d : m), '');
  const start = addDays(last, 3);
  state.post = { conf: {}, ncaa: null, start };
  for (const [conf, rows] of Object.entries(st)) {
    const F = ctFormat(conf), n = Math.min(rows.length, F.n || rows.length);
    if (n < 2) continue;
    const teams = rows.slice(0, n).map((r, i) => ({ team: r.team, seed: i + 1 }));
    let size = 1; while (size < n) size *= 2;
    const br = { id: 'ct-' + conf.replace(/[^A-Za-z0-9]/g, ''), kind: 'ct', conf, size, rounds: [], champ: null, start, home: F.home || 0, reg: rows[0].team };
    startBracket(state, br, seededField(teams, size), start);
    state.post.conf[conf] = br;
  }
  state.phase = 'conftourney';
}

// advance any bracket whose current round is finished; returns true when something new was scheduled
export function advance(state) {
  let moved = false;
  const step = br => {
    while (!br.champ) {
      const rd = br.rounds.length;
      const lastDate = br.rounds[rd - 1].map(s => s && s.game && state.schedule.find(x => x.id === s.game)).filter(Boolean).reduce((m, g) => (g.d > m ? g.d : m), br.start);
      const date = addDays(lastDate, br.gaps ? br.gaps[rd - 1] || 2 : br.kind === 'ncaa' ? 2 : 1);
      if (!buildRound(state, br, rd, date)) break;
      moved = true;
    }
  };
  if (state.phase === 'conftourney') {
    Object.values(state.post.conf).forEach(step);
    if (Object.values(state.post.conf).every(b => b.champ)) { selectField(state); moved = true; }
  } else if (state.phase === 'ncaa') {
    const N = state.post.ncaa;
    // First Four winners drop into their slots, then the main bracket runs
    if (!N.main) {
      const ff = N.firstFour.map(f => winner(state, f.slot));
      if (ff.some(x => x === undefined)) return moved;
      N.firstFour.forEach((f, i) => { N.field[f.at] = Object.assign({}, ff[i], { seed: f.seed }); });
      N.main = { id: 'ncaa', kind: 'ncaa', size: 64, rounds: [], champ: null, start: addDays(N.ffDate, 2) };
      startBracket(state, N.main, N.field, N.main.start);
      moved = true;
    }
    step(N.main);
    for (const k of ['nit', 'cbi']) if (state.post[k]) step(state.post[k]);
    if (N.main.champ && !N.champ) { N.champ = N.main.champ; moved = true; }
    if (N.champ && ['nit', 'cbi'].every(k => !state.post[k] || state.post[k].champ)) { state.phase = 'done'; moved = true; }
  }
  return moved;
}

export const REGION_NAMES = ['East', 'West', 'South', 'Midwest'];
const R16 = seedOrder(16);   // 1,16,8,9,5,12,4,13,6,11,3,14,7,10,2,15

export function selectField(state) {
  const pw = power(state);
  const champs = Object.values(state.post.conf).map(b => b.champ).filter(Boolean);
  const auto = new Set(champs);
  const atLargeN = 68 - auto.size;
  const atLarge = Object.keys(state.teams).filter(t => !auto.has(t)).sort((a, b) => pw[b] - pw[a]).slice(0, atLargeN);
  const autoSorted = [...auto].sort((a, b) => pw[b] - pw[a]);
  // First Four: the four lowest automatic bids (two 16 seeds) and the last four at-large teams (two 11 seeds)
  const ffAuto = autoSorted.slice(-4), ffAt = atLarge.slice(-4);
  const direct = [...autoSorted.slice(0, -4), ...atLarge.slice(0, -4)].sort((a, b) => pw[b] - pw[a]);   // 60 teams
  // seed lines: 60 direct teams fill lines 1..16 (4 per line), with two of the 11 and two of the 16 slots
  // left for First Four winners
  const lines = []; let k = 0;
  for (let s = 1; s <= 16; s++) {
    const want = s === 11 || s === 16 ? 2 : 4;
    lines.push({ seed: s, teams: direct.slice(k, k + want) }); k += want;
  }
  // S-curve into regions
  const regions = [[], [], [], []];
  lines.forEach((ln, li) => {
    const order = li % 2 === 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    ln.teams.forEach((t, j) => regions[order[j]].push({ team: t, seed: ln.seed }));
  });
  // regions missing an 11 / 16 get a First Four winner
  const field = [], firstFour = [];
  const ffDate = addDays(Object.values(state.post.conf).flatMap(b => b.rounds.flat()).filter(s => s && s.game)
    .map(s => state.schedule.find(x => x.id === s.game).d).reduce((m, d) => (d > m ? d : m), ''), 4);
  const pairs = { 11: [ffAt[0], ffAt[3], ffAt[1], ffAt[2]], 16: [ffAuto[0], ffAuto[3], ffAuto[1], ffAuto[2]] };
  const used = { 11: 0, 16: 0 };
  regions.forEach((reg, ri) => {
    for (const s of R16) {
      const t = reg.find(x => x.seed === s);
      if (t) { field.push({ team: t.team, seed: s, region: ri }); continue; }
      const p = pairs[s], i = used[s]; used[s] += 2;
      const br = { id: `ff-${s}-${ri}`, kind: 'ncaa' };
      const h = { team: p[i], seed: s }, a = { team: p[i + 1], seed: s };
      firstFour.push({ at: field.length, seed: s, slot: { game: newGame(state, br, 0, 0, h, a, ffDate), h, a } });
      field.push(null);
    }
  });
  state.post.ncaa = { field, firstFour, ffDate, main: null, champ: null, regions: REGION_NAMES, autoBids: [...auto], atLarge };
  startNIT(state, new Set([...auto, ...atLarge]), pw, ffDate);
  state.phase = 'ncaa';
}

// conference strength tiers without realign.js's table (first season): mean member level, top 6 = power leagues
function powerConfs(state) {
  if (state.confs) return new Set(Object.keys(state.confs).filter(c => state.confs[c].tier === 0 || state.confs[c].rank <= 6));
  const lv = {}; for (const t of Object.values(state.teams)) (lv[t.conf] = lv[t.conf] || []).push(t.level || 0);
  return new Set(Object.keys(lv).sort((a, b) => lv[b].reduce((x, y) => x + y, 0) / lv[b].length - lv[a].reduce((x, y) => x + y, 0) / lv[a].length).slice(0, 6));
}
const NIT_N = 32, CBI_N = 16;
function startNIT(state, inNCAA, pw, ffDate) {
  const order = Object.keys(state.teams).filter(t => !inNCAA.has(t)).sort((a, b) => pw[b] - pw[a]);
  const rank = Object.fromEntries(Object.keys(pw).sort((a, b) => pw[b] - pw[a]).map((t, i) => [t, i + 1]));
  // automatic NIT bids: regular-season champions that lost their conference tournament (inside the top 150)
  const regChamps = Object.values(state.post.conf).map(b => b.reg).filter(t => t && !inNCAA.has(t) && rank[t] <= 150);
  const nit = [...new Set([...regChamps, ...order])].slice(0, NIT_N).sort((a, b) => pw[b] - pw[a]);
  const field = (list, size) => seededField(list.map((t, i) => ({ team: t, seed: i + 1 })), size);
  // NIT: overall seeds 1-32 in four quadrants (shown as 1-8 seeds); higher seed hosts through the quarterfinals
  state.post.nit = { id: 'nit', kind: 'nit', size: NIT_N, rounds: [], champ: null, start: ffDate, home: 3, gaps: [2, 2, 3, 2] };
  startBracket(state, state.post.nit, field(nit, NIT_N), ffDate);
  // CBI: the next 16 from outside the power leagues, all in one neutral spot
  const P = powerConfs(state), taken = new Set(nit);
  const cbi = order.filter(t => !taken.has(t) && !P.has(state.teams[t].conf)).slice(0, CBI_N);
  if (cbi.length === CBI_N) {
    state.post.cbi = { id: 'cbi', kind: 'cbi', size: CBI_N, rounds: [], champ: null, start: addDays(ffDate, 1), gaps: [1, 1, 2] };
    startBracket(state, state.post.cbi, field(cbi, CBI_N), addDays(ffDate, 1));
  }
}

/** a team's whole postseason in one phrase (NCAA first, then the NIT / CBI), for history and prestige */
export function postResult(state, team) {
  const r = ncaaResult(state, team); if (r) return r;
  for (const [k, L] of [['nit', 'NIT'], ['cbi', 'CBI']]) {
    const B = state.post && state.post[k]; if (!B || !B.rounds.length) continue;
    if (!B.rounds[0].some(s => s && s.team === team)) continue;
    if (B.champ === team) return `${L} Champion`;
    let best = 0; B.rounds.forEach((rd, i) => { if (i > 0 && rd.some(s => s && ((s.h && s.h.team === team) || (s.a && s.a.team === team) || s.team === team))) best = i; });
    const left = B.rounds[best] ? B.rounds[best].length : 0;
    return `${L} ${left === 1 ? 'Runner-up' : left === 2 ? 'Semifinal' : left === 4 ? 'Quarterfinal' : 'appearance'}`;
  }
  return null;
}

/** in-season bracketology: today's leaders as automatic bids, then the same selection as Selection Sunday */
export function projectField(state) {
  const pw = power(state), st = standings(state);
  const auto = new Set(Object.values(st).map(rows => rows.slice().sort((a, b) => (b.cw - b.cl) - (a.cw - a.cl) || pw[b.team] - pw[a.team])[0]).filter(Boolean).map(r => r.team));
  const atLarge = Object.keys(state.teams).filter(t => !auto.has(t)).sort((a, b) => pw[b] - pw[a]);
  const inAt = atLarge.slice(0, 68 - auto.size);
  // exactly like Selection Sunday: the last four at-large teams play in on the 11 line, the four weakest automatic
  // bids on the 16 line; everyone else by power, four to a line
  const autoS = [...auto].sort((a, b) => pw[b] - pw[a]), ffAuto = autoS.slice(-4), ffAt = inAt.slice(-4);
  const direct = [...autoS.slice(0, -4), ...inAt.slice(0, -4)].sort((a, b) => pw[b] - pw[a]);
  const lines = []; let k = 0;
  for (let s = 1; s <= 16; s++) {
    const want = s === 11 || s === 16 ? 2 : 4, T = direct.slice(k, k + want).map(t => ({ team: t, auto: auto.has(t) })); k += want;
    if (s === 11) ffAt.forEach(t => T.push({ team: t, auto: false, ff: true }));
    if (s === 16) ffAuto.forEach(t => T.push({ team: t, auto: true, ff: true }));
    lines.push({ seed: s, teams: T });
  }
  return { lines, lastIn: inAt.slice(-4), firstOut: atLarge.slice(68 - auto.size, 68 - auto.size + 4), auto: [...auto] };
}

// a team's postseason result, for history: 'Champion', 'Final Four', 'Elite Eight', ...
export function ncaaResult(state, team) {
  const N = state.post && state.post.ncaa; if (!N) return null;
  const inField = N.field.some(s => s && s.team === team) || N.firstFour.some(f => f.slot.h.team === team || f.slot.a.team === team);
  if (!inField) return null;
  if (N.champ === team) return 'Champion';
  const names = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite Eight', 'Final Four', 'Runner-up'];
  if (!N.main) return 'First Four';
  let best = N.field.some(s => s && s.team === team) ? 1 : 0;
  N.main.rounds.forEach((rd, i) => { if (i > 0 && rd.some(s => s && ((s.h && s.h.team === team) || (s.a && s.a.team === team)))) best = i; });
  return names[best];
}
