// Season awards, computed when the season ends (Oct 2026 expansion):
//   national — Player of the Year, All-America 1st / 2nd / 3rd teams, Defensive POY, Freshman of the Year, Sixth Man
//              of the Year, Most Improved, Coach of the Year
//   every conference — POY, DPOY, Freshman, Sixth Man, Coach of the Year, All-Conference 1st / 2nd (/ 3rd for 10+
//              team leagues), All-Freshman and All-Defensive teams
// Player value = Hollinger game score per game, scaled by team success and by the team's power rank (voters weigh
// competition — a low-major's 28 ppg doesn't beat a power-conference star's 20). Coaches: how far the team finished
// above its preseason roster rating, plus winning. Every honoree also carries the honor (p.hon) for his card; the
// season history keeps the compact version (no full conference teams).
import { record_, power } from './season.js?v=56';
import { powerFeatures, effOvr } from './league.js?v=56';
import { news } from './injuries.js?v=56';

const gmsc = s => (s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.orb + 0.3 * s.drb + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * s.pf - s.tov) / s.g;
export const CONF_LABEL = { B10: 'Big Ten', 'BIG-12': 'Big 12', 'Big-East': 'Big East', 'PAC-12': 'Pac-12', AEC: 'America East', MWC: 'Mountain West', CUSA: 'Conference USA',
  A10: 'Atlantic 10', AAC: 'American', MVC: 'Missouri Valley', WCC: 'West Coast', MAAC: 'MAAC', SoCon: 'Southern', UAC: 'United Athletic' };
export const confLabel = c => CONF_LABEL[c] || c;
const seasonLbl = y => `${y - 1}-${String(y).slice(2)}`;

export function computeAwards(state) {
  const maxG = Math.max(0, ...Object.values(state.stats).map(s => s.g));
  const rows = [];
  const wp = {}, rec = {};
  for (const t of Object.keys(state.teams)) { const r = rec[t] = record_(state, t); wp[t] = (r.w + r.l) ? r.w / (r.w + r.l) : 0; }
  const pw = power(state), ord = Object.keys(pw).sort((a, b) => pw[b] - pw[a]);
  const pct = Object.fromEntries(ord.map((t, i) => [t, 1 - i / (ord.length - 1)]));
  for (const [id, s] of Object.entries(state.stats)) {
    const p = state.players[id]; if (!p || !p.team || s.g < Math.max(5, 0.6 * maxG)) continue;
    const team = s.team || p.team;
    const v = gmsc(s) * (0.55 + 0.25 * (wp[team] || 0) + 0.5 * (pct[team] ?? 0.5) ** 1.5);
    const d = (s.stl + s.blk) / s.g + 0.5 * (p.pillars.DEF - 50) / 15 + 0.6 * s.drb / s.g / 6;
    const prev = p.hist && p.hist.length ? p.hist.at(-1).ovr : null;
    rows.push({ id, name: p.name, team, yr: p.yr, conf: state.teams[team] && state.teams[team].conf, v, d, mpg: s.min / s.g, bench: (s.gs || 0) / s.g <= 0.3,
      gain: prev == null ? null : effOvr(p, state) - prev, line: { ppg: s.pts / s.g, rpg: (s.orb + s.drb) / s.g, apg: s.ast / s.g } });
  }
  rows.sort((a, b) => b.v - a.v);
  const pick = r => r && { id: r.id, name: r.name, team: r.team, yr: r.yr, ppg: +r.line.ppg.toFixed(1), rpg: +r.line.rpg.toFixed(1), apg: +r.line.apg.toFixed(1) };
  const byD = list => list.filter(r => r.mpg >= 15).sort((a, b) => b.d - a.d);
  const sixth = list => list.find(r => r.bench && r.mpg >= 14);
  // coaches: finish above the preseason roster rating, plus winning
  const coachScore = {};
  for (const t of Object.values(state.teams)) {
    const prior = powerFeatures(t, state.players, state.maps).reduce((s, x, i) => s + x * state.powerFit[i], 0);
    coachScore[t.name] = (pw[t.name] - prior) + 6 * (wp[t.name] - 0.5);
  }
  const coachOf = t => ({ team: t, coach: (state.teams[t].coach && state.teams[t].coach.name) || null, w: rec[t].w, l: rec[t].l, cw: rec[t].cw, cl: rec[t].cl });
  const coyTeam = Object.keys(state.teams).filter(t => rec[t].w > rec[t].l).sort((a, b) => coachScore[b] - coachScore[a])[0];
  const mip = rows.filter(r => r.gain != null && r.mpg >= 20).sort((a, b) => b.gain - a.gain)[0];

  const A = {
    year: state.year,
    poy: pick(rows[0]), aa1: rows.slice(0, 5).map(pick), aa2: rows.slice(5, 10).map(pick), aa3: rows.slice(10, 15).map(pick),
    dpoy: pick(byD(rows)[0]), fr: pick(rows.find(r => r.yr === 1)), smoy: pick(sixth(rows)), mip: mip ? Object.assign(pick(mip), { gain: Math.round(mip.gain) }) : null,
    coy: coyTeam ? coachOf(coyTeam) : null, conf: {}, confCoy: {}, cf: {},
  };
  // every conference
  const confs = {}; for (const t of Object.values(state.teams)) (confs[t.conf] = confs[t.conf] || []).push(t.name);
  for (const [c, teams] of Object.entries(confs)) {
    const R = rows.filter(r => r.conf === c);
    if (!R.length) continue;
    const ct = teams.filter(t => rec[t].cw + rec[t].cl > 0).sort((a, b) => coachScore[b] + 4 * (rec[b].cw - rec[b].cl) / Math.max(1, rec[b].cw + rec[b].cl) - coachScore[a] - 4 * (rec[a].cw - rec[a].cl) / Math.max(1, rec[a].cw + rec[a].cl));
    const big = teams.length >= 10;
    A.conf[c] = pick(R[0]);
    A.confCoy[c] = ct[0] ? coachOf(ct[0]) : null;
    A.cf[c] = { poy: pick(R[0]), dpoy: pick(byD(R)[0]), fr: pick(R.find(r => r.yr === 1)), smoy: pick(sixth(R)), coy: A.confCoy[c],
      t1: R.slice(0, 5).map(pick), t2: R.slice(5, 10).map(pick), t3: big ? R.slice(10, 15).map(pick) : [],
      frT: R.filter(r => r.yr === 1).slice(0, 5).map(pick), defT: byD(R).slice(0, 5).map(pick) };
  }
  state.awards = A;
  honor(state, A);
  const lastDay = state.schedule.reduce((m, g) => (g.d > m ? g.d : m), '');
  if (A.poy) news(state, lastDay, 'award', `${A.poy.name} ([[${A.poy.team}]]) is National Player of the Year — ${A.poy.ppg} ppg`, A.poy.team);
  const U = state.user;
  for (const [k, l] of [['aa1', 'first'], ['aa2', 'second'], ['aa3', 'third']]) for (const r of A[k]) if (r && r.team === U) news(state, lastDay, 'award', `${r.name} named ${l}-team All-American`, U);
  if (A.coy && A.coy.team === U) news(state, lastDay, 'award', `You are the National Coach of the Year`, U);
  const mine = A.cf[state.teams[U] && state.teams[U].conf];
  if (mine) {
    if (mine.coy && mine.coy.team === U) news(state, lastDay, 'award', `You are the ${confLabel(state.teams[U].conf)} Coach of the Year`, U);
    for (const [k, l] of [['t1', '1st'], ['t2', '2nd'], ['t3', '3rd']]) for (const r of mine[k]) if (r && r.team === U) news(state, lastDay, 'award', `${r.name}: All-${confLabel(state.teams[U].conf)} ${l} team`, U);
  }
  return A;
}

// every honoree carries the honor on his own record (the player card), so the season history can stay compact
function honor(state, A) {
  const y = seasonLbl(A.year), add = (r, txt) => { const p = r && state.players[r.id]; if (p) { (p.hon = p.hon || []).push(`${y} ${txt}`); if (p.hon.length > 24) p.hon.shift(); } };
  add(A.poy, 'National Player of the Year'); add(A.dpoy, 'National Defensive POY'); add(A.fr, 'National Freshman of the Year');
  add(A.smoy, 'National Sixth Man of the Year'); add(A.mip, 'Most Improved Player');
  A.aa1.forEach(r => add(r, '1st-team All-American')); A.aa2.forEach(r => add(r, '2nd-team All-American')); A.aa3.forEach(r => add(r, '3rd-team All-American'));
  for (const [c, F] of Object.entries(A.cf)) {
    const L = confLabel(c);
    add(F.poy, `${L} Player of the Year`); add(F.dpoy, `${L} Defensive POY`); add(F.fr, `${L} Freshman of the Year`); add(F.smoy, `${L} Sixth Man`);
    F.t1.forEach(r => add(r, `All-${L} 1st team`)); F.t2.forEach(r => add(r, `All-${L} 2nd team`)); F.t3.forEach(r => add(r, `All-${L} 3rd team`));
    F.frT.forEach(r => add(r, `${L} All-Freshman`)); F.defT.forEach(r => add(r, `${L} All-Defensive`));
  }
}

/** the season's awards as kept in history: everything but the full conference teams */
export function compactAwards(A) { if (!A) return null; const { cf, ...rest } = A; return rest; }
