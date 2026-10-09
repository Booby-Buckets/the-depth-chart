// Postseason: every conference's tournament (single elimination, seeded by league record, byes to the top
// seeds; the Ivy takes four), then the 68-team NCAA tournament: automatic bids for the conference champions,
// at-large bids by power rating, an S-curve into four regions of 16, First Four play-ins (the four lowest
// automatic bids for two 16 seeds, the last four at-large teams for two 11 seeds). All neutral floors.
// Pure: brackets live in state.post; their games are appended to state.schedule as they become known.
import { standings, power } from './season.js?v=39';

const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

// standard bracket order: seeds 1..size laid out so 1 and 2 can only meet in the final
export function seedOrder(size) {
  let o = [1];
  while (o.length < size) { const n = o.length * 2; o = o.flatMap(s => [s, n + 1 - s]); }
  return o;
}

const CONF_CAP = { Ivy: 4 };

function newGame(state, br, rd, i, h, a, date) {
  const id = `${br.id}-${rd}-${i}`;
  const g = { id, d: date, h: h.team, a: a.team, n: true, c: false, r: null, t: br.kind, br: br.id };
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
    const n = Math.min(rows.length, CONF_CAP[conf] || rows.length);
    if (n < 2) continue;
    const teams = rows.slice(0, n).map((r, i) => ({ team: r.team, seed: i + 1 }));
    let size = 1; while (size < n) size *= 2;
    const br = { id: 'ct-' + conf.replace(/[^A-Za-z0-9]/g, ''), kind: 'ct', conf, size, rounds: [], champ: null, start };
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
      const date = addDays(lastDate, br.kind === 'ncaa' ? 2 : 1);
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
    if (N.main.champ) { N.champ = N.main.champ; state.phase = 'done'; moved = true; }
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
  state.phase = 'ncaa';
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
