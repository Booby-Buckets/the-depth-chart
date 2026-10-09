// Season awards, computed when the season ends: National Player of the Year, All-America first and second teams,
// Defensive POY, Freshman of the Year, Coach of the Year, and every conference's Player of the Year.
// Player value = Hollinger game score per game, scaled by team success and by the team's power rank (voters weigh
// competition — a low-major's 28 ppg doesn't beat a power-conference star's 20).
import { record_, power } from './season.js?v=12';
import { powerFeatures } from './league.js?v=12';
import { news } from './injuries.js?v=12';

const gmsc = s => (s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.orb + 0.3 * s.drb + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * s.pf - s.tov) / s.g;

export function computeAwards(state) {
  const maxG = Math.max(0, ...Object.values(state.stats).map(s => s.g));
  const rows = [];
  const wp = {};
  for (const t of Object.keys(state.teams)) { const r = record_(state, t); wp[t] = (r.w + r.l) ? r.w / (r.w + r.l) : 0; }
  // voters weigh competition: value scales with where the team finished in the power ranking (0..1)
  const pw0 = power(state), ord = Object.keys(pw0).sort((a, b) => pw0[b] - pw0[a]);
  const pct = Object.fromEntries(ord.map((t, i) => [t, 1 - i / (ord.length - 1)]));
  for (const [id, s] of Object.entries(state.stats)) {
    const p = state.players[id]; if (!p || !p.team || s.g < Math.max(5, 0.6 * maxG)) continue;
    const team = s.team || p.team;
    const v = gmsc(s) * (0.55 + 0.25 * (wp[team] || 0) + 0.5 * (pct[team] ?? 0.5) ** 1.5);
    const d = (s.stl + s.blk) / s.g + 0.5 * (p.pillars.DEF - 50) / 15 + 0.6 * s.drb / s.g / 6;
    rows.push({ id, name: p.name, team, yr: p.yr, conf: state.teams[team] && state.teams[team].conf, v, d,
      line: { ppg: s.pts / s.g, rpg: (s.orb + s.drb) / s.g, apg: s.ast / s.g } });
  }
  rows.sort((a, b) => b.v - a.v);
  const pick = r => r && { id: r.id, name: r.name, team: r.team, ppg: +r.line.ppg.toFixed(1), rpg: +r.line.rpg.toFixed(1), apg: +r.line.apg.toFixed(1) };
  const conf = {};
  for (const r of rows) if (r.conf && !conf[r.conf]) conf[r.conf] = pick(r);
  // coach of the year: biggest jump over the preseason roster prior, among winning teams
  const pw = power(state);
  let coy = null, best = -1e9;
  for (const t of Object.values(state.teams)) {
    const r = record_(state, t.name); if (r.w <= r.l) continue;
    const prior = powerFeatures(t, state.players, state.maps).reduce((s, x, i) => s + x * state.powerFit[i], 0);
    const lift = pw[t.name] - prior;
    if (lift > best) { best = lift; coy = { team: t.name, coach: (t.coach && t.coach.name) || null, w: r.w, l: r.l }; }
  }
  const A = {
    year: state.year,
    poy: pick(rows[0]), aa1: rows.slice(0, 5).map(pick), aa2: rows.slice(5, 10).map(pick),
    dpoy: pick(rows.slice().sort((a, b) => b.d - a.d)[0]),
    fr: pick(rows.find(r => r.yr === 1)),
    coy, conf,
  };
  state.awards = A;
  const lastDay = state.schedule.reduce((m, g) => (g.d > m ? g.d : m), '');
  if (A.poy) news(state, lastDay, 'award', `${A.poy.name} ([[${A.poy.team}]]) is National Player of the Year — ${A.poy.ppg} ppg`, A.poy.team);
  for (const r of [...A.aa1, ...A.aa2]) if (r && r.team === state.user) news(state, lastDay, 'award', `${r.name} named ${A.aa1.includes(r) ? 'first' : 'second'}-team All-American`, r.team);
  return A;
}
