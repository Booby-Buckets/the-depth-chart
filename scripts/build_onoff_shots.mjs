#!/usr/bin/env node
/* build_onoff_shots.mjs — the shot and possession events behind the on/off "Our numbers" rows.
 *
 * build_wowy.py knows who was on the floor (NCAA substitutions) but not where a shot came from or how a
 * possession started. This pass reads the same games' ESPN play-by-play and tags:
 *   shots        every FGA: expected points (D-I make rate for its shot family × distance band), points scored,
 *                and its Hunt Great grade (great = rim or the shooter's green light, avg, bad — lib_shotfamily)
 *   possessions  every run of one team's plays (the build_possession_value.mjs method): points, whether it was
 *                transition (won by a defensive rebound or a steal, first action within 10 s), and the
 *                second-chance points scored after an offensive rebound
 * build_wowy.py then drops each event into the lineup on the floor at that clock.
 *
 *   node scripts/build_onoff_shots.mjs 2026      (needs scripts/data/mastery/<y>.json for green lights)
 * Writes scripts/data/wowy_cache/shotev_<y>.json.gz  {games: {gid: {t: {teamId: names}, e: [events]}}}
 *   shot  [period, secs, teamId, 0, xPts, pts, grade 0 great / 1 avg / 2 bad]
 *   poss  [period, secs at its last play, teamId, 1, transition 0/1, pts, ended on a free throw 0/1, second-chance pts]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isFG, family, greenLights, grade } from './lib_shotfamily.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data'), CACHE = path.join(DATA, 'espn_pbp_cache');
const SUM = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
const GRADES = ['great', 'avg', 'bad'];
const TRANS_SECS = 10;

const tt = (p) => (p.type && p.type.text) || '';
const isFT = (p) => p.shootingPlay && /FreeThrow|Free Throw/i.test(tt(p) + ' ' + (p.text || ''));
const isReb = (p) => /Rebound/i.test(tt(p));
const isTO = (p) => /Turnover/i.test(tt(p)) && !/^\s*Foul on/i.test(p.text || '');
const isSteal = (p) => /steal/i.test(tt(p));
const clk = (p) => { const v = String((p.clock && p.clock.displayValue) || '').trim(); const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v); if (m) return +m[1] * 60 + +m[2]; const n = parseFloat(v); return isFinite(n) ? n : null; };
const ath = (p) => p.participants && p.participants[0] && p.participants[0].athlete && String(p.participants[0].athlete.id);
const made = (p) => !!p.scoringPlay;
const pts = (p) => (p.scoringPlay ? (+p.scoreValue || 0) : 0);

// distance band inside a family: the feed's distance when it has one, so a corner three and a 27-footer, or a
// 5-foot and a 14-foot jumper, don't share one make rate
function dist(p) {
  const m = /(\d+)-foot/.exec((p.text || '').toLowerCase());
  if (m) return +m[1];
  const c = p.coordinate;
  if (c && isFinite(c.x) && isFinite(c.y) && !(c.x === 25 && c.y === 0) && c.y >= 0 && c.y < 47) return Math.hypot(c.x - 25, c.y);
  return null;
}
function band(fam, d) {
  if (d == null) return fam + '|?';
  if (fam === 'three' || fam === 'pull3') return fam + '|' + (d < 22.5 ? 'c' : d < 25 ? 'w' : d < 28 ? 'd' : 'x');   // corner-ish / wing / deep / very deep
  if (fam === 'rim') return fam + '|' + (d < 2 ? 0 : 1);
  return fam + '|' + Math.min(4, Math.floor(d / 5));
}

function load(id) {
  const fp = path.join(CACHE, `${id}.json.gz`);
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(fp))); } catch { return null; }
}
async function fetchGame(id) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(SUM + id);
      if (r.ok) { const d = await r.json(); if (d.plays && d.plays.length) fs.writeFileSync(path.join(CACHE, `${id}.json.gz`), zlib.gzipSync(JSON.stringify(d))); return d; }
    } catch {}
    await new Promise((s) => setTimeout(s, 800 * (t + 1)));
  }
  return null;
}

function parse(s, G) {
  const plays = s.plays || [];
  const shots = [], poss = [];
  const ev = [];
  plays.forEach((p, idx) => {
    if (!p.team || !p.team.id) return;
    if (isFG(p) || isFT(p) || isReb(p) || isTO(p)) ev.push({ p, idx, team: String(p.team.id), per: (p.period && p.period.number) || 0 });
  });
  for (const e of ev) {
    if (!isFG(e.p)) continue;
    const c = clk(e.p); if (c == null) continue;
    const f = family(e.p), a = ath(e.p);
    shots.push([e.per, c, e.team, band(f, dist(e.p)), pts(e.p), GRADES.indexOf(grade(f, a ? G[a] : null))]);
  }
  const runs = [];
  for (const e of ev) {
    const last = runs[runs.length - 1];
    if (last && last.team === e.team && last.per === e.per) last.ev.push(e);
    else runs.push({ team: e.team, per: e.per, ev: [e] });
  }
  runs.forEach((r, ri) => {
    const prev = ri > 0 && runs[ri - 1].per === r.per ? runs[ri - 1] : null;
    const first = r.ev[0], end = r.ev[r.ev.length - 1];
    // how the ball was won: a defensive rebound opens the run; a steal is the play right after the other side's turnover
    let anchor = null;
    if (isReb(first.p) && prev) anchor = clk(first.p);
    else if (prev) {
      const pl = prev.ev[prev.ev.length - 1];
      if (isTO(pl.p) && plays.slice(pl.idx + 1, pl.idx + 4).some((q) => isSteal(q) && q.team && String(q.team.id) === r.team)) anchor = clk(pl.p);
    }
    const act = r.ev.find((e) => !isReb(e.p));
    const ac = act ? clk(act.p) : null;
    const trans = anchor != null && ac != null && anchor - ac >= 0 && anchor - ac <= TRANS_SECS ? 1 : 0;
    let total = 0, sc = 0, second = false;
    r.ev.forEach((e, i) => {
      if (i > 0 && isReb(e.p) && !made(r.ev[i - 1].p) && (isFG(r.ev[i - 1].p) || isFT(r.ev[i - 1].p))) second = true;
      const v = (isFG(e.p) || isFT(e.p)) ? pts(e.p) : 0;
      total += v; if (second) sc += v;
    });
    const ec = clk(end.p); if (ec == null) return;
    poss.push([r.per, ec, r.team, 1, trans, total, isFT(end.p) ? 1 : 0, sc]);
  });
  const t = {};
  for (const c of (((s.header || {}).competitions || [{}])[0].competitors || [])) {
    const m = c.team || {};
    t[String(m.id)] = [m.location, m.name, m.displayName, m.shortDisplayName].filter(Boolean).join(' ');
  }
  return { t, shots, poss };
}

async function season(y) {
  const t0 = Date.now();
  const gf = path.join(DATA, 'wowy_cache', `games_${y}.json`);
  if (!fs.existsSync(gf)) { console.log(`${y}: no ${gf} — run build_wowy.py --season ${y} first`); return; }
  const ids = [...new Set(Object.values(JSON.parse(fs.readFileSync(gf, 'utf8'))).map((g) => String(g.id)))].sort();
  const mf = path.join(DATA, 'mastery', `${y}.json`);
  const G = {};
  if (fs.existsSync(mf)) { const M = JSON.parse(fs.readFileSync(mf, 'utf8')), C = M.pcols.length; for (const r of M.players) G[String(r[0])] = greenLights(r.slice(C)); }
  else console.log(`${y}: no mastery file — every non-rim shot grades as unproven`);
  fs.mkdirSync(CACHE, { recursive: true });
  const P = {}; let miss = 0, fetched = 0;
  const q = ids.slice();
  async function worker() {
    while (q.length) {
      const id = q.shift();
      let s = load(id);
      if (!s) { s = await fetchGame(id); fetched++; }
      if (!s || !(s.plays || []).length) { miss++; continue; }
      try { P[id] = parse(s, G); } catch { miss++; }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  // D-I make rate per family × distance band, shrunk toward the family's rate
  const B = {}, Fm = {};
  for (const g of Object.values(P)) for (const [, , , k, v] of g.shots) {
    const f = k.split('|')[0];
    (B[k] = B[k] || [0, 0]); B[k][0]++; B[k][1] += v;
    (Fm[f] = Fm[f] || [0, 0]); Fm[f][0]++; Fm[f][1] += v;
  }
  const XP = {};
  for (const [k, [n, v]] of Object.entries(B)) { const f = Fm[k.split('|')[0]]; XP[k] = (v + 50 * f[1] / f[0]) / (n + 50); }
  const games = {};
  let ns = 0, np = 0, sx = 0, sv = 0, pt = 0, ptr = 0;
  for (const id of Object.keys(P).sort()) {
    const g = P[id];
    const e = g.shots.map(([per, c, tm, k, v, gr]) => { ns++; sx += XP[k]; sv += v; return [per, c, tm, 0, +XP[k].toFixed(3), v, gr]; })
      .concat(g.poss.map((x) => { np++; pt += x[5]; ptr += x[4]; return x; }));
    games[id] = { t: g.t, e };
  }
  const out = path.join(DATA, 'wowy_cache', `shotev_${y}.json.gz`);
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify({ season: y, built: new Date().toISOString(), xp: XP, games })));
  console.log(`${y}: ${Object.keys(games).length}/${ids.length} games (${miss} without ESPN play-by-play, ${fetched} fetched) · ${ns.toLocaleString()} shots, ` +
    `${(sv / ns).toFixed(3)} pts/shot vs ${(sx / ns).toFixed(3)} expected · ${np.toLocaleString()} possessions, PPP ${(pt / np).toFixed(3)}, ` +
    `${(100 * ptr / np).toFixed(1)}% transition · ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`);
}

const ys = process.argv.slice(2).map(Number).filter(Boolean);
for (const y of (ys.length ? ys : [2026])) await season(y);
