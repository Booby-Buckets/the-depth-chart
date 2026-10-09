// Coaches, job security and the carousel. Every program has a head coach (the real 2026-27 hires to start).
// After each season a coach's results are judged against expectations (where the preseason roster rating
// ranked the team vs where it finished, plus March): AI coaches on a hot seat get fired, successful coaches at
// smaller programs get hired up (taking their defensive scheme with them), and the user's job security moves —
// a strong year brings offers from bigger programs, a run of bad ones gets you fired.
import { power } from './season.js?v=40';
import { powerFeatures } from './league.js?v=40';
import { ncaaResult } from './postseason.js?v=40';
import { makeRng, hashSeed } from './rng.js?v=40';
import { DIFFS } from './program.js?v=40';
import { news } from './injuries.js?v=40';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const BUMP = { Champion: 3, 'Runner-up': 2.3, 'Final Four': 2, 'Elite Eight': 1.2, 'Sweet 16': 0.6, 'Round of 32': 0.2 };

export function initCoaches(state, snap, userName) {
  const byName = Object.fromEntries((snap ? snap.teams.concat(snap.shells || []) : []).map(t => [t.name, t.coach]));
  const rng = makeRng(hashSeed(`${state.seed}:coaches`));
  for (const t of Object.values(state.teams)) {
    t.coach = t.name === state.user ? { name: userName || 'You', yrs: 0, user: true, hot: 0 }
      : { name: byName[t.name] || randomName(state, rng), yrs: 1 + rng.int(12), hot: 0 };
  }
  state.job = { security: 60, seasons: 0, offers: [], fired: false, log: [] };
}

function randomName(state, rng) {
  if (state.names) return `${state.names.f[rng.int(state.names.f.length)]} ${state.names.l[rng.int(state.names.l.length)]}`;   // frozen pool
  const ps = Object.values(state.players);
  const a = ps[rng.int(ps.length)].name.split(' ')[0], b = ps[rng.int(ps.length)].name.split(' ').slice(1).join(' ') || 'Smith';
  return `${a} ${b}`;
}

// judge the season (call before prestige moves); returns { perf } for every team
export function evaluateCoaches(state) {
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:carousel`));
  const pw = power(state), T = Object.keys(state.teams);
  const prior = Object.fromEntries(T.map(t => [t, powerFeatures(state.teams[t], state.players, state.maps).reduce((s, x, i) => s + x * state.powerFit[i], 0)]));
  const rankBy = m => Object.fromEntries(T.slice().sort((a, b) => m[b] - m[a]).map((t, i) => [t, i + 1]));
  const pre = rankBy(prior), fin = rankBy(pw);
  const perf = {};
  for (const t of T) {
    const r = ncaaResult(state, t);
    perf[t] = (pre[t] - fin[t]) / 25 + (BUMP[r] || 0) - (!r && pre[t] <= 30 ? 0.8 : 0);
  }
  const lastDay = state.schedule.reduce((m, g) => (g.d > m ? g.d : m), '');
  // AI: hot seats + firings
  const vacancies = [];
  for (const t of T) {
    const c = state.teams[t].coach; if (!c || c.user) continue;
    c.hot = 0.55 * (c.hot || 0) + perf[t];
    c.yrs = (c.yrs || 0) + 1;
    const fireP = c.yrs < 3 ? 0 : c.hot < -2 ? 0.75 : c.hot < -1.2 ? 0.3 : 0;
    const retireP = c.yrs > 12 ? 0.08 : 0.015;
    if (rng.chance(fireP)) { vacancies.push(t); news(state, lastDay, 'coach', `[[${state.teams[t].name}]] fires ${c.name}`, t); }
    else if (rng.chance(retireP)) { vacancies.push(t); news(state, lastDay, 'coach', `${c.name} steps down at [[${t}]]`, t); }
  }
  // fill vacancies, best jobs first: a hot coach from a smaller program moves up (his scheme comes along),
  // otherwise a new hire with a fresh scheme
  vacancies.sort((a, b) => state.teams[b].prestige - state.teams[a].prestige);
  const moved = new Set();
  for (const t of vacancies) {
    const T0 = state.teams[t];
    const cand = T.filter(x => x !== t && !moved.has(x) && !vacancies.includes(x) && state.teams[x].coach && !state.teams[x].coach.user
      && state.teams[x].coach.hot > 1.2 && state.teams[x].prestige < T0.prestige - 10).sort((a, b) => state.teams[b].coach.hot - state.teams[a].coach.hot)[0];
    if (cand && rng.chance(0.7)) {
      const C0 = state.teams[cand];
      T0.coach = Object.assign({}, C0.coach, { yrs: 0, hot: 0.5 }); T0.sysDef = Math.round((0.5 * T0.sysDef + 0.5 * C0.sysDef) * 100) / 100;
      news(state, lastDay, 'coach', `[[${T0.name}]] hires ${C0.coach.name} away from [[${cand}]]`, t);
      moved.add(cand); C0.coach = { name: randomName(state, rng), yrs: 0, hot: 0 }; C0.sysDef = Math.round(clamp(rng.normal(0, 2.2), -6, 6) * 100) / 100;
    } else {
      T0.coach = { name: randomName(state, rng), yrs: 0, hot: 0 };
      T0.sysDef = Math.round(clamp(rng.normal(0, 2.5), -6, 6) * 100) / 100;
      news(state, lastDay, 'coach', `[[${T0.name}]] hires ${T0.coach.name}`, t);
    }
  }
  // the user: security, offers, the axe
  const J = state.job, U = state.user, up = state.teams[U].prestige;
  J.seasons++;
  const p = perf[U];
  const jk = (DIFFS[state.diff || 'pro'] || DIFFS.pro).jobK, dj = 14 * p;   // harder levels: losing costs more, winning buys less
  J.security = Math.round(clamp(J.security + (dj < 0 ? dj * jk : dj / Math.sqrt(jk)) - (J.seasons <= 1 ? 0 : 2), 0, 100));
  J.log.push({ year: state.year, perf: Math.round(p * 10) / 10, security: J.security, pre: pre[U], fin: fin[U] });
  J.offers = [];
  if (J.security < 15 && J.seasons >= 2) {
    J.fired = true;
    // a step down: programs with less prestige that need a coach (or will make room for one)
    J.offers = T.filter(t => t !== U && state.teams[t].prestige < up - 8).sort(() => rng.next() - 0.5).slice(0, 3);
    news(state, lastDay, 'coach', `You have been fired at [[${U}]]`, U);
  } else if (p > 0.8 || J.security > 85) {
    const better = T.filter(t => t !== U && state.teams[t].prestige > up + 5 && !state.teams[t].coach.user)
      .sort((a, b) => (vacancies.includes(b) ? 1 : 0) - (vacancies.includes(a) ? 1 : 0) || rng.next() - 0.5);
    J.offers = better.slice(0, p > 2 ? 3 : 2);
  }
  return perf;
}

// take another job: the old program gets a new AI coach, the user moves (mid-offseason)
export function takeJob(state, team) {
  const rng = makeRng(hashSeed(`${state.seed}:${state.year}:take:${team}`));
  const old = state.teams[state.user], nu = state.teams[team];
  const me = old.coach;
  old.coach = { name: randomName(state, rng), yrs: 0, hot: 0 };
  old.minutes = null; old.starters = null;
  nu.coach = Object.assign({}, me, { yrs: 0, user: true });
  nu.minutes = null; nu.starters = null;
  state.user = team;
  state.job = { security: 60, seasons: 0, offers: [], fired: false, log: state.job.log };
  if (state.off) { state.off.offers = {}; state.off.board = {}; }
}
