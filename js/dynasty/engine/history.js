// The record books (Oct 2026): the league's history (every season's champions, Final Four, title game, NIT / CBI,
// conference regular-season + tournament champions, national award winners), the user coach's TROPHY ROOM
// (rivalry wins, event titles, conference titles, March, coach + player awards), the season's legacy points
// (legacy.js), BREAKOUT seasons (a player who far outplays his rating raises his ceiling) and the conference
// standings tiebreakers (head-to-head among the tied teams, then record vs the teams above, then power).
// Pure: works on the state object.
import { record_, power } from './season.js?v=73';
import { postResult } from './postseason.js?v=73';
import { mteFinish } from './mte.js?v=73';
import { seasonLegacy } from './legacy.js?v=73';
import { effOvr } from './league.js?v=73';
import { news } from './injuries.js?v=73';

const gmsc = s => (s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.orb + 0.3 * s.drb + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * s.pf - s.tov);

// ── conference standings with tiebreakers ──
/** rows of one conference, ordered: league win%, then head-to-head among the tied, then record vs the teams that
 *  finished above the tie, then power */
export function tieBreak(state, rows, pwIn) {
  const pct = (w, l) => (w + l ? w / (w + l) : 0);
  const h2h = {};                                       // 'a|b' -> a's league wins over b
  const inConf = new Set(rows.map(r => r.team));
  for (const g of state.schedule) if (g.r && g.c && inConf.has(g.h) && inConf.has(g.a)) { const w = g.r[0] > g.r[1] ? g.h : g.a, l = w === g.h ? g.a : g.h; h2h[w + '|' + l] = (h2h[w + '|' + l] || 0) + 1; }
  let pw = pwIn || null; const PW = () => (pw = pw || power(state));   // power only if a tie needs it
  rows.sort((a, b) => pct(b.cw, b.cl) - pct(a.cw, a.cl) || (b.cw - a.cw));
  const out = [];
  for (let i = 0; i < rows.length;) {
    let j = i; while (j < rows.length && pct(rows[j].cw, rows[j].cl) === pct(rows[i].cw, rows[i].cl) && rows[j].cw === rows[i].cw) j++;
    const tie = rows.slice(i, j);
    if (tie.length > 1) {
      const above = out.map(r => r.team);
      const hh = t => tie.reduce((s, o) => s + (h2h[t + '|' + o.team] || 0) - (h2h[o.team + '|' + t] || 0), 0);
      const va = t => above.reduce((s, o) => s + (h2h[t + '|' + o] || 0) - (h2h[o + '|' + t] || 0), 0);
      tie.forEach(r => { r.tb = hh(r.team) !== 0 ? 'head-to-head' : va(r.team) !== 0 ? 'vs. the top' : 'power'; });
      tie.sort((a, b) => hh(b.team) - hh(a.team) || va(b.team) - va(a.team) || (PW()[b.team] || 0) - (PW()[a.team] || 0));
    }
    out.push(...tie); i = j;
  }
  return out;
}
/** points for / against in league + all games, for the standings */
export function margins(state) {
  const m = {};
  for (const g of state.schedule) if (g.r && !g.t) for (const [t, us, them] of [[g.h, g.r[0], g.r[1]], [g.a, g.r[1], g.r[0]]]) { const x = m[t] = m[t] || { pf: 0, pa: 0, g: 0 }; x.pf += us; x.pa += them; x.g++; }
  return m;
}

// ── the end of a season: league history, trophies, legacy, breakouts ──
export function recordSeason(state, perfU) {
  const U = state.user, P = state.post || {}, N = P.ncaa, y = state.year, d = state.schedule.reduce((m, g) => (g.d > m ? g.d : m), '');
  const pw = power(state), order = Object.keys(pw).sort((a, b) => pw[b] - pw[a]), top25 = new Set(order.slice(0, 25));
  // the title game + the Final Four
  let final = null, ff = [];
  if (N && N.main) {
    const R = N.main.rounds, fr = R[R.length - 1] && R[R.length - 1][0] && R[R.length - 1][0].team ? R[R.length - 2] : R[R.length - 1];
    const fg = fr && fr[0] && fr[0].game && state.schedule.find(g => g.id === fr[0].game);
    if (fg && fg.r) final = { w: fg.r[0] > fg.r[1] ? fg.h : fg.a, l: fg.r[0] > fg.r[1] ? fg.a : fg.h, s: `${Math.max(fg.r[0], fg.r[1])}-${Math.min(fg.r[0], fg.r[1])}${fg.r[2] ? ' OT' : ''}` };
    const semis = R.find(rd => rd.length === 2 && rd.every(s => s && s.game));
    if (semis) ff = semis.flatMap(s => [s.h.team, s.a.team]);
  }
  const conf = {};
  const st = {}; for (const t of Object.values(state.teams)) (st[t.conf] = st[t.conf] || []).push(Object.assign({ team: t.name }, record_(state, t.name)));
  for (const [c, rows] of Object.entries(st)) conf[c] = { reg: tieBreak(state, rows, pw)[0].team, tour: P.conf && P.conf[c] ? P.conf[c].champ : null };
  const A = state.awards || {};
  const coachOf = t => (t && state.teams[t] && state.teams[t].coach ? state.teams[t].coach.name : null);
  (state.leagueHist = state.leagueHist || []).push({
    y, champ: N && N.champ, coach: coachOf(N && N.champ), rec: N && N.champ ? (r => `${r.w}-${r.l}`)(record_(state, N.champ)) : '', final, ff,
    nit: P.nit && P.nit.champ, cbi: P.cbi && P.cbi.champ, conf,
    poy: A.poy ? { name: A.poy.name, team: A.poy.team } : null, dpoy: A.dpoy ? { name: A.dpoy.name, team: A.dpoy.team } : null,
    fr: A.fr ? { name: A.fr.name, team: A.fr.team } : null, coy: A.coy ? { name: A.coy.coach, team: A.coy.team } : null,
    top: order.slice(0, 5),
  });
  if (!U) return;
  // the trophy room (the user's coach — it travels with him)
  const T = state.trophies = state.trophies || [];
  const add = (kind, name, extra = {}) => { T.push(Object.assign({ y, kind, name, team: U }, extra)); news(state, d, 'title', `🏆 ${name}`, U); };
  const uc = state.teams[U].conf;
  for (const g of state.schedule) {
    if (!g.r || g.t || (g.h !== U && g.a !== U) || g.k !== 'rivalry') continue;
    const opp = g.h === U ? g.a : g.h, won = (g.h === U) === (g.r[0] > g.r[1]);
    if (won) T.push({ y, kind: 'rivalry', name: `Rivalry win vs [[${opp}]]`, team: U, opp, score: `${Math.max(g.r[0], g.r[1])}-${Math.min(g.r[0], g.r[1])}` });
  }
  for (const m of state.mtes || []) { const f = mteFinish(state, m); if (f.champ === U) add('event', `${m.name} champions`); }
  if (conf[uc] && conf[uc].reg === U) add('conf', 'Regular-season conference champions', { conf: uc });
  if (conf[uc] && conf[uc].tour === U) add('conf', 'Conference tournament champions', { conf: uc });
  const post = postResult(state, U);
  if (post === 'Champion') add('title', 'National champions');
  else if (['Final Four', 'Runner-up'].includes(post)) add('ff', post === 'Runner-up' ? 'National runner-up' : 'Final Four');
  if (post === 'NIT Champion') add('nit', 'NIT champions'); if (post === 'CBI Champion') add('nit', 'CBI champions');
  const awardsU = [];
  const pAward = (x, lbl, n) => { if (x && x.team === U) { T.push({ y, kind: 'award', name: `${lbl}: ${x.name}`, team: U }); awardsU.push({ n, why: `${x.name}: ${lbl}` }); } };
  pAward(A.poy, 'National Player of the Year', 80); pAward(A.dpoy, 'Defensive Player of the Year', 30); pAward(A.fr, 'Freshman of the Year', 25); pAward(A.smoy, 'Sixth Man of the Year', 15); pAward(A.mip, 'Most Improved Player', 15);
  for (const [k, l, n] of [['aa1', '1st-team All-American', 40], ['aa2', '2nd-team All-American', 30], ['aa3', '3rd-team All-American', 20]]) for (const x of A[k] || []) pAward(x, l, n);
  if (A.conf && A.conf[uc]) pAward(A.conf[uc], 'Conference Player of the Year', 20);
  const coy = A.coy && A.coy.team === U, confCoy = A.confCoy && A.confCoy[uc] && A.confCoy[uc].team === U;
  if (coy) T.push({ y, kind: 'coach', name: 'National Coach of the Year', team: U });
  if (confCoy) T.push({ y, kind: 'coach', name: 'Conference Coach of the Year', team: U, conf: uc });
  // the season's legacy points
  const rankedWins = state.schedule.filter(g => g.r && (g.h === U || g.a === U) && (g.h === U) === (g.r[0] > g.r[1]) && top25.has(g.h === U ? g.a : g.h)).length;
  seasonLegacy(state, { w: record_(state, U).w, perf: perfU || 0, post: post && !/NIT|CBI/.test(post) ? post : null, nit: post === 'NIT Champion',
    confReg: conf[uc] && conf[uc].reg === U, confTour: conf[uc] && conf[uc].tour === U, rankedWins, drafted: [], awards: awardsU, coy, confCoy });
}

/** breakout seasons: a player who far outplays his rating (game score per 40 vs what his OVR predicts) grows his ceiling */
export function breakouts(state) {
  const rows = [];
  for (const [id, s] of Object.entries(state.stats)) {
    const p = state.players[id]; if (!p || !p.team || !s.g || s.min / s.g < 12 || p.yr >= 4) continue;
    rows.push({ p, o: effOvr(p, state), v: gmsc(s) / s.min * 40 });
  }
  if (rows.length < 50) return [];
  const n = rows.length, mo = rows.reduce((a, r) => a + r.o, 0) / n, mv = rows.reduce((a, r) => a + r.v, 0) / n;
  const b = rows.reduce((a, r) => a + (r.o - mo) * (r.v - mv), 0) / rows.reduce((a, r) => a + (r.o - mo) ** 2, 0);
  const res = rows.map(r => Object.assign(r, { e: r.v - (mv + b * (r.o - mo)) }));
  const sd = Math.sqrt(res.reduce((a, r) => a + r.e * r.e, 0) / n);
  const out = [];
  for (const r of res) if (r.e > 1.6 * sd) {
    const up = Math.round(Math.min(6, 2 + (r.e / sd - 1.6) * 3) * 10) / 10;
    r.p.pot = Math.round(((r.p.pot || 0) + up) * 10) / 10; if (r.p.arc === 'bust') r.p.arc = null;
    out.push({ id: r.p.id, name: r.p.name, team: r.p.team, up });
    if (r.p.team === state.user) news(state, `${state.year}-04-10`, 'award', `${r.p.name}'s breakout season raised his ceiling (+${up} potential)`, state.user, r.p);
  }
  return out;
}
