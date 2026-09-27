#!/usr/bin/env node
/* build_plays_top.mjs — a season's standout plays across all of D-I, for the Play Finder's
 * "no team picked" view (plays.html). Reads every final game of the season from Supabase, pulls
 * ESPN's play-by-play, scores each play with tdc-plays.js (the same code the page runs), and keeps
 * the biggest win-probability swings, the best shot-making, the longest makes and every
 * last-seconds, close-game shot. Nothing else is stored.
 *
 *   node scripts/build_plays_top.mjs 2026            # one season (≈6,000 games, ~15 min)
 *   node scripts/build_plays_top.mjs 2014 2025       # a range
 * Writes scripts/data/plays_top/<season>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = require(path.join(HERE, '..', 'tdc-plays.js'));
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const SUM = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
const OUT = path.join(HERE, 'data', 'plays_top');
const ZONES = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'shot_zone_ref.json'), 'utf8'));

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

async function season(y) {
  const t0 = Date.now();
  const ts = await sb(`team_seasons?season_year=eq.${y}&select=team_id,srs&order=team_id.asc`);
  const srs = Object.fromEntries(ts.filter((t) => t.team_id != null && t.srs != null).map((t) => [String(t.team_id), +t.srs]));
  const d1 = new Set(ts.map((t) => String(t.team_id)));
  const zones = (ZONES.seasons[String(y)] || ZONES.seasons[String(ZONES.latest)] || {}).zones || null;
  const games = (await sb(`games?season_year=eq.${y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc`))
    .filter((g) => d1.has(String(g.home_id)) || d1.has(String(g.away_id)));
  const all = [], meta = {};
  let done = 0, empty = 0;
  const q = games.slice();
  async function worker() {
    while (q.length) {
      const g = q.shift();
      const s = await espn(g.id);
      done++;
      if (!s || !(s.plays || []).length) { empty++; continue; }
      const r = P.parseGame(s, { srs, zones });
      meta[g.id] = { ...r.game, date: r.game.date };
      for (const x of r.rows) { x.g = String(g.id); all.push(x); }
      if (done % 500 === 0) process.stdout.write(`  ${y}: ${done}/${games.length} games\n`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const keep = new Map();
  const add = (list, n) => list.slice(0, n).forEach((x) => keep.set(x.g + ':' + x.seq, x));
  add([...all].sort((a, b) => b.wpa - a.wpa), 500);
  add([...all].sort((a, b) => a.wpa - b.wpa), 150);
  add(all.filter((x) => x.poe != null && x.kind !== 'ft').sort((a, b) => b.poe - a.poe), 200);
  add(all.filter((x) => x.made && x.dist != null).sort((a, b) => b.dist - a.dist), 150);
  add(all.filter((x) => x.made && x.per >= 2 && x.secs <= 5 && Math.abs(x.margin - x.sv) <= 3), 400);
  const rows = [...keep.values()];
  const games_ = {};
  rows.forEach((x) => { games_[x.g] = meta[x.g]; });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${y}.json`), JSON.stringify({ season: y, built: new Date().toISOString(), games: games_, rows }));
  console.log(`plays_top ${y}: ${games.length} games (${empty} without play-by-play), ${all.length.toLocaleString()} plays, kept ${rows.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
}

const a = process.argv.slice(2).map(Number).filter(Boolean);
const years = a.length === 2 && a[1] > a[0] ? Array.from({ length: a[1] - a[0] + 1 }, (_, i) => a[0] + i) : a;
for (const y of years) await season(y);
