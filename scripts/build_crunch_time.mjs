#!/usr/bin/env node
// Crunch-time shot share for every high-major (ACC / Big Ten / Big 12 / SEC / Big East) player.
//
// Crunch time = a shot taken with the margin at five or fewer (score before the shot) and under
// 4:00 left in the second half, or at any point in overtime. A player's crunch share is his FGA
// divided by his team's FGA while he was on the floor in crunch time; his rest-of-game share is
// the same thing the rest of the game. The jump is the difference, in percentage points.
//
// Who was on the floor comes from tdc-gameflow.js (ESPN substitution plays; the same engine the
// game page uses), run here in a stub DOM. ESPN summaries are cached gzipped in
// scripts/data/espn_pbp_cache/ (git-ignored), so reruns are offline.
//
//   node scripts/build_crunch_time.mjs [season=2026]
// writes scripts/data/crunch_time_<season>.json
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const SEASON = +(process.argv[2] || 2026);
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const HM = ['Atlantic Coast Conference', 'Big Ten Conference', 'Big 12 Conference', 'Southeastern Conference', 'Big East Conference'];
const CACHE = path.join(HERE, 'data', 'espn_pbp_cache'); fs.mkdirSync(CACHE, { recursive: true });
const OUT = path.join(HERE, 'data', `crunch_time_${SEASON}.json`);

// load the game-page engine with a do-nothing DOM
const ctx = { window: {}, document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} }, documentElement: { getAttribute: () => 'light' } }, console };
ctx.window.matchMedia = null; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tdc-gameflow.js'), 'utf8'), ctx);
const GF = ctx.window.TDC_GAMEFLOW;

async function sb(q) {   // paginated, stable order (see supabase-pagination-order memory)
  const out = []; for (let o = 0; ; o += 1000) {
    const r = await fetch(`${SB}/${q}&limit=1000&offset=${o}`, { headers: H }).then(r => r.json());
    out.push(...r); if (r.length < 1000) return out; }
}
async function summary(id) {
  const f = path.join(CACHE, id + '.json.gz');
  if (fs.existsSync(f)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)));
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=' + id);
      if (r.ok) { const j = await r.json(); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ header: j.header, boxscore: j.boxscore, plays: j.plays, gameInfo: j.gameInfo }))); return j; }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1500 * (t + 1)));
  }
  return null;
}

const ts = await sb(`team_seasons?season_year=eq.${SEASON}&select=team,team_id,conference&order=team_id`);
const HMT = new Map(ts.filter(t => HM.includes(t.conference)).map(t => [String(t.team_id), t]));
console.log('high-major teams', HMT.size);
const games = (await sb(`games?season_year=eq.${SEASON}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id`))
  .filter(g => HMT.has(String(g.home_id)) || HMT.has(String(g.away_id)));
console.log('games', games.length);

const acc = {};   // espn_id -> {name, team, c:[own,team], r:[own,team], games:Set}
let done = 0, noPbp = 0;
async function one(g) {
  const d = await summary(g.id); done++;
  if (done % 200 === 0) console.log('  ', done, '/', games.length);
  const G = d && GF.parse(d); if (!G) { noPbp++; return; }
  G.onPlay = (p, on, e, ph, pa) => {
    if (!p.shootingPlay || /FreeThrow/i.test((p.type && p.type.text) || '')) return;
    const t = p.team && p.team.id; if (!t || !HMT.has(String(t)) || !on[t]) return;
    const per = (p.period && p.period.number) || 1, clk = String((p.clock && p.clock.displayValue) || '0:00');
    const secs = clk.includes(':') ? (+clk.split(':')[0]) * 60 + parseFloat(clk.split(':')[1]) : parseFloat(clk);
    const crunch = Math.abs(ph - pa) <= 5 && (per >= 3 || (per === 2 && secs <= 240));
    const k = crunch ? 'c' : 'r';
    const shooter = p.participants && p.participants[0] && p.participants[0].athlete && p.participants[0].athlete.id;
    for (const id of Object.keys(on[t])) {
      const P = G.P[id]; if (!P) continue;
      const a = acc[id] || (acc[id] = { name: P.name, team_id: String(t), team: HMT.get(String(t)).team, c: [0, 0], r: [0, 0], cg: 0, _g: null });
      a[k][1]++; if (id === shooter) a[k][0]++;
      if (crunch && a._g !== g.id) { a.cg++; a._g = g.id; }
    }
  };
  GF.crunch(G);
}
for (let i = 0; i < games.length; i += 6) await Promise.all(games.slice(i, i + 6).map(one));
console.log('no pbp', noPbp);

// 2026-27 rosters: who's back, and where
const roster = await sb(`players?select=espn_id,name,team&espn_id=not.is.null&order=espn_id`);
const now = new Map(roster.map(r => [String(r.espn_id), r.team]));
const rows = Object.entries(acc).map(([id, a]) => {
  const cs = a.c[1] ? a.c[0] / a.c[1] : null, rs = a.r[1] ? a.r[0] / a.r[1] : null;
  return { espn_id: +id, name: a.name, team: a.team, team_id: +a.team_id, now: now.get(id) || null,
    c_fga: a.c[0], c_team: a.c[1], r_fga: a.r[0], r_team: a.r[1], c_games: a.cg,
    c_share: cs == null ? null : +(cs * 100).toFixed(1), r_share: rs == null ? null : +(rs * 100).toFixed(1),
    jump: cs == null || rs == null ? null : +((cs - rs) * 100).toFixed(1) };
}).filter(r => r.r_team >= 200).sort((a, b) => (b.jump ?? -99) - (a.jump ?? -99));
fs.writeFileSync(OUT, JSON.stringify({ season: SEASON, built: new Date().toISOString().slice(0, 10), games: games.length, no_pbp: noPbp,
  def: 'margin <= 5 before the shot, under 4:00 of the 2nd half or any OT; share = his FGA / team FGA while on the floor', players: rows }));
console.log('wrote', OUT, rows.length, 'players');
