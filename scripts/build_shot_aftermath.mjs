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
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const SUM = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
const OUT = path.join(HERE, 'data', 'shot_aftermath');
const ZONES = ['rim', 'short', 'long', 'three', 'mid'];   // mid = a two-point jumper the play-by-play gives no distance for (2024-25 logs most as just "Jumper")

async function sb(q) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(SB + q + `&limit=1000&offset=${off}`, { headers: H });
    const d = await r.json();
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

function parse(s, acc, lg) {
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
      if (isReb(e.p)) break;                       // an offensive rebound ends the first chance
      if (!isFG(e.p)) continue;
      const z = zoneOf(e.p); if (!z) continue;
      const ath = e.p.participants && e.p.participants[0] && e.p.participants[0].athlete && String(e.p.participants[0].athlete.id);
      const g = (ath && pos[ath]) || 'U';
      const T = (acc[r.team] = acc[r.team] || {}), Pz = (T[g] = T[g] || {}), c = (Pz[z] = Pz[z] || new Array(11).fill(0));
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
      break;                                       // one first-chance attempt per possession
    }
  });
}

async function season(y) {
  const t0 = Date.now();
  const ts = await sb(`team_seasons?season_year=eq.${y}&select=team_id&order=team_id.asc`);
  const d1 = new Set(ts.map((t) => String(t.team_id)));
  const games = (await sb(`games?season_year=eq.${y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc`))
    .filter((g) => d1.has(String(g.home_id)) && d1.has(String(g.away_id)));   // D-I vs D-I only
  const acc = {}, lg = { pts: 0, poss: 0 };
  let done = 0, empty = 0;
  const q = games.slice();
  async function worker() {
    while (q.length) {
      const g = q.shift();
      const s = await espn(g.id);
      done++;
      if (!s || !(s.plays || []).length) { empty++; continue; }
      try { parse(s, acc, lg); } catch (e) { empty++; }
      if (done % 500 === 0) process.stdout.write(`  ${y}: ${done}/${games.length} games\n`);
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
  fs.writeFileSync(path.join(OUT, `${y}.json`), JSON.stringify(out));
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
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ built: new Date().toISOString(), seasons: idx }, null, 1));
