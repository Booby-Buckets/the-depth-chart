#!/usr/bin/env node
/* build_mastery.mjs — Points per shot by shot family, and "mastery shots".
 *
 * Josh Schertz's rule (SLU): the efficient shots are rim attempts, free throws and catch-and-shoot threes; anything
 * else is a "mastery shot" — a player gets the green light on it once he shows he makes it at 1.1+ points per shot
 * (55% on a two, 36.7% on a three). This builder counts every D-I vs D-I field-goal attempt from ESPN play-by-play
 * by shooter and shot family, so the page can measure points per shot against that 1.1 bar.
 *
 * Families (every FGA lands in exactly one):
 *   rim    layups / dunks / tips, or any two within 4 ft
 *   float  floaters / runners                      ┐
 *   post   hooks, turnarounds, fadeaways           │ tagged by ESPN's text — 2025-26 on; earlier
 *   pull2  pull-up / step-back twos                ┘ seasons file these as plain jumpers
 *   short  other two-point jumpers, 5-14 ft
 *   long   other two-point jumpers, 15 ft to the arc
 *   mid    two-point jumpers with no distance in the feed
 *   pull3  pull-up / step-back threes (tagged, 2025-26 on)
 *   three  every other three
 * Each family carries [att, made, assistedMade] (the feed names an assister on makes only).
 *
 *   node scripts/build_mastery.mjs 2026            # one season (~6,000 games, a couple of minutes)
 *   node scripts/build_mastery.mjs 2015 2026       # a range
 * Writes scripts/data/mastery/<season>.json and index.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const SUM = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
const OUT = path.join(HERE, 'data', 'mastery');
const FAM = ['rim', 'float', 'post', 'pull2', 'short', 'long', 'mid', 'pull3', 'three'];
const FI = Object.fromEntries(FAM.map((f, i) => [f, i]));

async function sb(q) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    let d = null;
    for (let t = 0; t < 6 && d == null; t++) {
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

function family(p) {
  const t = (p.text || '').toLowerCase(), ty = tt(p);
  const three = (+p.pointsAttempted || +p.scoreValue || 0) === 3 || /three point/.test(t);
  const pull = /pull-?up|step ?back/.test(t);
  if (three) return pull ? 'pull3' : 'three';
  if (/floating|floater|runner/.test(t)) return 'float';
  if (/LayUp|Dunk|Tip/i.test(ty) || /layup|dunk|tip/.test(t)) return 'rim';
  if (/hook|turnaround|fade/.test(t)) return 'post';
  if (pull) return 'pull2';
  let d = null;
  const m = /(\d+)-foot/.exec(t);
  if (m) d = +m[1];
  else if (p.coordinate && isFinite(p.coordinate.x) && isFinite(p.coordinate.y) && !(p.coordinate.x === 25 && p.coordinate.y === 0) && p.coordinate.y >= 0 && p.coordinate.y < 47)
    d = Math.hypot(p.coordinate.x - 25, p.coordinate.y);
  if (d == null) return 'mid';
  return d <= 4 ? 'rim' : d <= 14 ? 'short' : 'long';
}

const blank = () => FAM.map(() => [0, 0, 0]);

function parse(s, X) {
  // box: names, positions, minutes, free throws
  const gameP = new Set();
  for (const t of (s.boxscore && s.boxscore.players) || []) {
    const tid = String(t.team && t.team.id);
    for (const st of t.statistics || []) {
      const L = st.labels || [], iM = L.indexOf('MIN'), iF = L.indexOf('FT');
      for (const a of st.athletes || []) {
        const id = a.athlete && a.athlete.id && String(a.athlete.id); if (!id || !a.stats || !a.stats.length) continue;
        const m = parseFloat(a.stats[iM]) || 0; if (m <= 0) continue;
        const P = (X.p[id] = X.p[id] || { n: '', t: '', pos: '', min: 0, gp: 0, fta: 0, ftm: 0, f: blank() });
        const ft = String(a.stats[iF] || '0-0').split('-');
        P.n = a.athlete.displayName || P.n; P.t = tid; P.min += m; P.gp += 1; P.fta += +ft[1] || 0; P.ftm += +ft[0] || 0;
        const ab = a.athlete.position && a.athlete.position.abbreviation;
        const g = /C/.test(ab || '') ? 'C' : /F/.test(ab || '') ? 'F' : /G/.test(ab || '') ? 'G' : '';
        if (g) P.pos = g;
        gameP.add(id);
        const T = (X.t[tid] = X.t[tid] || { gp: 0, fta: 0, ftm: 0, f: blank() });
        T.fta += +ft[1] || 0; T.ftm += +ft[0] || 0;
      }
    }
  }
  const ids = ((s.header && s.header.competitions && s.header.competitions[0] && s.header.competitions[0].competitors) || []).map((c) => String(c.team && c.team.id));
  ids.forEach((id) => { if (X.t[id]) X.t[id].gp++; });
  for (const p of s.plays || []) {
    if (!isFG(p) || !p.team || !p.team.id) continue;
    const k = FI[family(p)], made = p.scoringPlay ? 1 : 0, ast = made && /assist/i.test(p.text || '') ? 1 : 0;
    const tid = String(p.team.id);
    const T = (X.t[tid] = X.t[tid] || { gp: 0, fta: 0, ftm: 0, f: blank() });
    T.f[k][0]++; T.f[k][1] += made; T.f[k][2] += ast;
    X.lg[k][0]++; X.lg[k][1] += made; X.lg[k][2] += ast;
    const ath = p.participants && p.participants[0] && p.participants[0].athlete && String(p.participants[0].athlete.id);
    const P = ath && X.p[ath];
    if (P && gameP.has(ath)) { P.f[k][0]++; P.f[k][1] += made; P.f[k][2] += ast; }
  }
}

async function season(y) {
  const t0 = Date.now();
  const ts = await sb(`team_seasons?season_year=eq.${y}&select=team_id,team,conference,tier&order=team_id.asc`);
  const d1 = new Set(ts.map((t) => String(t.team_id)));
  const games = (await sb(`games?season_year=eq.${y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc`))
    .filter((g) => d1.has(String(g.home_id)) && d1.has(String(g.away_id)));
  const X = { p: {}, t: {}, lg: blank() };
  let done = 0, empty = 0;
  const q = games.slice();
  async function worker() {
    while (q.length) {
      const g = q.shift();
      const s = await espn(g.id);
      done++;
      if (!s || !(s.plays || []).length) { empty++; continue; }
      try { parse(s, X); } catch (e) { empty++; }
      if (done % 1000 === 0) process.stdout.write(`  ${y}: ${done}/${games.length} games\n`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const teams = {};
  for (const t of ts) if (t.team_id != null) teams[String(t.team_id)] = [t.team, t.conference || '', t.tier || null];
  // players with at least one field-goal attempt; rows = [id, name, teamId, pos, min, gp, fta, ftm, ...FAM×(att,made,ast)]
  const players = [];
  for (const [id, P] of Object.entries(X.p)) {
    if (!P.f.some((c) => c[0] > 0) && !P.fta) continue;
    players.push([id, P.n, P.t, P.pos, Math.round(P.min), P.gp, P.fta, P.ftm, ...P.f.flat()]);
  }
  const tRows = Object.entries(X.t).filter(([id]) => teams[id]).map(([id, T]) => [id, T.gp, T.fta, T.ftm, ...T.f.flat()]);
  const out = {
    season: y, built: new Date().toISOString(), games: games.length, missing: empty, fam: FAM,
    pcols: ['id', 'name', 'team', 'pos', 'min', 'gp', 'fta', 'ftm'], tcols: ['id', 'gp', 'fta', 'ftm'],
    league: X.lg, teams, players, teamRows: tRows,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${y}.json`), JSON.stringify(out));
  const fga = X.lg.reduce((a, c) => a + c[0], 0);
  console.log(`${y}: ${games.length} games (${empty} without play-by-play), ${fga.toLocaleString()} FGA, ${players.length} players, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const args = process.argv.slice(2).map(Number).filter(Boolean);
const ys = args.length === 2 && args[1] - args[0] > 1 ? Array.from({ length: args[1] - args[0] + 1 }, (_, i) => args[0] + i) : args.length ? args : [2026];
for (const y of ys) await season(y);
const idx = fs.readdirSync(OUT).map((f) => /^(\d{4})\.json$/.exec(f)).filter(Boolean).map((m) => +m[1]).sort((a, b) => b - a);
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ built: new Date().toISOString(), seasons: idx }));
