// In-season injuries. After every game each player who played rolls for an injury in proportion to his
// minutes; an injured player sits out a number of his team's games (p.out), then returns. ~2.5 injuries per
// team-season, most a game or three, a few for weeks, the rare one for the season. Pure + seeded per game.
import { makeRng, hashSeed } from './rng.js?v=50';
import { injuryMult } from './facilities.js?v=50';

// [name, min games, max games, weight]; max 99 = out for the season
export const TYPES = [
  ['ankle sprain', 1, 4, 22], ['illness', 1, 2, 10], ['knee soreness', 1, 3, 12], ['hamstring strain', 2, 6, 12],
  ['back spasms', 1, 3, 8], ['concussion', 1, 4, 7], ['wrist sprain', 2, 5, 6], ['shoulder sprain', 2, 6, 6],
  ['high ankle sprain', 4, 10, 8], ['foot fracture', 8, 18, 4], ['torn ACL', 99, 99, 1.5],
];
const W = TYPES.map(t => t[3]);
export const RATE = 0.012;   // injury chance per 30 minutes played

export const isOut = p => (p.out || 0) > 0;

// call after a game is recorded: heal a game for everyone who was already out, then roll new injuries
export function afterGame(state, g, sim) {
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:${g.id}:inj`));
  let changed = false;
  for (const team of [g.h, g.a]) {
    if (!state.teams[team]) continue;                        // non-D-I opponents: no injury tracking
    for (const id of state.teams[team].players) {
      const p = state.players[id];
      if (p && p.out > 0) {
        p.out--; changed = true;
        if (p.out === 0) { news(state, g.d, 'return', `${p.name} ([[${team}]]) is back from a ${p.inj && p.inj.type}`, team, p); delete p.inj; }
      }
    }
  }
  for (const [rows, team] of [[sim.box.home, g.h], [sim.box.away, g.a]]) {
    if (!state.teams[team]) continue;
    for (const r of rows) {
      // a tired body breaks down more: every minute a night past his stamina threshold adds 6% to the risk
      const pl0 = state.players[r.id], thr = pl0 && pl0.sta != null ? 28 + pl0.sta / 9 : 34, over = Math.max(0, (pl0 && pl0.mpg || 0) - thr);
      const S0 = state.settings || {};
      if (!(r.min > 0) || !rng.chance(RATE * r.min / 30 * (1 + 0.06 * over) * injuryMult(state.teams[team]) * (pl0 && pl0.prone || 1) * (S0.injFreq ?? 1))) continue;   // sports medicine (facilities.js), his durability (people.js), the league setting
      const p = state.players[r.id]; if (!p) continue;
      const [type, lo, hi] = TYPES[rng.pick(W)];
      const games = hi === 99 ? 99 : Math.max(1, Math.round((lo + rng.int(hi - lo + 1)) * ((state.settings && state.settings.injSev) ?? 1)));
      if (games >= 8) p.prone = Math.min(2.5, Math.round((p.prone || 1) * 1.12 * 100) / 100);   // a serious injury makes the next one likelier
      p.out = games; p.inj = { type, games, d: g.d };
      changed = true;
      news(state, g.d, 'injury', `${p.name} ([[${team}]]) — ${type}, ${games === 99 ? 'out for the season' : `out ${games} game${games > 1 ? 's' : ''}`}`, team, p);
    }
  }
  return changed;
}

export function healAll(state) {
  for (const p of Object.values(state.players)) { p.out = 0; delete p.inj; }
}

// team names in news text are [[Full Name]] tokens; the page renders them with its short-name helper
// the news feed keeps the user's team and notable players / teams; capped
export function news(state, d, type, text, team, p) {
  const keep = team === state.user || type === 'award' || type === 'coach' || type === 'title' || (p && (p.attr ? true : false) && notable(state, p));
  if (!keep) return;
  (state.news = state.news || []).push({ d, type, text, team, mine: team === state.user });
  if (state.news.length > 250) state.news.splice(0, state.news.length - 250);
}
function notable(state, p) {
  // a regular starter on a top-40 prestige program
  const t = state.teams[p.team];
  return t && t.prestige >= 70 && (p.mpg || 0) >= 24;
}
