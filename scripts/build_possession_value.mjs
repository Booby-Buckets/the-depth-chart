#!/usr/bin/env node
/* build_possession_value.mjs — "Hunt great" and "your offense protects your defense" (Josh Schertz, SLU).
 *
 * Rebuilds every D-I vs D-I possession from ESPN play-by-play (the same run-of-events method as
 * build_shot_aftermath.mjs) and measures:
 *   1. Shot clock: every FGA graded by when it came and what it was.
 *        early = 0-7 s after the ball was won (or an offensive rebound), set = 8-20 s, late = 21+ s
 *        great = a rim attempt, or a shot the shooter has a green light on (Mastery Shots, 1.1+ pts/shot)
 *        avg   = a three by a shooter without a green light on threes
 *        bad   = a tough two or pull-up three by a shooter without a green light on it
 *   2. Turnovers: live-ball (a steal) vs dead-ball, and what the opponent scored on the next possession.
 *   3. Missed rim attempts that ended the possession (the defense rebounded), and what the opponent scored next —
 *      against the same after a made shot and after any other miss.
 * Green lights come from scripts/data/mastery/<y>.json, so build that season first.
 *
 *   node scripts/build_possession_value.mjs 2026
 * Writes scripts/data/possession_value/<y>.json and index.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAM, isFG, family, greenLights, grade } from './lib_shotfamily.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const SUM = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
const OUT = path.join(HERE, 'data', 'possession_value');
const BUCKETS = ['early', 'set', 'late'], GRADES = ['great', 'avg', 'bad'];

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
const isFT = (p) => p.shootingPlay && /FreeThrow|Free Throw/i.test(tt(p) + ' ' + (p.text || ''));
const isReb = (p) => /Rebound/i.test(tt(p));
const isTO = (p) => /Turnover/i.test(tt(p)) && !/^\s*Foul on/i.test(p.text || '');
const isSteal = (p) => /^Steal$/i.test(tt(p)) || /steal/i.test(tt(p));
const clk = (p) => { const v = String((p.clock && p.clock.displayValue) || '').trim(); const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v); if (m) return +m[1] * 60 + +m[2]; const n = parseFloat(v); return isFinite(n) ? n : null; };
const ath = (p) => p.participants && p.participants[0] && p.participants[0].athlete && String(p.participants[0].athlete.id);
const bucket = (d) => d <= 7 ? 0 : d <= 20 ? 1 : 2;
// clock[bucket][grade] = [att, pts]  -> stored flat: 3 buckets × 3 grades × 2
const clockBlank = () => new Array(18).fill(0);
const add = (a, k, pts) => { a[k] += 1; a[k + 1] += pts; };
const teamBlank = () => ({ poss: 0, pts: 0, clock: clockBlank(), toLive: [0, 0], toDead: [0, 0], rimMiss: [0, 0], otherMiss: [0, 0], made: [0, 0] });
const plBlank = () => ({ clock: clockBlank(), toLive: [0, 0], toDead: [0, 0], rimMiss: [0, 0] });

function parse(s, X, G) {
  const plays = s.plays || [];
  const ev = [];
  plays.forEach((p, idx) => {
    if (!p.team || !p.team.id) return;
    if (isFG(p) || isFT(p) || isReb(p) || isTO(p)) ev.push({ p, idx, team: String(p.team.id), per: (p.period && p.period.number) || 0 });
  });
  const runs = [];
  for (const e of ev) {
    const last = runs[runs.length - 1];
    if (last && last.team === e.team && last.per === e.per) last.ev.push(e);
    else runs.push({ team: e.team, per: e.per, ev: [e] });
  }
  for (const r of runs) r.pts = r.ev.reduce((a, e) => a + (e.p.scoringPlay && (isFG(e.p) || isFT(e.p)) ? (+e.p.scoreValue || 0) : 0), 0);
  const T = (id) => (X.t[id] = X.t[id] || teamBlank());
  const P = (id) => (X.p[id] = X.p[id] || plBlank());
  runs.forEach((r, ri) => {
    const t = T(r.team); t.poss++; t.pts += r.pts; X.lg.poss++; X.lg.pts += r.pts;
    const prev = ri > 0 && runs[ri - 1].per === r.per ? runs[ri - 1] : null;
    const next = runs[ri + 1] && runs[ri + 1].team !== r.team && runs[ri + 1].per === r.per ? runs[ri + 1] : null;
    // 1. shot clock: the anchor is when the ball was won, reset by each offensive rebound
    let anchor = isReb(r.ev[0].p) ? clk(r.ev[0].p) : prev ? clk(prev.ev[prev.ev.length - 1].p) : (r.per <= 2 ? 1200 : 300);
    r.ev.forEach((e, i) => {
      if (i > 0 && isReb(e.p)) { anchor = clk(e.p); return; }
      if (!isFG(e.p)) return;
      const c = clk(e.p); if (anchor == null || c == null) return;
      const d = anchor - c; if (d < 0 || d > 40) return;
      const a = ath(e.p), f = family(e.p), gr = GRADES.indexOf(grade(f, a ? G[a] : null)), k = (bucket(d) * 3 + gr) * 2;
      const pts = e.p.scoringPlay ? (+e.p.scoreValue || 0) : 0;
      add(t.clock, k, pts); add(X.lg.clock, k, pts);
      if (a && G[a] !== undefined) add(P(a).clock, k, pts);
    });
    if (!next) return;
    // 2-3. how the possession ended, and what the opponent did next
    const last = r.ev[r.ev.length - 1];
    if (isTO(last.p)) {
      const stolen = plays.slice(last.idx + 1, last.idx + 4).some((q) => isSteal(q) && q.team && String(q.team.id) !== r.team);
      const key = stolen ? 'toLive' : 'toDead';
      t[key][0]++; t[key][1] += next.pts; X.lg[key][0]++; X.lg[key][1] += next.pts;
      const a = ath(last.p); if (a && G[a] !== undefined) { P(a)[key][0]++; P(a)[key][1] += next.pts; }
    } else if (isFG(last.p) && isReb(next.ev[0].p)) {
      // a missed shot the defense rebounded
      const rim = !last.p.scoringPlay && family(last.p) === 'rim';
      const key = last.p.scoringPlay ? null : rim ? 'rimMiss' : 'otherMiss';
      if (key) { t[key][0]++; t[key][1] += next.pts; X.lg[key][0]++; X.lg[key][1] += next.pts; }
      const a = ath(last.p); if (rim && a && G[a] !== undefined) { P(a).rimMiss[0]++; P(a).rimMiss[1] += next.pts; }
    } else if (isFG(last.p) && last.p.scoringPlay) {
      t.made[0]++; t.made[1] += next.pts; X.lg.made[0]++; X.lg.made[1] += next.pts;
    }
  });
}

async function season(y) {
  const t0 = Date.now();
  const mf = path.join(HERE, 'data', 'mastery', `${y}.json`);
  if (!fs.existsSync(mf)) { console.log(`${y}: no mastery file — run build_mastery.mjs ${y} first`); return; }
  const M = JSON.parse(fs.readFileSync(mf, 'utf8')), C = M.pcols.length, G = {};
  for (const r of M.players) G[String(r[0])] = greenLights(r.slice(C));
  const ts = await sb(`team_seasons?season_year=eq.${y}&select=team_id&order=team_id.asc`);
  const d1 = new Set(ts.map((t) => String(t.team_id)));
  const games = (await sb(`games?season_year=eq.${y}&status=eq.STATUS_FINAL&select=id,home_id,away_id&order=id.asc`))
    .filter((g) => d1.has(String(g.home_id)) && d1.has(String(g.away_id)));
  const X = { t: {}, p: {}, lg: teamBlank() };
  let done = 0, empty = 0;
  const q = games.slice();
  async function worker() {
    while (q.length) {
      const g = q.shift();
      const s = await espn(g.id);
      done++;
      if (!s || !(s.plays || []).length) { empty++; continue; }
      try { parse(s, X, G); } catch (e) { empty++; }
      if (done % 1000 === 0) process.stdout.write(`  ${y}: ${done}/${games.length} games\n`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const tRow = (id, t) => [id, t.poss, t.pts, ...t.clock, ...t.toLive, ...t.toDead, ...t.rimMiss, ...t.otherMiss, ...t.made];
  const out = {
    season: y, built: new Date().toISOString(), games: games.length, missing: empty,
    buckets: BUCKETS, grades: GRADES,
    tcols: ['id', 'poss', 'pts', 'clock×18', 'toLive×2', 'toDead×2', 'rimMiss×2', 'otherMiss×2', 'made×2'],
    pcols: ['id', 'clock×18', 'toLive×2', 'toDead×2', 'rimMiss×2'],
    league: tRow('D-I', X.lg),
    teams: Object.entries(X.t).filter(([id]) => d1.has(id)).map(([id, t]) => tRow(id, t)),
    players: Object.entries(X.p).map(([id, p]) => [id, ...p.clock, ...p.toLive, ...p.toDead, ...p.rimMiss]),
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${y}.json`), JSON.stringify(out));
  const L = X.lg, ppp = (a) => (a[0] ? (a[1] / a[0]).toFixed(3) : '—');
  console.log(`${y}: ${games.length} games (${empty} without play-by-play), ${L.poss.toLocaleString()} possessions, PPP ${(L.pts / L.poss).toFixed(3)} · opp next PPP after live TO ${ppp(L.toLive)}, dead TO ${ppp(L.toDead)}, missed rim ${ppp(L.rimMiss)}, other miss ${ppp(L.otherMiss)}, made FG ${ppp(L.made)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const ys = process.argv.slice(2).map(Number).filter(Boolean);
for (const y of (ys.length ? ys : [2026])) await season(y);
const idx = fs.readdirSync(OUT).map((f) => /^(\d{4})\.json$/.exec(f)).filter(Boolean).map((m) => +m[1]).sort((a, b) => b - a);
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ built: new Date().toISOString(), seasons: idx }));
