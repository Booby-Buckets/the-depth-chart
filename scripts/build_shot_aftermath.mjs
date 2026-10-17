#!/usr/bin/env node
/* build_shot_aftermath.mjs — "What happens after the shot?" for D-I men's basketball.
 *
 * For every FIRST-CHANCE field-goal attempt (a shot before the shooting team's first offensive rebound
 * of that possession) it follows the play-by-play: did it go in, what did a miss recover through second
 * chances, and what did the OPPONENT score on its next possession — after the make, or after the
 * defensive rebound. Everything is real points from ESPN play-by-play; nothing is modelled.
 *
 * Possessions are rebuilt from the play log: each shot / free throw / rebound / turnover belongs to the
 * team that has the ball (a rebound gives the ball to the rebounder's team, a turnover is charged to the
 * team that had it), and a possession is a run of events by one team. Its points are that team's
 * points inside the run. Blocks, steals, fouls, substitutions and timeouts carry no possession.
 *
 * Output is COUNTS (not rates), keyed team -> position -> zone, so the page can add up any filter:
 *   [att, made, madePts, miss, missOR, missDR, scPts, oppMakePts, oppMakeN, oppDRPts, oppDRN]
 *   scPts = the shooting team's later points in the same possession after a missed first-chance shot
 * plus the season's league points per possession.
 *
 *   node scripts/build_shot_aftermath.mjs 2026            # one season (~6,000 games)
 *   node scripts/build_shot_aftermath.mjs 2025 2026
 * Writes scripts/data/shot_aftermath/<season>.json.
 * A season in progress (2026-27) builds nightly in shot-analytics.yml: D-I teams come from d1Teams (team_seasons
 * has no rows until a season ends), nothing is written until MIN_GAMES D-I games are final (so an opening-week
 * file never becomes a page's default season), games are parsed in id order and a file whose data didn't change
 * keeps its bytes (and built stamp), so a quiet night commits nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { d1Teams, MIN_GAMES } from './lib_shotfamily.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const SUM = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
const OUT = path.join(HERE, 'data', 'shot_aftermath');
const ZONES = ['rim', 'short', 'long', 'three', 'mid'];   // mid = a two-point jumper the play-by-play gives no distance for (2024-25 logs most as just "Jumper")

async function sb(q) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    let d = null;
    for (let t = 0; t < 6 && d == null; t++) {          // a DNS / network blip shouldn't kill a 30-minute run
      try { const r = await fetch(SB + q + `&limit=1000&offset=${off}`, { headers: H }); if (r.ok) d = await r.json(); } catch {}
      if (d == null) await new Promise((s) => setTimeout(s, 2000 * (t + 1)));
    }
    if (d == null) throw new Error('Supabase unreachable: ' + q);
    out.push(...d);
    if (d.length < 1000) return out;
  }
}
async function espn(id, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(SUM + id); if (r.ok) return await r.json(); } catch {}
    await new Promise((s) => setTimeout(s, 800 * (t + 1)));
  }
  return null;
}

const tt = (p) => (p.type && p.type.text) || '';
const isFG = (p) => p.shootingPlay && !/FreeThrow|Free Throw/i.test(tt(p) + ' ' + (p.text || ''));
const isFT = (p) => p.shootingPlay && /FreeThrow|Free Throw/i.test(tt(p) + ' ' + (p.text || ''));
const isReb = (p) => /Rebound/i.test(tt(p));
// before 2014 ESPN files every foul under the type "Foul Turnover" ("Foul on X"): only a real turnover hands the ball over
const isTO = (p) => /Turnover/i.test(tt(p)) && !/^\s*Foul on/i.test(p.text || '');

// rim = layups / dunks / tips or any two within 4 ft; short mid 5-14 ft; long mid 15+ ft inside the arc
function zoneOf(p) {
  const pa = +p.pointsAttempted || +p.scoreValue || 0;
  if (pa === 3 || /three point/i.test(p.text || '')) return 'three';
  if (/LayUp|Dunk|Tip/i.test(tt(p)) || /layup|dunk|tip/i.test(p.text || '')) return 'rim';
  let d = null;
  const m = /(\d+)-foot/.exec(p.text || '');
  if (m) d = +m[1];
  else if (p.coordinate && isFinite(p.coordinate.x) && isFinite(p.coordinate.y) && !(p.coordinate.x === 25 && p.coordinate.y === 0) && p.coordinate.y >= 0 && p.coordinate.y < 47)
    d = Math.hypot(p.coordinate.x - 25, p.coordinate.y);
  if (d == null) return 'mid';                     // a two-point jumper with no distance: its own row, never dropped
  return d <= 4 ? 'rim' : d <= 14 ? 'short' : 'long';
}

function posMap(s) {
  const out = {};
  for (const t of (s.boxscore && s.boxscore.players) || [])
    for (const st of t.statistics || [])
      for (const a of st.athletes || []) {
        const ab = a.athlete && a.athlete.position && a.athlete.position.abbreviation;
        const g = /C/.test(ab || '') ? 'C' : /F/.test(ab || '') ? 'F' : /G/.test(ab || '') ? 'G' : null;
        if (a.athlete && a.athlete.id && g) out[String(a.athlete.id)] = g;
      }
  return out;
}

const clk = (p) => { const v = String((p.clock && p.clock.displayValue) || '').trim(); const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v); if (m) return +m[1] * 60 + +m[2]; const n = parseFloat(v); return isFinite(n) ? n : null; };
// seconds from the moment a team gets the ball to its first shot / free-throw trip / turnover
const TBUCKET = (d) => d <= 10 ? 'tr' : d <= 20 ? 'early' : d <= 30 ? 'half' : 'late';
const add2 = (o, k, pts) => { const a = (o[k] = o[k] || [0, 0]); a[0]++; a[1] += pts; };

function parse(s, acc, lg, X) {
  const plays = (s.plays || []).filter((p) => p.team && p.team.id);
  const pos = posMap(s);
  // 1. the team with the ball on each possession event
  const ev = [];
  for (const p of plays) {
    const team = String(p.team.id), per = (p.period && p.period.number) || 0;
    if (isFG(p) || isFT(p) || isReb(p) || isTO(p)) ev.push({ p, team, per });
  }
  // 2. possessions = runs of events by one team (a new period always starts one)
  const runs = [];
  for (const e of ev) {
    const last = runs[runs.length - 1];
    if (last && last.team === e.team && last.per === e.per) last.ev.push(e);
    else runs.push({ team: e.team, per: e.per, ev: [e] });
  }
  for (const r of runs) {
    r.pts = r.ev.reduce((a, e) => a + (e.p.scoringPlay && (isFG(e.p) || isFT(e.p)) ? (+e.p.scoreValue || 0) : 0), 0);
    lg.pts += r.pts; lg.poss += 1;
  }
  // 3. first-chance attempts and what followed
  runs.forEach((r, ri) => {
    const next = runs[ri + 1];
    const oppNext = next && next.team !== r.team && next.per === r.per ? next : null;
    for (let i = 0; i < r.ev.length; i++) {
      const e = r.ev[i];
      if (isReb(e.p)) { if (i === 0) continue; break; }   // the defensive rebound that STARTED the possession is not a second chance; a later (offensive) rebound ends the first chance
      if (!isFG(e.p)) continue;
      const z = zoneOf(e.p); if (!z) continue;
      const ath = e.p.participants && e.p.participants[0] && e.p.participants[0].athlete && String(e.p.participants[0].athlete.id);
      const g = (ath && pos[ath]) || 'U';
      const T = (acc[r.team] = acc[r.team] || {}), Pz = (T[g] = T[g] || {}), c = (Pz[z] = Pz[z] || new Array(11).fill(0));
      // the same counts for the shooter himself (player pages); written back after the branch logic below
      const pc = ath ? (((X.players[ath] = X.players[ath] || {})[z]) || (X.players[ath][z] = new Array(11).fill(0))) : null;
      if (ath && g !== 'U') X.ppos[ath] = g;
      const c0 = c.slice();
      c[0]++;
      if (e.p.scoringPlay) {
        c[1]++; c[2] += +e.p.scoreValue || 0;
        // the opponent's next possession after a make (an and-one's free throw stays in this possession)
        if (oppNext) { c[7] += oppNext.pts; c[8]++; }
      } else {
        c[3]++;
        const rest = r.ev.slice(i + 1);
        const reb = rest.find((x) => isReb(x.p));
        if (reb || rest.length) {
          // the shooting team kept the ball: everything it scored later in this possession is second-chance value
          c[4]++;
          c[6] += rest.reduce((a, x) => a + (x.p.scoringPlay && (isFG(x.p) || isFT(x.p)) ? (+x.p.scoreValue || 0) : 0), 0);
        } else if (oppNext && isReb(oppNext.ev[0].p)) {
          c[5]++; c[9] += oppNext.pts; c[10]++;     // defensive rebound: the opponent's possession it started
        }
      }
      if (pc) c.forEach((v, k) => { pc[k] += v - c0[k]; });
      break;                                       // one first-chance attempt per possession
    }
  });
  // 4. how each possession started, and how fast it got its first shot / FT trip / turnover — for the offense
  //    (the team with the ball) and the defense (its opponent)
  const ids = ((s.header && s.header.competitions && s.header.competitions[0] && s.header.competitions[0].competitors) || []).map((c) => String(c.team && c.team.id));
  runs.forEach((r, ri) => {
    const prev = ri > 0 && runs[ri - 1].per === r.per ? runs[ri - 1] : null;
    const def = ids.find((t) => t !== r.team) || (prev && prev.team !== r.team ? prev.team : null);
    if (!def) return;
    const first = r.ev[0].p, last = prev && prev.ev[prev.ev.length - 1].p;
    const st = isReb(first) ? 'dr' : !prev ? 'oth' : isTO(last) ? 'to' : (last.scoringPlay && isFG(last)) ? 'fg' : (last.scoringPlay && isFT(last)) ? 'ft' : 'oth';
    const O = (X.poss[r.team] = X.poss[r.team] || { off: { st: {}, tm: {} }, def: { st: {}, tm: {} } });
    const D = (X.poss[def] = X.poss[def] || { off: { st: {}, tm: {} }, def: { st: {}, tm: {} } });
    add2(O.off.st, st, r.pts); add2(D.def.st, st, r.pts); add2(X.lg.st, st, r.pts);
    const start = isReb(first) ? clk(first) : prev ? clk(last) : (r.per <= 2 ? 1200 : 300);
    const act = r.ev.find((e) => isFG(e.p) || isFT(e.p) || isTO(e.p));
    const t1 = act ? clk(act.p) : null;
    if (start == null || t1 == null) return;
    const d = start - t1;
    if (d < 0 || d > 60) return;                   // clock noise / a missing event
    const b = TBUCKET(d);
    add2(O.off.tm, b, r.pts); add2(D.def.tm, b, r.pts); add2(X.lg.tm, b, r.pts);
  });
  situations(s, runs, ids, X);
  profiles(s, runs, plays, X);
}

// ── 6. SHOT PROFILES (Shot Profile Twin): every player's free throws and rim / mid / three attempts and makes for
// the game (ALL attempts, not just first chances), his minutes, and the possessions his team had while he played
// (team possessions × his share of the game's minutes — the play log has no reliable on-floor record for every
// game, so this is the minutes share, not the stint count). Cols: min, poss, fta, ftm, rimA, rimM, midA, midM, 3A, 3M.
function profiles(s, runs, plays, X) {
  const box = (s.boxscore && s.boxscore.players) || [];
  const maxPer = plays.reduce((m, p) => Math.max(m, (p.period && p.period.number) || 1), 2), gameMin = 40 + 5 * Math.max(0, maxPer - 2);
  const teamPoss = {}; runs.forEach((r) => { teamPoss[r.team] = (teamPoss[r.team] || 0) + 1; });
  const rowOf = (id) => (X.prof[id] = X.prof[id] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (const t of box) {
    const tid = String(t.team && t.team.id);
    for (const st of t.statistics || []) {
      const L = st.labels || [], iM = L.indexOf('MIN'), iF = L.indexOf('FT');
      for (const a of st.athletes || []) {
        const id = a.athlete && a.athlete.id && String(a.athlete.id); if (!id || !a.stats || !a.stats.length) continue;
        const m = parseFloat(a.stats[iM]) || 0; if (m <= 0) continue;
        const ft = String(a.stats[iF] || '0-0').split('-');
        const r = rowOf(id); r[0] += m; r[1] += (teamPoss[tid] || 0) * m / gameMin; r[2] += +ft[1] || 0; r[3] += +ft[0] || 0;
        X.pname[id] = a.athlete.displayName || X.pname[id]; X.pteam[id] = tid;
      }
    }
  }
  for (const p of plays) {
    if (!isFG(p)) continue;
    const z = zoneOf(p), k = z === 'rim' ? 4 : z === 'three' ? 8 : 6;
    // TEAM totals by the shooting team (offense) and its opponent (defense) — every attempt, credited player or not
    const tid = String(p.team.id), opp = Object.keys(teamPoss).find((t) => t !== tid);
    const TO = (X.toff[tid] = X.toff[tid] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); TO[k]++; if (p.scoringPlay) TO[k + 1]++;
    if (opp) { const TD = (X.tdef[opp] = X.tdef[opp] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); TD[k]++; if (p.scoringPlay) TD[k + 1]++; }
    const id = p.participants && p.participants[0] && p.participants[0].athlete && String(p.participants[0].athlete.id); if (!id || !X.prof[id]) continue;
    const r = X.prof[id];
    r[k]++; if (p.scoringPlay) r[k + 1]++;
  }
  // team free throws (offense) and free throws allowed (defense) from the box, plus possessions both ways
  const tids = Object.keys(teamPoss);
  for (const t of box) {
    const tid = String(t.team && t.team.id), opp = tids.find((x) => x !== tid);
    let fta = 0, ftm = 0;
    for (const st of t.statistics || []) { const iF = (st.labels || []).indexOf('FT');
      for (const a of st.athletes || []) { if (!a.stats || !a.stats.length) continue; const ft = String(a.stats[iF] || '0-0').split('-'); fta += +ft[1] || 0; ftm += +ft[0] || 0; } }
    const TO = (X.toff[tid] = X.toff[tid] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); TO[1] += teamPoss[tid] || 0; TO[2] += fta; TO[3] += ftm; TO[0] += 1;
    if (opp) { const TD = (X.tdef[opp] = X.tdef[opp] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); TD[1] += teamPoss[tid] || 0; TD[2] += fta; TD[3] += ftm; TD[0] += 1; }
  }
}

// ── 5. SITUATIONS: the game state each possession started in (team pages + situations.html) ───────────────
// For every possession: was it the first one out of the offense's own timeout (ATO) or a media timeout, the
// first 4:00 of a half, the last 4:00 of a game within 5, a 10+ lead or deficit, the answer to an opponent's
// 8-0 run, and whether the defense had put it in the bonus (7th team foul = one-and-one, 10th = double; fouls
// reset each half, overtime counts with the second half). Plus each team's 8-0 runs made / allowed, its fouls
// and how much of the half was left when it put the opponent in the bonus.
const isFoul = (p) => /Foul/i.test(tt(p)) && (!/Turnover/i.test(tt(p)) || /^\s*Foul on/i.test(p.text || ''));
const isTeamTO = (p) => /TimeOut|Timeout/i.test(tt(p)) && !/Official|TV/i.test(tt(p)) && p.team && p.team.id;
const isTVTO = (p) => /Official|TV/i.test(tt(p)) && /TimeOut|Timeout/i.test(tt(p));
function situations(s, runs, ids, X) {
  const comp = s.header && s.header.competitions && s.header.competitions[0]; if (!comp || ids.length !== 2) return;
  const home = String((comp.competitors.find((c) => c.homeAway === 'home') || {}).team.id);
  const all = s.plays || [], at = new Map(all.map((p, i) => [p, i]));
  const SIT = (t) => (X.sit[t] = X.sit[t] || { off: {}, def: {}, g: 0, run8: 0, run8a: 0, fouls: 0, bonusAt: [] });
  ids.forEach((t) => { SIT(t).g++; });
  // walk every play once: team fouls by half, the score, unanswered-point streaks, bonus moments
  const fouls = {}; let half = 0, st = { team: null, pts: 0, counted: false }, lastH = 0, lastA = 0;
  const state = new Array(all.length);
  all.forEach((p, i) => {
    const per = (p.period && p.period.number) || 1, h = per <= 1 ? 1 : 2;
    if (h !== half) { half = h; ids.forEach((t) => { fouls[t] = 0; }); }
    if (isFoul(p) && p.team && p.team.id) {
      const t = String(p.team.id); fouls[t] = (fouls[t] || 0) + 1;
      if (fouls[t] === 7) SIT(t).bonusAt.push(per <= 2 ? (clk(p) || 0) : 0);
      SIT(t).fouls++;
    }
    const hs = +p.homeScore || 0, as = +p.awayScore || 0;
    if (hs > lastH || as > lastA) {
      const sc = hs > lastH ? home : ids.find((t) => t !== home), pts = (hs - lastH) + (as - lastA);
      if (st.team === sc) st.pts += pts; else st = { team: sc, pts: pts, counted: false };
      if (st.pts >= 8 && !st.counted) { st.counted = true; SIT(sc).run8++; SIT(ids.find((t) => t !== sc)).run8a++; }
      lastH = hs; lastA = as;
    }
    state[i] = { fouls: Object.assign({}, fouls), hs, as, streak: { team: st.team, pts: st.pts } };
  });
  runs.forEach((r, ri) => {
    const def = ids.find((t) => t !== r.team); if (!def) return;
    const prev = ri > 0 && runs[ri - 1].per === r.per ? runs[ri - 1] : null;
    const firstI = at.get(r.ev[0].p), act = r.ev.find((e) => isFG(e.p) || isFT(e.p) || isTO(e.p)), actI = act ? at.get(act.p) : firstI;
    const prevI = prev ? at.get(prev.ev[prev.ev.length - 1].p) : -1;
    if (firstI == null || actI == null) return;
    const before = state[Math.max(0, (prevI >= 0 ? prevI : firstI - 1))] || state[firstI];
    const keys = [];
    let ato = false, tv = false;
    for (let i = prevI + 1; i < actI; i++) { const p = all[i]; if (isTeamTO(p) && String(p.team.id) === r.team) ato = true; else if (isTVTO(p)) tv = true; }
    if (ato) keys.push('ato'); else if (tv) keys.push('tvto');
    const p0 = r.ev[0].p, per = r.per, c0 = clk(prev ? prev.ev[prev.ev.length - 1].p : p0);
    const offScore = r.team === home ? before.hs : before.as, defScore = r.team === home ? before.as : before.hs, mg = offScore - defScore;
    if (per <= 2 && c0 != null && c0 >= 960) keys.push(per === 1 ? 'start1' : 'start2');
    if (per >= 2 && c0 != null && c0 <= 240 && Math.abs(mg) <= 5) keys.push('close');
    if (mg >= 10) keys.push('lead10'); else if (mg <= -10) keys.push('trail10');
    if (before.streak && before.streak.team === def && before.streak.pts >= 8) keys.push('afterrun');
    const df = (state[actI] && state[actI].fouls[def]) || 0;
    keys.push(df >= 10 ? 'bonus2' : df >= 7 ? 'bonus1' : 'nobonus');
    keys.forEach((k) => { add2(SIT(r.team).off, k, r.pts); add2(SIT(def).def, k, r.pts); add2(X.lg.sit, k, r.pts); });
  });
}

// write a season file only when its data changed (the built stamp alone doesn't count): a quiet night commits nothing
function put(dst, text) {
  try { const old = JSON.parse(fs.readFileSync(dst, 'utf8')); if (JSON.stringify({ ...old, built: 0 }) === JSON.stringify({ ...JSON.parse(text), built: 0 })) return; } catch {}
  fs.writeFileSync(dst, text);
}

async function season(y) {
  const t0 = Date.now();
  const ts = await d1Teams(sb, y, path.join(HERE, 'data'));
  const d1 = new Set(ts.map((t) => String(t.team_id)));
  const games = (await sb(`games?season_year=eq.${y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc`))
    .filter((g) => d1.has(String(g.home_id)) && d1.has(String(g.away_id)));   // D-I vs D-I only
  if (games.length < MIN_GAMES) { console.log(`shot_aftermath ${y}: only ${games.length} D-I games final — waiting for ${MIN_GAMES} before building`); return; }
  const acc = {}, lg = { pts: 0, poss: 0 }, X = { players: {}, ppos: {}, poss: {}, sit: {}, prof: {}, pname: {}, pteam: {}, toff: {}, tdef: {}, lg: { st: {}, tm: {}, sit: {} } };
  let done = 0, empty = 0;
  // fetch 8 at a time but parse strictly in game-id order: key order and 'last one wins' names/teams then don't
  // depend on which download finished first, so an unchanged season rebuilds byte-identical
  const got = new Map(); let next = 0, ptr = 0;
  const drain = () => {
    while (got.has(ptr)) {
      const s = got.get(ptr); got.delete(ptr); ptr++; done++;
      if (!s || !(s.plays || []).length) empty++;
      else try { parse(s, acc, lg, X); } catch (e) { empty++; }
      if (done % 500 === 0) process.stdout.write(`  ${y}: ${done}/${games.length} games\n`);
    }
  };
  async function worker() {
    while (next < games.length) {
      const i = next++;
      got.set(i, await espn(games[i].id));
      drain();
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const teams = {};
  for (const t of ts) if (t.team_id != null) teams[String(t.team_id)] = 1;
  fs.mkdirSync(OUT, { recursive: true });
  const out = { season: y, built: new Date().toISOString(), games: games.length - empty, missing: empty,
    league_ppp: lg.poss ? +(lg.pts / lg.poss).toFixed(4) : null, possessions: lg.poss,
    cols: ['att', 'made', 'madePts', 'miss', 'missOR', 'missDR', 'scPts', 'oppMakePts', 'oppMakeN', 'oppDRPts', 'oppDRN'],
    zones: ZONES, data: acc };
  put(path.join(OUT, `${y}.json`), JSON.stringify(out));
  // per-team possession starts + timing (team pages) and per-player first-chance shot counts (player pages)
  put(path.join(OUT, `poss_${y}.json`), JSON.stringify({ season: y, built: out.built, league_ppp: out.league_ppp, league: X.lg, teams: X.poss,
    starts: { fg: 'after a made field goal', ft: 'after made free throws', dr: 'after a defensive rebound', to: 'after a turnover', oth: 'other (period start, dead balls)' },
    times: { tr: '0-10 s', early: '11-20 s', half: '21-30 s', late: '31+ s' } }));
  // league runs / fouls per game for the situations baselines
  const sv = Object.values(X.sit), gsum = sv.reduce((a, t) => a + t.g, 0) || 1;
  X.lg.run8 = sv.reduce((a, t) => a + t.run8, 0) / gsum; X.lg.fouls = sv.reduce((a, t) => a + t.fouls, 0) / gsum;
  const ba = sv.flatMap((t) => t.bonusAt); X.lg.bonusAt = ba.length ? ba.reduce((a, b) => a + b, 0) / ba.length : null;
  X.lg.bonusHalves = ba.length / Math.max(1, gsum * 2);
  for (const t of sv) { t.bonusN = t.bonusAt.length; t.bonusAt = t.bonusAt.length ? +(t.bonusAt.reduce((a, b) => a + b, 0) / t.bonusAt.length).toFixed(1) : null; }
  put(path.join(OUT, `sit_${y}.json`), JSON.stringify({ season: y, built: out.built, league_ppp: out.league_ppp, league: { sit: X.lg.sit, run8: +X.lg.run8.toFixed(3), fouls: +X.lg.fouls.toFixed(2), bonusAt: X.lg.bonusAt != null ? +X.lg.bonusAt.toFixed(1) : null, bonusHalves: +X.lg.bonusHalves.toFixed(3) }, teams: X.sit,
    keys: { ato: 'out of their own timeout', tvto: 'out of a media timeout', start1: 'first 4:00 of the game', start2: 'first 4:00 of the second half', close: 'last 4:00, within 5', lead10: 'leading by 10+', trail10: 'trailing by 10+', afterrun: 'right after an opponent 8-0 run', nobonus: 'opponent not in the bonus', bonus1: 'in the one-and-one', bonus2: 'in the double bonus' } }));
  // shot profiles: every player with 100+ minutes (rounded to keep the file small)
  const prof = {};
  for (const [id, r] of Object.entries(X.prof)) if (r[0] >= 100) prof[id] = r.map((v, i) => (i <= 1 ? Math.round(v) : v));
  put(path.join(OUT, `prof_${y}.json`), JSON.stringify({ season: y, built: out.built, cols: ['min', 'poss', 'fta', 'ftm', 'rimA', 'rimM', 'midA', 'midM', 'threeA', 'threeM'],
    players: prof, names: Object.fromEntries(Object.keys(prof).map((id) => [id, X.pname[id]])), team: Object.fromEntries(Object.keys(prof).map((id) => [id, X.pteam[id]])),
    pos: Object.fromEntries(Object.keys(prof).filter((id) => X.ppos[id]).map((id) => [id, X.ppos[id]])) }));
  // team shot profiles, offense and defense: [games, possessions, fta, ftm, rimA, rimM, midA, midM, 3A, 3M]
  put(path.join(OUT, `tprof_${y}.json`), JSON.stringify({ season: y, built: out.built, cols: ['games', 'poss', 'fta', 'ftm', 'rimA', 'rimM', 'midA', 'midM', 'threeA', 'threeM'], off: X.toff, def: X.tdef }));
  put(path.join(OUT, `players_${y}.json`), JSON.stringify({ season: y, built: out.built, league_ppp: out.league_ppp, cols: out.cols, pos: X.ppos, data: X.players }));
  const all = Object.values(acc).flatMap((T) => Object.values(T).flatMap((P) => Object.values(P)));
  const att = all.reduce((a, c) => a + c[0], 0);
  console.log(`shot_aftermath ${y}: ${games.length} games (${empty} without play-by-play), ${lg.poss.toLocaleString()} possessions, league PPP ${out.league_ppp}, ${att.toLocaleString()} first-chance attempts, ${Math.round((Date.now() - t0) / 1000)}s`);
}

const args = process.argv.slice(2).map(Number).filter(Boolean);
const ys = args.length === 2 ? Array.from({ length: args[1] - args[0] + 1 }, (_, i) => args[0] + i) : args;
for (const y of ys) await season(y);
// index of every built season (the page's season picker): coverage + how much of it has shot distances
const idx = [];
for (const f of fs.readdirSync(OUT)) {
  const m = /^(\d{4})\.json$/.exec(f); if (!m) continue;
  const d = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  const z = {}; for (const T of Object.values(d.data)) for (const P of Object.values(T)) for (const [k, c] of Object.entries(P)) z[k] = (z[k] || 0) + c[0];
  const tot = Object.values(z).reduce((a, b) => a + b, 0);
  idx.push({ season: d.season, games: d.games, missing: d.missing, league_ppp: d.league_ppp, attempts: tot, no_distance_share: tot ? +((z.mid || 0) / tot).toFixed(3) : 0 });
}
idx.sort((a, b) => a.season - b.season);
// rewrite the index only when the season list changes, so a night with nothing new commits nothing
let had = null; try { had = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')).seasons; } catch {}
if (JSON.stringify(had) !== JSON.stringify(idx)) fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ built: new Date().toISOString(), seasons: idx }, null, 1));
