// Multi-team events (Oct 2026): every generated season (the first season plays the real 2026-27 events from the
// schedule files) gets the November / December events — 8-team brackets where everyone plays three days (winners'
// bracket + consolation: 1st through 8th), 4-team events over two days, and the Champions Classic double-header.
// Invitations go by program stature: the big events fill from the top of the sport (with a mid-major or two), the
// mid-level events from the middle, the small ones from the low majors; no two teams from one league in an event.
// Later rounds are made on the morning they are played from the earlier results (state.pending type 'mte').
// Pure: works on the state object.
const addD = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// day = days from Thanksgiving (the 4th Thursday of November)
export const EVENTS = [
  { name: 'Maui Invitational', site: 'Lahaina, HI', size: 8, tier: 0, day: -3 },
  { name: 'Battle 4 Atlantis', site: 'Paradise Island, Bahamas', size: 8, tier: 0, day: -1 },
  { name: 'Players Era Festival', site: 'Las Vegas, NV', size: 8, tier: 0, day: -3 },
  { name: 'ESPN Events Invitational', site: 'Orlando, FL', size: 8, tier: 0, day: 0 },
  { name: 'Baha Mar Championship', site: 'Nassau, Bahamas', size: 4, tier: 0, day: -12 },
  { name: 'Empire Classic', site: 'New York, NY', size: 4, tier: 0, day: -10 },
  { name: 'Legends Classic', site: 'Brooklyn, NY', size: 4, tier: 0, day: -9 },
  { name: 'Hall of Fame Tip-Off', site: 'Uncasville, CT', size: 4, tier: 0, day: -5 },
  { name: 'Las Vegas Invitational', site: 'Las Vegas, NV', size: 4, tier: 0, day: 0 },
  { name: 'Charleston Classic', site: 'Charleston, SC', size: 8, tier: 1, day: 0 },
  { name: 'Arizona Tip-Off', site: 'Phoenix, AZ', size: 8, tier: 1, day: 0 },
  { name: 'Cayman Islands Classic', site: 'George Town, Cayman Islands', size: 8, tier: 1, day: -3 },
  { name: 'Myrtle Beach Invitational', site: 'Conway, SC', size: 8, tier: 1, day: -7 },
  { name: 'Paradise Jam', site: 'St. Thomas, USVI', size: 8, tier: 1, day: -6 },
  { name: 'Fort Myers Tip-Off', site: 'Fort Myers, FL', size: 4, tier: 1, day: -3 },
  { name: 'Sunshine Slam', site: 'Daytona Beach, FL', size: 4, tier: 1, day: -3 },
  { name: 'Emerald Coast Classic', site: 'Niceville, FL', size: 4, tier: 1, day: 1 },
  { name: 'Jacksonville Classic', site: 'Jacksonville, FL', size: 4, tier: 1, day: 3 },
  { name: 'Gulf Coast Showcase', site: 'Estero, FL', size: 8, tier: 2, day: -3 },
  { name: 'Jamaica Classic', site: 'Montego Bay, Jamaica', size: 8, tier: 2, day: -7 },
  { name: 'Cancún Challenge', site: 'Cancún, Mexico', size: 8, tier: 2, day: -2 },
];
export const CHAMPIONS = ['Duke Blue Devils', 'Kentucky Wildcats', 'Kansas Jayhawks', 'Michigan State Spartans'];
const CC_PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
/** a Champions Classic program's opponent in season y (the pairings rotate) */
export function ccOpponent(team, y) { const i = CHAMPIONS.indexOf(team); if (i < 0) return null; const p = CC_PAIRS[y % 3].find(x => x.includes(i)); return CHAMPIONS[p[0] === i ? p[1] : p[0]]; }
const POOL = [[0, 62], [50, 230], [190, 9999]];           // prestige-rank window each tier invites from

function thanksgiving(y) { const d = new Date(Date.UTC(y, 10, 1)); const first = (4 - d.getUTCDay() + 7) % 7 + 1; return `${y}-11-${String(first + 21).padStart(2, '0')}`; }

/** this season's events: day-one games now, later days pending; `busy` = each team's event dates */
export function planMTEs(state, rng, userEvent) {   // userEvent: undefined = normal, null = sit out, a name = that event
  const y = state.year, tg = thanksgiving(y - 1), games = [], pending = [], busy = {}, mtes = [];
  const mark = (t, d) => (busy[t] = busy[t] || []).push(d);
  const g = (m, rd, i, d, h, a) => { const x = { id: `mte-${y}-${m.k}-${rd}-${i}`, d, h, a, n: true, c: false, r: null, ev: m.name, mte: m.id }; games.push(x); return x.id; };
  // stature order with some noise, so the same programs aren't in the same events every year
  const order = Object.values(state.teams).map(t => [t.name, (t.prestige || 30) + rng.normal(0, 9)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const U = state.user, used = new Set(userEvent !== undefined && U ? [U] : []);
  EVENTS.forEach((E, k) => {
    const [lo, hi] = POOL[E.tier], pool = order.slice(lo, hi).filter(t => !used.has(t));
    const teams = [], confs = new Set();
    if (userEvent && E.name === userEvent && U && state.teams[U]) { teams.push(U); confs.add(state.teams[U].conf); }
    for (const t of pool.sort(() => rng.next() - 0.5)) {
      if (teams.length >= E.size) break;
      if (confs.has(state.teams[t].conf)) continue;
      teams.push(t); confs.add(state.teams[t].conf);
    }
    if (teams.length < E.size) return;
    teams.forEach(t => used.add(t));
    const seeded = teams.sort((a, b) => (state.teams[b].prestige || 30) - (state.teams[a].prestige || 30)).map((t, i) => ({ team: t, seed: i + 1 }));
    const start = addD(tg, E.day), days = E.size === 8 ? [start, addD(start, 1), addD(start, 2)] : [start, addD(start, 1)];
    const m = { id: `mte-${y}-${k}`, k, name: E.name, site: E.site, size: E.size, tier: E.tier, teams: seeded, days, rounds: [] };
    const S = i => seeded[i - 1].team;
    const pairs = E.size === 8 ? [[1, 8], [4, 5], [3, 6], [2, 7]] : [[1, 4], [2, 3]];
    m.rounds.push(pairs.map(([a, b], i) => g(m, 0, i, start, S(a), S(b))));
    for (const d of days.slice(1)) pending.push({ d, type: 'mte', id: m.id, done: false });
    for (const t of teams) for (const d of days) mark(t, d);
    mtes.push(m);
  });
  // the Champions Classic: two blue-blood games in the second week (pairings rotate by year)
  const cc = CHAMPIONS.filter(t => state.teams[t]);
  if (cc.length === 4) {
    const d = addD(tg, -16), P = CC_PAIRS[y % 3];
    const m = { id: `mte-${y}-cc`, k: 'cc', name: 'Champions Classic', site: 'Indianapolis / New York / Chicago / Atlanta', size: 4, tier: 0, showcase: true, teams: cc.map((t, i) => ({ team: t, seed: i + 1 })), days: [d], rounds: [] };
    m.rounds.push(P.map(([a, b], i) => g(m, 0, i, d, cc[a], cc[b])));
    cc.forEach(t => mark(t, d)); mtes.push(m);
  }
  state.mtes = mtes;
  return { games, pending, busy };
}

const win = g => (g.r[0] > g.r[1] ? g.h : g.a), lose = g => (g.r[0] > g.r[1] ? g.a : g.h);
/** before day `d` is played: build the event rounds due that day from the earlier results */
export function resolveMTE(state, d) {
  const due = (state.pending || []).filter(x => x.type === 'mte' && x.d === d && !x.done);
  if (!due.length) return;
  const byId = id => state.schedule.find(x => x.id === id);
  for (const x of due) {
    x.done = true;
    const m = (state.mtes || []).find(e => e.id === x.id); if (!m) continue;
    const prev = m.rounds.at(-1).map(byId);
    if (prev.some(g => !g || !g.r)) continue;
    const rd = m.rounds.length, add = [];
    const mk = (i, h, a) => { const id = `mte-${state.year}-${m.k}-${rd}-${i}`; state.schedule.push({ id, d, h, a, n: true, c: false, r: null, ev: m.name, mte: m.id }); add.push(id); };
    if (m.size === 8 && rd === 1) {           // semifinals + consolation semifinals
      mk(0, win(prev[0]), win(prev[1])); mk(1, win(prev[2]), win(prev[3]));
      mk(2, lose(prev[0]), lose(prev[1])); mk(3, lose(prev[2]), lose(prev[3]));
    } else {                                  // final, 3rd, (5th, 7th)
      mk(0, win(prev[0]), win(prev[1])); mk(1, lose(prev[0]), lose(prev[1]));
      if (m.size === 8) { mk(2, win(prev[2]), win(prev[3])); mk(3, lose(prev[2]), lose(prev[3])); }
    }
    m.rounds.push(add);
  }
  state.schedule.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

/** an event's finish: places 1..size once its last day is played (null before), + champion */
export function mteFinish(state, m) {
  const byId = id => state.schedule.find(x => x.id === id);
  if (m.showcase) return { champ: null, places: null, games: m.rounds[0].map(byId) };
  const last = m.rounds.length === (m.size === 8 ? 3 : 2) ? m.rounds.at(-1).map(byId) : null;
  if (!last || last.some(g => !g || !g.r)) return { champ: null, places: null, games: m.rounds.flat().map(byId) };
  const places = [];
  last.forEach(g => { places.push(win(g), lose(g)); });
  return { champ: places[0], places, games: m.rounds.flat().map(byId) };
}
