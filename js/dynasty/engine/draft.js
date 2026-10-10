// The draft (Oct 2026). The early entrants markDepartures sends pro (rank-based, ~35-50 a year) go through a
// two-round, 60-pick draft; about a quarter of the picks go to international / G League players, so college
// entrants fill the rest in order of a draft grade (effective OVR + youth + size + upside + scouts' noise). Whoever
// isn't picked signs pro elsewhere (undrafted). Some borderline players test the waters and come back.
// Pure: works on the state object.
import { makeRng, hashSeed } from './rng.js?v=55';
import { effOvr } from './league.js?v=55';
import { news } from './injuries.js?v=55';

const PICKS = 60, NON_COLLEGE = 0.2;
export const NBA = ['Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets', 'Chicago Bulls', 'Cleveland Cavaliers', 'Dallas Mavericks', 'Denver Nuggets',
  'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets', 'Indiana Pacers', 'LA Clippers', 'Los Angeles Lakers', 'Memphis Grizzlies', 'Miami Heat', 'Milwaukee Bucks',
  'Minnesota Timberwolves', 'New Orleans Pelicans', 'New York Knicks', 'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers', 'Phoenix Suns', 'Portland Trail Blazers',
  'Sacramento Kings', 'San Antonio Spurs', 'Toronto Raptors', 'Utah Jazz', 'Washington Wizards'];
const CLUBS = ['Real Madrid', 'FC Barcelona', 'Partizan', 'Crvena zvezda', 'ASVEL', 'Olympiacos', 'Ratiopharm Ulm', 'Melbourne United', 'Paris Basketball', 'Mega Basket', 'G League Ignite', 'Valencia', 'Fenerbahçe', 'Zalgiris', 'Bayern Munich'];

export function runDraft(state) {
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:draft`)), O = state.off, U = state.user;
  const grade = p => effOvr(p, state) + (p.yr === 1 ? 4 : p.yr === 2 ? 2 : p.yr === 3 ? 0.5 : -1) + ((p.ht || 78) - 78) * 0.35 + (p.pot || 0) * 0.25 + rng.normal(0, 2.2);
  // testing the waters: good returning players (not seniors) declare and work out; most come back, about a quarter
  // stay in (they're the late picks and the undrafted)
  const rot = Object.values(state.players).filter(p => p.team && !O.leaving[p.id] && p.yr <= 3 && (p.mpg || 0) >= 15)
    .sort((a, b) => effOvr(b, state) - effOvr(a, state)).slice(0, 160);
  const testers = rot.filter(() => rng.chance(0.15)), withdrew = [];
  for (const p of testers) {
    if (rng.chance(0.25)) O.leaving[p.id] = 'pro';
    else withdrew.push({ id: p.id, name: p.name, team: p.team, ovr: Math.round(effOvr(p, state)) });
  }
  const entrants = Object.entries(O.leaving).filter(([, w]) => w === 'pro').map(([id]) => state.players[id]).filter(Boolean)
    .map(p => ({ p, g: grade(p) })).sort((a, b) => b.g - a.g);
  // the NBA order: a lottery-ish shuffle each year, the same order both rounds
  const order = NBA.slice(); for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const NP = state.names || { f: ['Luka', 'Nikola', 'Alperen'], l: ['Petrovic', 'Garcia', 'Okafor'] };
  const picks = [], und = [];
  let k = 0;
  for (let n = 1; n <= PICKS; n++) {
    const nba = order[(n - 1) % 30], round = n <= 30 ? 1 : 2;
    if ((n > 3 && rng.chance(NON_COLLEGE)) || k >= entrants.length) {   // an international / G League pick — shown, so the board has no gaps
      picks.push({ pick: n, round, nba, intl: true, name: `${NP.f[rng.int(NP.f.length)]} ${NP.l[rng.int(NP.l.length)]}`, from: CLUBS[rng.int(CLUBS.length)], pos: ['PG', 'SG', 'SF', 'PF', 'C'][rng.int(5)] });
      continue;
    }
    const { p, g } = entrants[k++];
    picks.push({ pick: n, round, nba, id: p.id, name: p.name, team: p.team, pos: p.pos, yr: p.yr, ovr: Math.round(effOvr(p, state)), ds: Math.round(g * 10) / 10,
      why: [p.yr <= 2 ? 'young' : null, (p.ht || 78) >= 81 ? 'size' : null, (p.pot || 0) >= 8 ? 'upside' : null].filter(Boolean) });
  }
  for (; k < entrants.length; k++) { const p = entrants[k].p; und.push({ id: p.id, name: p.name, team: p.team, pos: p.pos, yr: p.yr, ovr: Math.round(effOvr(p, state)) }); }
  O.draft = { year: state.year, picks, und, withdrew };
  // the league's draft record (the first round + every pick from the user's program), for history
  state.drafts = (state.drafts || []).concat(picks.filter(x => !x.intl && (x.round === 1 || x.team === U)).map(x => ({ y: state.year, pick: x.pick, name: x.name, team: x.team, pos: x.pos }))).slice(-400);
  const d = `${state.year}-06-25`;
  const first = picks.find(x => !x.intl);
  if (first && first.pick === 1) news(state, d, 'draft', `${picks[0].name} ([[${picks[0].team}]]) goes No. 1 in the draft`, picks[0].team, null);
  for (const x of picks.filter(x => x.team === U)) news(state, d, 'draft', `${x.name} drafted — ${x.round === 1 ? 'first' : 'second'} round, No. ${x.pick}`, U, null);
  for (const x of und.filter(x => x.team === U)) news(state, d, 'draft', `${x.name} went undrafted and signed a pro contract`, U, null);
  for (const x of withdrew.filter(x => x.team === U)) news(state, `${state.year}-05-29`, 'draft', `${x.name} tested the draft waters and is returning`, U, null);
}
