#!/usr/bin/env node
/* build_runs_droughts.mjs — "How do runs and droughts happen?" for D-I men's basketball, from ESPN play-by-play.
 *
 * Every game is rebuilt into possessions (the same rule as build_shot_aftermath.mjs: shots / free throws / rebounds /
 * turnovers belong to the team with the ball; a possession is a stretch of events by one team). Then:
 *
 *   SURGE   — a stretch of 8+ (and 10+) unanswered points by one team. Each one records its SPARK: how the
 *             surging team's first scoring possession started (steal, dead-ball turnover, defensive rebound off a
 *             block / missed free throw / missed shot, after an opponent make) plus transition / second-chance / three.
 *   DRY SPELL — a team going 4:00+ of game clock (or 6+ straight possessions) without a made field goal.
 *
 * The study side measures every trigger against a fair baseline instead of anecdotes:
 *   - N8 at every possession boundary: are the NEXT 8 points in the game all one team's? The baseline is every
 *     boundary with the same team holding the ball and the same season-strength gap, so "a steal sparks runs" is
 *     compared to every other possession that team started with the ball, not to the league at large.
 *   - A shuffle null: each team's possession results are shuffled within the game (the alternation and the slots stay)
 *     — how many 10-0 runs and 6-possession dry spells would independent possessions give?
 *   - Timeouts: when a team is down 8+ unanswered, what happens next after its own timeout vs a TV timeout (fixed by
 *     the clock, so a natural experiment) vs no stoppage — net points over the next six possessions vs the strength
 *     expectation.
 *   - Team / coach: surges for and against, dry spells, and the ANSWER margin (net points over the six possessions
 *     after conceding a run hits 8, vs expectation).
 *
 * ESPN summaries come from scripts/data/espn_pbp_cache/ (git-ignored, gzipped; fetched and cached when missing).
 *
 *   node scripts/build_runs_droughts.mjs 2025 2026
 * Writes scripts/data/runs_droughts/<season>.json (per-team + per-game surge list) and study_<seasons>.json (pooled findings).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const CACHE = path.join(HERE, 'data', 'espn_pbp_cache');
const OUT = path.join(HERE, 'data', 'runs_droughts'); fs.mkdirSync(OUT, { recursive: true });
const SEASONS = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);
if (!SEASONS.length) SEASONS.push(2026);
const DRY_SECS = 240, DRY_POSS = 6, NEXT_POSS = 6, SHUFFLES = 10;

async function sb(q) {   // paginated with a stable order (supabase-pagination-order)
  const out = [];
  for (let off = 0; ; off += 1000) {
    let d = null;
    for (let t = 0; t < 6 && !Array.isArray(d); t++) {
      try { const r = await fetch(SB + q + `&limit=1000&offset=${off}`, { headers: H, signal: AbortSignal.timeout(90000) }); if (r.ok) d = await r.json(); } catch {}
      if (!Array.isArray(d)) await new Promise((s) => setTimeout(s, 2000 * (t + 1)));
    }
    if (!Array.isArray(d)) throw new Error('Supabase unreachable: ' + q);
    out.push(...d);
    if (d.length < 1000) return out;
  }
}
async function summary(id) {
  const f = path.join(CACHE, id + '.json.gz');
  if (fs.existsSync(f)) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f))); } catch {} }
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=' + id);
      if (r.ok) { const j = await r.json(); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ header: j.header, boxscore: j.boxscore, plays: j.plays, gameInfo: j.gameInfo }))); return j; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
  }
  return null;
}

// ── play classifiers (as build_shot_aftermath.mjs) ──
const tt = (p) => (p.type && p.type.text) || '';
const isFG = (p) => p.shootingPlay && !/FreeThrow|Free Throw/i.test(tt(p) + ' ' + (p.text || ''));
const isFT = (p) => p.shootingPlay && /FreeThrow|Free Throw/i.test(tt(p) + ' ' + (p.text || ''));
const isReb = (p) => /Rebound/i.test(tt(p));
const isTO = (p) => /Turnover/i.test(tt(p)) && !/^\s*Foul on/i.test(p.text || '');
const isFoul = (p) => /Foul/i.test(tt(p)) && (!/Turnover/i.test(tt(p)) || /^\s*Foul on/i.test(p.text || ''));
const isTeamTO = (p) => /TimeOut|Timeout/i.test(tt(p)) && !/Official|TV/i.test(tt(p)) && p.team && p.team.id;
const isTVTO = (p) => /Official|TV/i.test(tt(p)) && /TimeOut|Timeout/i.test(tt(p));
const isSteal = (p) => /Steal/i.test(tt(p));
const isBlock = (p) => /Block/i.test(tt(p));
const isSub = (p) => /Substitution/i.test(tt(p));
const tid = (p) => (p.team && p.team.id ? String(p.team.id) : null);
const ath = (p) => p.participants && p.participants[0] && p.participants[0].athlete && String(p.participants[0].athlete.id);
function clk(p) { const v = String((p.clock && p.clock.displayValue) || '').trim(); const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v); if (m) return +m[1] * 60 + +m[2]; const n = parseFloat(v); return isFinite(n) ? n : null; }
function elapsed(p) {
  const per = (p.period && p.period.number) || 1, c = clk(p); if (c == null) return null;
  return per <= 2 ? (per - 1) * 1200 + (1200 - c) : 2400 + (per - 3) * 300 + (300 - c);
}
function zoneOf(p) {
  const pa = +p.pointsAttempted || +p.scoreValue || 0;
  if (pa === 3 || /three point/i.test(p.text || '')) return 'three';
  if (/LayUp|Dunk|Tip/i.test(tt(p)) || /layup|dunk|tip/i.test(p.text || '')) return 'rim';
  return 'j2';                                        // every other two: a jumper / floater / hook
}

// ── accumulators ──
const L = {   // pooled study
  bound: [],        // [ballTeam, otherTeam, seasonIdx, startCode, flags, n8Ball, n8Other, streakTeamIsBall(1/0/-1), streakPts]
  tto: [],          // timeout study rows: [R, V, seasonIdx, kind, streakPts, vHasBall, nextScoreR, rPts, vPts, rPoss, vPoss]
  dry: [],          // dry-spell hazard rows at each made FG: [team, opp, seasonIdx, flags, dry(0/1), dryPoss(0/1)]
  streakPPP: [],    // [team, opp, seasonIdx, streakBucket, pts]  — does a run feed itself?
  shuffle: { obs: { r8: 0, r10: 0, d6: 0 }, null: { r8: 0, r10: 0, d6: 0 }, half: { r8: 0, r10: 0, d6: 0 } },
  comp: {},         // how surge points are built vs all points: {all:{...}, surge:{...}}
  mix: { all: {}, surge: {}, victim: {}, dryOwn: {}, allDef: {} },
  surgeLen: {}, games: 0,
};
const START = ['period', 'steal', 'dead_to', 'block', 'ft_miss', 'fg_miss', 'opp_fg2', 'opp_fg3', 'opp_ft', 'oth'];
// flags on a boundary (bit mask) — what happened at the stoppage before the possession
const F = { ownTO: 1, oppTO: 2, tv: 4, ownMass: 8, oppMass: 16, ownFoulStar: 32, oppFoulStar: 64, fast: 128, oreb: 256, ownTrouble: 512, oppTrouble: 1024 };

function game(s, si, TEAM, perGame) {
  const comp = s.header && s.header.competitions && s.header.competitions[0];
  if (!comp || !comp.competitors || comp.competitors.length !== 2) return false;
  const ids = comp.competitors.map((c) => String(c.team.id));
  const home = String((comp.competitors.find((c) => c.homeAway === 'home') || comp.competitors[0]).team.id);
  const all = (s.plays || []);
  if (all.length < 150) return false;
  // stars = each team's top-2 scorers in the box; starters
  const stars = {}, starters = {};
  for (const t of (s.boxscore && s.boxscore.players) || []) {
    const st = (t.statistics || [])[0]; if (!st) continue;
    const pi = (st.keys || st.names || []).findIndex((k) => /^points$|^PTS$/i.test(k));
    const rows = (st.athletes || []).map((a) => ({ id: String(a.athlete.id), pts: pi >= 0 ? +a.stats[pi] || 0 : 0, starter: !!a.starter }));
    rows.sort((a, b) => b.pts - a.pts);
    const team = String(t.team.id);
    rows.slice(0, 2).forEach((r) => { stars[r.id] = team; });
    rows.filter((r) => r.starter).forEach((r) => { starters[r.id] = team; });
  }
  // 1. possession events and possessions
  const ev = [];
  all.forEach((p, i) => { const t = tid(p); if (t && ids.includes(t) && (isFG(p) || isFT(p) || isReb(p) || isTO(p))) ev.push({ p, i, team: t, per: (p.period && p.period.number) || 1 }); });
  const poss = [];
  for (const e of ev) {
    const last = poss[poss.length - 1];
    if (last && last.team === e.team && last.per === e.per) last.ev.push(e);
    else poss.push({ team: e.team, per: e.per, ev: [e] });
  }
  if (poss.length < 100) return false;
  // 2. a play-by-play walk: fouls per player per half, team scores, the unanswered streak at each play
  const pf = {}; let half = 0;
  const trouble = new Array(all.length), foulStar = new Array(all.length);   // per play: team -> 1 if a star/starter is in foul trouble
  let lastH = 0, lastA = 0, streak = { team: null, pts: 0 };
  const streakAt = new Array(all.length), scores = [];
  all.forEach((p, i) => {
    const per = (p.period && p.period.number) || 1, h = per <= 1 ? 1 : 2;
    if (h !== half) { half = h; for (const k in pf) pf[k] = 0; }
    foulStar[i] = null;
    if (isFoul(p)) {
      const a = ath(p);
      if (a && (stars[a] || starters[a])) {
        pf[a] = (pf[a] || 0) + 1;
        const lim = h === 1 ? 2 : 4;
        if (pf[a] === lim && stars[a]) foulStar[i] = stars[a];    // a top-2 scorer just picked up his 2nd (1st half) / 4th foul
      }
    }
    const tr = {};
    for (const a in pf) { const lim = h === 1 ? 2 : 4; if (pf[a] >= lim && stars[a]) tr[stars[a]] = 1; }
    trouble[i] = tr;
    const hs = +p.homeScore || 0, as = +p.awayScore || 0;
    if (hs > lastH || as > lastA) {
      const sc = hs > lastH ? home : ids.find((t) => t !== home), pts = (hs - lastH) + (as - lastA);
      if (streak.team === sc) streak.pts += pts; else streak = { team: sc, pts };
      scores.push({ i, team: sc, pts, t: elapsed(p) });
      lastH = hs; lastA = as;
    }
    streakAt[i] = { team: streak.team, pts: streak.pts, hs: lastH, as: lastA };
  });
  // game-state stratum at a play: time bucket (5-minute-ish blocks, last 4:00 of regulation, OT) × margin bucket
  const stateAt = (i, team) => {
    const p = all[Math.max(0, i)], e = elapsed(p) || 0, sk = streakAt[Math.max(0, i)] || { hs: 0, as: 0 };
    const tb = e < 600 ? 0 : e < 1200 ? 1 : e < 1800 ? 2 : e < 2160 ? 3 : e < 2400 ? 4 : 5;
    const m = Math.abs(sk.hs - sk.as), mb = m <= 5 ? 0 : m <= 10 ? 1 : m <= 19 ? 2 : 3;
    return tb * 4 + mb;
  };
  // 3. per possession: points, how it started, the stoppage before it, transition
  poss.forEach((r, ri) => {
    r.pts = r.ev.reduce((a, e) => a + (e.p.scoringPlay && (isFG(e.p) || isFT(e.p)) ? (+e.p.scoreValue || 0) : 0), 0);
    r.fgm = r.ev.some((e) => isFG(e.p) && e.p.scoringPlay);
    r.firstI = r.ev[0].i;
    const prev = ri > 0 && poss[ri - 1].per === r.per ? poss[ri - 1] : null;
    r.prevI = prev ? prev.ev[prev.ev.length - 1].i : r.firstI - 1;
    const act = r.ev.find((e) => isFG(e.p) || isFT(e.p) || isTO(e.p));
    r.actI = act ? act.i : r.firstI;
    const first = r.ev[0].p, last = prev && prev.ev[prev.ev.length - 1].p;
    let st = 'oth';
    if (!prev) st = 'period';
    else if (isReb(first) && last) {
      if (isFT(last) && !last.scoringPlay) st = 'ft_miss';
      else if (isFG(last) && !last.scoringPlay) {
        let blk = false; for (let i = r.prevI; i <= r.firstI; i++) if (isBlock(all[i]) && tid(all[i]) === r.team) blk = true;
        st = blk ? 'block' : 'fg_miss';
      }
    } else if (last && isTO(last)) {
      let stl = false; for (let i = Math.max(0, r.prevI - 1); i <= r.firstI; i++) if (isSteal(all[i]) && tid(all[i]) === r.team) stl = true;
      st = stl ? 'steal' : 'dead_to';
    } else if (last && last.scoringPlay && isFG(last)) st = (+last.scoreValue === 3) ? 'opp_fg3' : 'opp_fg2';
    else if (last && last.scoringPlay && isFT(last)) st = 'opp_ft';
    r.start = st;
    const opp = ids.find((t) => t !== r.team);
    let fl = 0; const subs = {};
    for (let i = r.prevI + 1; i < r.actI; i++) {
      const p = all[i];
      if (isTeamTO(p)) fl |= tid(p) === r.team ? F.ownTO : F.oppTO;
      else if (isTVTO(p)) fl |= F.tv;
      else if (isSub(p) && tid(p)) subs[tid(p)] = (subs[tid(p)] || 0) + 1;
      if (foulStar[i]) fl |= foulStar[i] === r.team ? F.ownFoulStar : F.oppFoulStar;
    }
    if ((subs[r.team] || 0) >= 6) fl |= F.ownMass;    // a sub play is "in" or "out": 6 = three-for-three or more
    if ((subs[opp] || 0) >= 6) fl |= F.oppMass;
    const tr = trouble[r.actI] || {};
    if (tr[r.team]) fl |= F.ownTrouble;
    if (tr[opp]) fl |= F.oppTrouble;
    // transition: off a live rebound / steal and the first shot inside 7 seconds
    const fga = r.ev.find((e) => isFG(e.p)), tStart = prev ? elapsed(prev.ev[prev.ev.length - 1].p) : null;
    if (fga && tStart != null && ['steal', 'block', 'ft_miss', 'fg_miss'].includes(st)) {
      const d = elapsed(fga.p) - tStart; if (d >= 0 && d <= 7) fl |= F.fast;
    }
    if (r.ev.slice(1).some((e) => isReb(e.p) && /Offensive/i.test(tt(e.p)))) fl |= F.oreb;
    r.fl = fl; r.opp = opp; r.t = tStart != null ? tStart : elapsed(first);
    r.zones = r.ev.filter((e) => isFG(e.p)).map((e) => [zoneOf(e.p), e.p.scoringPlay ? 1 : 0]);
    r.to = r.ev.some((e) => isTO(e.p));
  });
  const T = (t) => (TEAM[t] = TEAM[t] || { g: 0, poss: 0, pts: 0, dposs: 0, dpts: 0, s8: 0, s10: 0, s8a: 0, s10a: 0, dry: 0, dryA: 0, ans: [0, 0, 0], tos: 0, toInRun: 0, runsFaced: 0, name: null });
  for (const c of comp.competitors) { const o = T(String(c.team.id)); o.g++; o.name = o.name || c.team.displayName || c.team.location; o.loc = c.team.location; }
  for (const r of poss) { const a = T(r.team), d = T(r.opp); a.poss++; a.pts += r.pts; d.dposs++; d.dpts += r.pts; }

  // 4. N8 at each boundary: is the NEXT 8 points in the game all one team's?
  const scoreAfter = (i) => { let k = 0; while (k < scores.length && scores[k].i <= i) k++; return k; };
  const n8from = (k) => {   // from scores[k]: the first scorer and his unanswered total
    if (k >= scores.length) return null;
    const S = scores[k].team; let pts = 0;
    for (let j = k; j < scores.length && scores[j].team === S; j++) pts += scores[j].pts;
    return { S, pts };
  };
  poss.forEach((r) => {
    const k = scoreAfter(r.prevI);
    const nx = n8from(k);
    if (!nx) return;
    const sk = streakAt[Math.max(0, r.prevI)] || { team: null, pts: 0 };
    L.bound.push([r.team, r.opp, si, START.indexOf(r.start), r.fl, nx.S === r.team && nx.pts >= 8 ? 1 : 0, nx.S === r.opp && nx.pts >= 8 ? 1 : 0,
      sk.team === r.team ? 1 : sk.team === r.opp ? -1 : 0, sk.pts, stateAt(r.prevI)]);
  });

  // 5. surges (maximal unanswered stretches of 8+)
  const surges = [];
  for (let k = 0; k < scores.length;) {
    let j = k, pts = 0; const S = scores[k].team;
    while (j < scores.length && scores[j].team === S) { pts += scores[j].pts; j++; }
    if (pts >= 8) surges.push({ team: S, pts, k0: k, k1: j - 1, endI: j < scores.length ? scores[j].i : all.length, startI: k > 0 ? scores[k - 1].i : -1 });
    k = j;
  }
  const gameRuns = [];
  for (const sg of surges) {
    const V = ids.find((t) => t !== sg.team);
    T(sg.team).s8++; T(V).s8a++; if (sg.pts >= 10) { T(sg.team).s10++; T(V).s10a++; }
    L.surgeLen[Math.min(sg.pts, 20)] = (L.surgeLen[Math.min(sg.pts, 20)] || 0) + 1;
    const inRun = poss.filter((r) => r.prevI >= sg.startI && r.actI < sg.endI);
    const firstScore = inRun.find((r) => r.team === sg.team && r.pts > 0);
    // composition: surge team's possessions inside the stretch
    for (const r of inRun) {
      const bucket = r.team === sg.team ? 'surge' : 'victim';
      for (const [z, m] of r.zones) { const o = (L.mix[bucket][z] = L.mix[bucket][z] || [0, 0]); o[0]++; o[1] += m; }
      const tv = (L.mix[bucket].to = L.mix[bucket].to || [0, 0]); tv[0]++; tv[1] += r.to ? 1 : 0;
      if (r.team === sg.team) compAdd('surge', r);
    }
    let vTO = 0; for (let i = sg.startI + 1; i < sg.endI; i++) if (isTeamTO(all[i]) && tid(all[i]) === V) vTO++;
    T(V).runsFaced++; if (vTO) T(V).toInRun++;
    const spark = firstScore ? sparkOf(firstScore) : 'oth';
    const p0 = firstScore ? all[firstScore.actI] : null;
    gameRuns.push([sg.team, sg.pts, scores[sg.k0].t, scores[sg.k1].t, spark, vTO]);
    L.sparks = L.sparks || {}; L.sparks[spark] = (L.sparks[spark] || 0) + 1;
  }
  for (const r of poss) compAdd('all', r);
  for (const r of poss) { for (const [z, m] of r.zones) { const o = (L.mix.all[z] = L.mix.all[z] || [0, 0]); o[0]++; o[1] += m; } const tv = (L.mix.all.to = L.mix.all.to || [0, 0]); tv[0]++; tv[1] += r.to ? 1 : 0; }

  // 6. the ANSWER: after the possession where a run reaches 8, net points over the victim's next NEXT_POSS possessions each
  //    and the timeout study (every boundary with a live 8+ streak)
  poss.forEach((r, ri) => {
    const sk = streakAt[Math.max(0, r.prevI)]; if (!sk || !sk.team || sk.pts < 8) return;
    const R = sk.team, V = ids.find((t) => t !== R);
    let rP = 0, vP = 0, rN = 0, vN = 0, nextR = null;
    for (let j = ri; j < poss.length && (rN < NEXT_POSS || vN < NEXT_POSS); j++) {
      const q = poss[j];
      if (q.team === R && rN < NEXT_POSS) { rP += q.pts; rN++; if (q.pts && nextR == null) nextR = 1; }
      else if (q.team === V && vN < NEXT_POSS) { vP += q.pts; vN++; if (q.pts && nextR == null) nextR = 0; }
    }
    if (rN < NEXT_POSS || vN < NEXT_POSS) return;    // near the end of the game: no full window
    const own = r.team === R ? F.ownTO : F.oppTO, other = r.team === R ? F.oppTO : F.ownTO;
    const kind = (r.fl & other) ? 'victimTO' : (r.fl & own) ? 'runnerTO' : (r.fl & F.tv) ? 'tvTO' : 'none';
    L.tto.push([R, V, si, kind, sk.pts, r.team === V ? 1 : 0, nextR == null ? -1 : nextR, rP, vP, rN, vN, stateAt(r.prevI), ri > 0 && (streakAt[Math.max(0, poss[ri - 1].prevI)] || {}).pts < 8 && (streakAt[Math.max(0, poss[ri - 1].prevI)] || {}).team === R ? 1 : 0, START.indexOf(r.start)]);
  });

  // 7. does a run feed itself? each possession's points by the offense's live unanswered streak
  poss.forEach((r) => {
    const sk = streakAt[Math.max(0, r.prevI)] || { team: null, pts: 0 };
    const own = sk.team === r.team ? sk.pts : -(sk.pts || 0);
    const b = own >= 10 ? 5 : own >= 7 ? 4 : own >= 4 ? 3 : own >= 1 ? 2 : own === 0 ? 1 : own <= -10 ? -5 : own <= -7 ? -4 : own <= -4 ? -3 : -2;
    L.streakPPP.push([r.team, r.opp, si, b, r.pts]);
  });

  // 8. dry spells: from each made FG (and each half start), the time / possessions until the team's next made FG
  const lastT = Math.max(...all.map(elapsed).filter((x) => x != null));
  for (const team of ids) {
    const opp = ids.find((t) => t !== team);
    const mine = poss.filter((r) => r.team === team);
    const fgT = all.map((p, i) => ({ p, i })).filter(({ p }) => tid(p) === team && isFG(p) && p.scoringPlay).map(({ p, i }) => ({ t: elapsed(p), i }));
    const anchors = [{ t: 0, i: -1 }, ...fgT];
    anchors.forEach((a, ai) => {
      const nx = anchors[ai + 1];
      const gap = nx ? nx.t - a.t : lastT - a.t;
      if (!nx && gap < DRY_SECS) return;               // censored at the buzzer
      const between = mine.filter((r) => r.prevI >= a.i && (!nx || r.actI < nx.i));
      // the window's possessions INCLUDING the one that ends it with a make (its stoppage counts as much as any other)
      const win = mine.filter((r) => r.prevI >= a.i && (!nx || r.prevI < nx.i));
      const dry = gap >= DRY_SECS ? 1 : 0, dryP = between.length >= DRY_POSS ? 1 : 0;
      // the state right after the make: is a top-2 scorer in foul trouble, did either side make a mass change / call time
      const first = win[0];
      let fl = 0;
      if (first) fl = first.fl;
      L.dry.push([team, opp, si, fl, dry, dryP, stateAt(a.i), first ? START.indexOf(first.start) : -1]);
      if (dry) {
        T(team).dry++; T(opp).dryA++;
        for (const r of between) { for (const [z, m] of r.zones) { const o = (L.mix.dryOwn[z] = L.mix.dryOwn[z] || [0, 0]); o[0]++; o[1] += m; } const tv = (L.mix.dryOwn.to = L.mix.dryOwn.to || [0, 0]); tv[0]++; tv[1] += r.to ? 1 : 0; }
      }
    });
  }

  // 9. the shuffle null: each team's possession results reshuffled inside the game
  const obs = countRuns(poss.map((r) => [r.team, r.pts, r.fgm]));
  L.shuffle.obs.r8 += obs.r8; L.shuffle.obs.r10 += obs.r10; L.shuffle.obs.d6 += obs.d6;
  let seed = (+(s.header && s.header.id) || 1) % 2147483647;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  // two nulls: shuffled across the whole game, and only within each half (keeps slow drift — benches, foul-up time, garbage time)
  for (let k = 0; k < SHUFFLES * 2; k++) {
    const within = k >= SHUFFLES, key = (r) => r.team + (within ? ':' + Math.min(r.per, 2) : '');
    const by = {}; for (const r of poss) (by[key(r)] = by[key(r)] || []).push([r.pts, r.fgm]);
    for (const t in by) { const a = by[t]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
    const ptr = {}; const seq = poss.map((r) => { const kk = key(r); const v = by[kk][ptr[kk] = (ptr[kk] || 0)]; ptr[kk]++; return [r.team, v[0], v[1]]; });
    const nl = countRuns(seq), N = within ? L.shuffle.half : L.shuffle.null;
    N.r8 += nl.r8 / SHUFFLES; N.r10 += nl.r10 / SHUFFLES; N.d6 += nl.d6 / SHUFFLES;
  }
  if (perGame) perGame[String(s.header.id)] = gameRuns;
  L.games++;
  return true;
}
function sparkOf(r) {
  if (r.fl & F.fast) return r.start === 'steal' ? 'steal_fast' : 'miss_fast';
  if (r.start === 'steal') return 'steal';
  if (r.start === 'dead_to') return 'dead_to';
  if (r.fl & F.oreb) return 'second_chance';
  if (r.zones.some(([z, m]) => z === 'three' && m)) return 'three';
  if (r.start === 'block') return 'block';
  if (r.start === 'ft_miss') return 'ft_miss';
  if (r.fl & F.ownTO) return 'after_timeout';
  return 'halfcourt';
}
function compAdd(k, r) {
  const o = (L.comp[k] = L.comp[k] || { pts: 0, poss: 0, steal: 0, deadTO: 0, fast: 0, oreb: 0, three: 0, ft: 0 });
  o.pts += r.pts; o.poss++;
  if (r.start === 'steal') o.steal += r.pts;
  if (r.start === 'dead_to') o.deadTO += r.pts;
  if (r.fl & F.fast) o.fast += r.pts;
  if (r.fl & F.oreb) o.oreb += r.pts;
  o.three += 3 * r.zones.filter(([z, m]) => z === 'three' && m).length;
  o.ft += r.ev.filter((e) => isFT(e.p) && e.p.scoringPlay).length;
}
function countRuns(seq) {   // seq = [team, pts, fgm] in possession order
  let r8 = 0, r10 = 0, d6 = 0, cur = null, pts = 0;
  const flush = () => { if (pts >= 8) r8++; if (pts >= 10) r10++; };
  const dryN = {};
  for (const [t, p, fgm] of seq) {
    if (p > 0) { if (cur === t) pts += p; else { flush(); cur = t; pts = p; } }
    if (fgm) { if ((dryN[t] || 0) >= DRY_POSS) d6++; dryN[t] = 0; } else dryN[t] = (dryN[t] || 0) + 1;
  }
  flush(); for (const t in dryN) if (dryN[t] >= DRY_POSS) d6++;
  return { r8, r10, d6 };
}

// ── run ──
const teamsBy = {}, perGameBy = {};
for (const [si, y] of SEASONS.entries()) {
  const ts = await sb(`team_seasons?season_year=eq.${y}&select=team,team_id,conference&order=team_id`);
  const d1 = new Set(ts.filter((t) => t.conference).map((t) => String(t.team_id)));
  const games = (await sb(`games?season_year=eq.${y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id`))
    .filter((g) => d1.has(String(g.home_id)) && d1.has(String(g.away_id))).slice(0, +process.env.LIMIT || undefined);
  console.log(y, 'D-I teams', d1.size, 'games', games.length);
  const TEAM = (teamsBy[y] = {}), perGame = (perGameBy[y] = {});
  let ok = 0, bad = 0;
  for (let i = 0; i < games.length; i += 8) {
    const got = await Promise.all(games.slice(i, i + 8).map((g) => summary(g.id)));
    for (const s of got) { if (s && game(s, si, TEAM, perGame)) ok++; else bad++; }
    if (i % 800 === 0) console.log('  ', i, '/', games.length);
  }
  console.log(y, 'parsed', ok, 'skipped', bad);
  TEAM._meta = { ok, bad, conf: Object.fromEntries(ts.map((t) => [String(t.team_id), [t.team, t.conference]])) };
}

// season team strength (pts per possession for / against) → expectation for any matchup
const lgBy = {}, R = {};
for (const [si, y] of SEASONS.entries()) {
  let p = 0, n = 0; for (const [k, t] of Object.entries(teamsBy[y])) if (k !== '_meta') { p += t.pts; n += t.poss; }
  lgBy[si] = p / n;
  for (const [k, t] of Object.entries(teamsBy[y])) if (k !== '_meta') R[si + ':' + k] = { o: t.poss ? t.pts / t.poss : lgBy[si], d: t.dposs ? t.dpts / t.dposs : lgBy[si] };
}
const rt = (si, t) => R[si + ':' + t] || { o: lgBy[si], d: lgBy[si] };
const eppp = (si, a, b) => rt(si, a).o + rt(si, b).d - lgBy[si];
const net = (si, t) => rt(si, t).o - rt(si, t).d;
const pct = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);

// N8 lift for a subset of boundaries vs strength-matched baseline (same ball side, same strength bin)
const bin = (x) => Math.max(-6, Math.min(6, Math.round(x / 0.04)));
const bkey = (b) => bin(net(b[2], b[0]) - net(b[2], b[1])) + ':' + b[9];
const base = {}; for (const b of L.bound) { const k = bkey(b); const o = (base[k] = base[k] || [0, 0, 0]); o[0]++; o[1] += b[5]; o[2] += b[6]; }
function lift(filter, side) {   // side: 'ball' → N8 for the team with the ball, 'other' → N8 for the other team
  let n = 0, hit = 0, exp = 0;
  for (const b of L.bound) {
    if (!filter(b)) continue;
    const o = base[bkey(b)];
    n++; hit += side === 'ball' ? b[5] : b[6]; exp += side === 'ball' ? o[1] / o[0] : o[2] / o[0];
  }
  return { n, rate: pct(hit, n), expected: pct(exp, n), lift: exp ? +(hit / exp).toFixed(3) : null, se_pp: n ? +(100 * Math.sqrt((hit / n) * (1 - hit / n) / n)).toFixed(2) : null };
}
const allB = L.bound.length;
const baseRate = { n: allB, ballN8: pct(L.bound.reduce((a, b) => a + b[5], 0), allB), otherN8: pct(L.bound.reduce((a, b) => a + b[6], 0), allB) };
const S = (name) => START.indexOf(name);
const triggers = {
  steal: lift((b) => b[3] === S('steal'), 'ball'),
  dead_ball_turnover: lift((b) => b[3] === S('dead_to'), 'ball'),
  def_reb_after_block: lift((b) => b[3] === S('block'), 'ball'),
  def_reb_after_missed_ft: lift((b) => b[3] === S('ft_miss'), 'ball'),
  def_reb_after_missed_fg: lift((b) => b[3] === S('fg_miss'), 'ball'),
  after_opp_made_2: lift((b) => b[3] === S('opp_fg2'), 'ball'),
  after_opp_made_3: lift((b) => b[3] === S('opp_fg3'), 'ball'),
  after_opp_ft: lift((b) => b[3] === S('opp_ft'), 'ball'),
  // the team that JUST made the three / two (it does not have the ball): is the next 8 all theirs?
  just_made_3_scorer: lift((b) => b[3] === S('opp_fg3'), 'other'),
  just_made_2_scorer: lift((b) => b[3] === S('opp_fg2'), 'other'),
  transition_poss: lift((b) => (b[4] & F.fast) > 0, 'ball'),
  own_timeout_ATO: lift((b) => (b[4] & F.ownTO) > 0, 'ball'),
  opp_timeout_before_poss: lift((b) => (b[4] & F.oppTO) > 0, 'ball'),
  tv_timeout: lift((b) => (b[4] & F.tv) > 0, 'ball'),
  own_mass_sub: lift((b) => (b[4] & F.ownMass) > 0, 'ball'),
  opp_mass_sub: lift((b) => (b[4] & F.oppMass) > 0, 'ball'),
  opp_star_just_hit_foul_trouble: lift((b) => (b[4] & F.oppFoulStar) > 0, 'ball'),
  own_star_just_hit_foul_trouble: lift((b) => (b[4] & F.ownFoulStar) > 0, 'ball'),
  opp_star_in_foul_trouble: lift((b) => (b[4] & F.oppTrouble) > 0 && !((b[4] & F.ownTrouble) > 0), 'ball'),
  own_star_in_foul_trouble: lift((b) => (b[4] & F.ownTrouble) > 0 && !((b[4] & F.oppTrouble) > 0), 'ball'),
  ball_team_on_5plus_streak: lift((b) => b[7] === 1 && b[8] >= 5, 'ball'),
  other_team_on_5plus_streak: lift((b) => b[7] === -1 && b[8] >= 5, 'ball'),
};

// the run feeds itself? PPP by the offense's live streak vs strength expectation
const fed = {};
for (const [t, o, si, b, pts] of L.streakPPP) { const a = (fed[b] = fed[b] || [0, 0, 0]); a[0]++; a[1] += pts; a[2] += eppp(si, t, o); }
const feedsItself = Object.fromEntries(Object.entries(fed).sort((a, b) => +a[0] - +b[0]).map(([k, a]) => [k, { n: a[0], ppp: +(a[1] / a[0]).toFixed(3), expected: +(a[2] / a[0]).toFixed(3), resid: +((a[1] - a[2]) / a[0]).toFixed(3) }]));

// timeouts: when the runner R is up 8+ unanswered
function ttoSum(f) {
  let n = 0, nextR = 0, nrN = 0, mg = 0, ex = 0;
  for (const r of L.tto) {
    if (!f(r)) continue;
    const [Rt, Vt, si, , , , nr, rP, vP, rN, vN, stt] = r;
    if (stt >= 16 || stt % 4 === 3) continue;   // no last-4:00 / OT / 20-point-margin moments
    n++; if (nr >= 0) { nrN++; nextR += nr; }
    mg += rP - vP; ex += rN * eppp(si, Rt, Vt) - vN * eppp(si, Vt, Rt);
  }
  return { n, runner_scores_next_pct: pct(nextR, nrN), net_next6_each: n ? +(mg / n).toFixed(2) : null, expected: n ? +(ex / n).toFixed(2) : null, resid: n ? +((mg - ex) / n).toFixed(2) : null };
}
// the moment that matters: the victim has the ball right after the runner scored (the classic timeout spot), streak first reaches 8+ here
const timeouts = {};
for (const sb_ of [[8, 9], [10, 12], [13, 99]]) {
  const key = `streak_${sb_[0]}-${sb_[1] === 99 ? 'plus' : sb_[1]}`;
  timeouts[key] = {};
  for (const kind of ['victimTO', 'tvTO', 'none', 'runnerTO'])
    timeouts[key][kind] = ttoSum((r) => r[3] === kind && r[5] === 1 && r[4] >= sb_[0] && r[4] <= sb_[1]);
}
// the same moment with the stoppage type held fixed: the victim inbounding right after the runner's made field goal
timeouts.after_runner_fg = {}; for (const kind of ['victimTO', 'tvTO', 'none']) timeouts.after_runner_fg[kind] = ttoSum((r) => r[3] === kind && r[5] === 1 && (r[13] === S('opp_fg2') || r[13] === S('opp_fg3')));
timeouts.after_runner_ft = {}; for (const kind of ['victimTO', 'tvTO', 'none']) timeouts.after_runner_ft[kind] = ttoSum((r) => r[3] === kind && r[5] === 1 && r[13] === S('opp_ft'));
timeouts.victim_dead_ball_other = {}; for (const kind of ['victimTO', 'tvTO', 'none']) timeouts.victim_dead_ball_other[kind] = ttoSum((r) => r[3] === kind && r[5] === 1 && ![S('opp_fg2'), S('opp_fg3'), S('opp_ft')].includes(r[13]));
timeouts.all_victim_ball = {}; for (const kind of ['victimTO', 'tvTO', 'none']) timeouts.all_victim_ball[kind] = ttoSum((r) => r[3] === kind && r[5] === 1);

// dry-spell hazard at each made FG by trigger state of the team's next possession
const dkey = (r) => bin(eppp(r[2], r[0], r[1]) - lgBy[r[2]]) + ':' + r[6];
const dbase = {}; for (const r of L.dry) { const o = (dbase[dkey(r)] = dbase[dkey(r)] || [0, 0]); o[0]++; o[1] += r[4]; }
function dryRate(f) {
  let n = 0, d = 0, dp = 0, ex = 0;
  for (const r of L.dry) if (f(r)) { n++; d += r[4]; dp += r[5]; const o = dbase[dkey(r)]; ex += o[1] / o[0]; }
  return { n, dry4min_pct: pct(d, n), expected_pct: pct(ex, n), lift: ex ? +(d / ex).toFixed(3) : null, dry6poss_pct: pct(dp, n) };
}
const DEAD = [S('opp_fg2'), S('opp_fg3'), S('opp_ft'), S('dead_to')], LIVE = [S('steal'), S('block'), S('ft_miss'), S('fg_miss')];
const drySum = {
  all: dryRate(() => true),
  own_star_in_foul_trouble: dryRate((r) => (r[3] & F.ownTrouble) > 0),
  no_star_trouble: dryRate((r) => !(r[3] & F.ownTrouble)),
  own_mass_sub: dryRate((r) => (r[3] & F.ownMass) > 0),
  // flags are the stoppage just before the team's own next possession after its make
  own_timeout: dryRate((r) => (r[3] & F.ownTO) > 0),
  opp_timeout: dryRate((r) => (r[3] & F.oppTO) > 0),
  tv_timeout: dryRate((r) => (r[3] & F.tv) > 0),
  // a stoppage usually means a dead-ball start (no transition chance): compare like with like
  deadball_start_no_stoppage: dryRate((r) => DEAD.includes(r[7]) && !(r[3] & (F.tv | F.ownTO | F.oppTO | F.ownMass))),
  deadball_start_tv_timeout: dryRate((r) => DEAD.includes(r[7]) && (r[3] & F.tv) > 0),
  deadball_start_any_timeout: dryRate((r) => DEAD.includes(r[7]) && (r[3] & (F.tv | F.ownTO | F.oppTO)) > 0),
  live_start: dryRate((r) => LIVE.includes(r[7])),
};
// strength-adjusted dry spells: expected from a logistic-free bin on team offense vs opp defense
const mix = (m) => { const fga = ['rim', 'j2', 'three'].reduce((a, z) => a + ((m[z] || [0])[0]), 0); return Object.fromEntries([...['rim', 'j2', 'three'].map((z) => [z, { share: pct((m[z] || [0])[0], fga), fg: pct((m[z] || [0, 0])[1], (m[z] || [0])[0]) }]), ['to_rate', pct((m.to || [0, 0])[1], (m.to || [0])[0])]]); };
const compOut = Object.fromEntries(Object.entries(L.comp).map(([k, o]) => [k, { ppp: +(o.pts / o.poss).toFixed(3), share_from_steals: pct(o.steal, o.pts), share_from_dead_TO: pct(o.deadTO, o.pts), share_transition: pct(o.fast, o.pts), share_second_chance: pct(o.oreb, o.pts), share_threes: pct(o.three, o.pts), share_ft: pct(o.ft, o.pts) }]));

// teams + coaches (coach_seasons.json: Sports-Reference school names, matched loosely to ESPN locations)
let coaches = []; try { coaches = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'coach_seasons.json'), 'utf8')); } catch {}
const norm = (x) => String(x || '').toLowerCase().replace(/\bstate\b/g, 'st').replace(/[^a-z]/g, '');
const ansBy = {};
for (const r of L.tto) {   // the answer: the possession right as a run first reached 8 (row flag), victim's net over the next 6 each
  if (!r[12] || r[11] >= 16 || r[11] % 4 === 3) continue;
  const [Rt, Vt, si, , , , , rP, vP, rN, vN] = r;
  const a = (ansBy[si + ':' + Vt] = ansBy[si + ':' + Vt] || [0, 0, 0]);
  a[0]++; a[1] += vP - rP; a[2] += vN * eppp(si, Vt, Rt) - rN * eppp(si, Rt, Vt);
}
for (const [si, y] of SEASONS.entries()) {
  const TEAM = teamsBy[y], meta = TEAM._meta; delete TEAM._meta;
  const cmap = new Map(coaches.filter((c) => c.season_year === y).map((c) => [norm(c.school), c.coach]));
  const teams = Object.entries(TEAM).filter(([k]) => meta.conf[k] && meta.conf[k][1]).map(([k, t]) => {
    const a = ansBy[si + ':' + k] || [0, 0, 0];
    return { team_id: +k, team: meta.conf[k][0], conf: meta.conf[k][1], coach: cmap.get(norm(meta.conf[k][0])) || cmap.get(norm(t.loc)) || null, g: t.g,
      surges_pg: +(t.s8 / t.g).toFixed(2), surges10_pg: +(t.s10 / t.g).toFixed(2), surges_allowed_pg: +(t.s8a / t.g).toFixed(2), surges10_allowed_pg: +(t.s10a / t.g).toFixed(2),
      dry_pg: +(t.dry / t.g).toFixed(2), dry_forced_pg: +(t.dryA / t.g).toFixed(2),
      answer_n: a[0], answer_net: a[0] ? +(a[1] / a[0]).toFixed(2) : null, answer_resid: a[0] ? +((a[1] - a[2]) / a[0]).toFixed(2) : null,
      timeout_in_run_pct: pct(t.toInRun, t.runsFaced), net_ppp: +(net(si, k)).toFixed(3) };
  });
  fs.writeFileSync(path.join(OUT, `${y}.json`), JSON.stringify({ season: y, built: new Date().toISOString().slice(0, 10), games: meta.ok, skipped: meta.bad,
    def: { surge: '8+ unanswered points', dry: `${DRY_SECS / 60}:00+ of game clock without a made FG`, answer: `victim net points over its next ${NEXT_POSS} possessions (and the runner's) after a run first reaches 8, vs season-strength expectation` },
    run_cols: ['team_id', 'pts', 'start_s', 'end_s', 'spark', 'victim_timeouts'], teams, games_runs: perGameBy[y] }));
}
const study = { seasons: SEASONS, games: L.games, built: new Date().toISOString().slice(0, 10),
  base_rate: baseRate, triggers_N8: triggers, feeds_itself_by_streak: feedsItself, timeouts, dry: drySum,
  shuffle_null: { observed: L.shuffle.obs, null_mean: Object.fromEntries(Object.entries(L.shuffle.null).map(([k, v]) => [k, +v.toFixed(1)])),
    ratio: Object.fromEntries(Object.keys(L.shuffle.obs).map((k) => [k, +(L.shuffle.obs[k] / L.shuffle.null[k]).toFixed(3)])),
    within_half_null_mean: Object.fromEntries(Object.entries(L.shuffle.half).map(([k, v]) => [k, +v.toFixed(1)])),
    within_half_ratio: Object.fromEntries(Object.keys(L.shuffle.obs).map((k) => [k, +(L.shuffle.obs[k] / L.shuffle.half[k]).toFixed(3)])) },
  composition: compOut, shot_mix: Object.fromEntries(Object.entries(L.mix).filter(([, m]) => Object.keys(m).length).map(([k, m]) => [k, mix(m)])),
  sparks: L.sparks, surge_length_hist: L.surgeLen };
fs.writeFileSync(path.join(OUT, `study_${SEASONS.join('_')}.json`), JSON.stringify(study, null, 1));
console.log(JSON.stringify(study, null, 1).slice(0, 6000));
