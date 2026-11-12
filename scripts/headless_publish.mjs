// Headless owner-console publish: does what the three owner-console buttons do, with no browser tab open.
//   1. Publish team projections   → team_projections (rows from build_team_projected_box.py)
//   2. Republish projected ratings → predictive_ratings (the SAME tdc-ratings.js engine, run in headless Chrome
//                                    against the freshly built data files, with the owner's freshman projections)
//   3. Republish awards            → award_projections (tdc-awards.js, from the same grades)
//
// Runs at the end of rebuild-projections.yml. Needs SUPABASE_SERVICE_KEY (repo secret) and a static server
// on the repo root (BASE, default http://localhost:8765/). The page code is unchanged: writes it makes are
// intercepted, allowed ONLY to predictive_ratings / award_projections, sanity-checked, and re-signed with
// the service key. Nothing else can be written.
//
//   DRY=1 node scripts/headless_publish.mjs      # compute + validate, write nothing
//   PUPPETEER_MODULE=/abs/path/to/puppeteer-core CHROME_PATH=... (local runs without the npm install)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8765/';
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DRY = !!process.env.DRY;
if (!KEY && !DRY) { console.error('SUPABASE_SERVICE_KEY not set (use DRY=1 to test)'); process.exit(1); }
const W = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const t0 = new Date();
const log = (...a) => console.log(...a);

// ── 1. team projections ─────────────────────────────────────────────────────────────────────────────
async function publishTeamProjections() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/team_projections_rows.json'), 'utf8'));
  const rows = (j && j.rows) || [];
  if (rows.length < 60) throw new Error(`only ${rows.length} team_projections rows in the build — not publishing`);
  if (DRY) { log(`[dry] team_projections: would upsert ${rows.length} rows`); return; }
  for (let i = 0; i < rows.length; i += 40) {
    const r = await fetch(`${SB}/rest/v1/team_projections?on_conflict=team`, { method: 'POST',
      headers: { ...W, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 40)) });
    if (!r.ok) throw new Error(`team_projections write failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }
  const keep = new Set(rows.map(x => x.team));
  const cur = await (await fetch(`${SB}/rest/v1/team_projections?select=team`, { headers: W })).json();
  const extra = (cur || []).map(x => x.team).filter(t => !keep.has(t));
  if (extra.length) {
    const q = extra.map(t => encodeURIComponent('"' + t.replace(/"/g, '') + '"')).join(',');
    const d = await fetch(`${SB}/rest/v1/team_projections?team=in.(${q})`, { method: 'DELETE', headers: W });
    log(d.ok ? `team_projections: removed ${extra.length} without a roster (${extra.join(', ')})` : `team_projections: could not remove ${extra.join(', ')}`);
  }
  log(`team_projections: published ${rows.length} teams`);
}

// ── 2 + 3. ratings + awards in headless Chrome ──────────────────────────────────────────────────────
function ownerScripts() {
  // the exact scripts (and ?v= versions) the owner console loads for these jobs, so this can never drift
  const html = fs.readFileSync(path.join(ROOT, 'owner.html'), 'utf8');
  const want = ['team-colors.js', 'tdc-projgrade.js', 'tdc-freshman.js', 'tdc-injury.js', 'tdc-ratings.js', 'tdc-awards.js'];
  return want.map(f => { const m = html.match(new RegExp('src="(' + f.replace(/[.]/g, '\\.') + '[^"]*)"')); if (!m) throw new Error('owner.html no longer loads ' + f); return m[1]; });
}
function sane(table, body) {
  const d = body && body.data;
  if (table === 'predictive_ratings') {
    const T = (d && d.teams) || [];
    if (T.length < 300) return `only ${T.length} teams`;
    const r = T.map(t => t.rating);
    if (!r.every(Number.isFinite)) return 'non-finite rating';
    const mx = Math.max(...r), mn = Math.min(...r);
    if (mx < 10 || mx > 45 || mn < -45) return `implausible range ${mn.toFixed(1)}..${mx.toFixed(1)}`;
    return null;
  }
  if (table === 'award_projections') return d && typeof d === 'object' && Object.keys(d).length ? null : 'empty awards';
  return 'table not allowed';
}

// PASS 1 — the preseason prior: the same page and engine, but the player projections are swapped for the no-real-games
// build (scripts/data/preseason/, REAL_OFF=1) and every write is blocked. Each team's pre-results rating (preRating) is
// the prior pass 2 adds the season's results to — so a game counts once, not again through real-game-blended lines.
const PRE_DIR = path.join(ROOT, 'scripts/data/preseason');
async function preseasonPrior(pp) {
  if (!fs.existsSync(path.join(PRE_DIR, 'stat_overall_projected.json')) || !fs.existsSync(path.join(PRE_DIR, 'fresh_fit.json'))) {
    log('preseason prior: no scripts/data/preseason build — rating from the current projection (results may double count)');
    return null;
  }
  const browser = await pp.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url(), m = req.method();
      if (u.startsWith(SB) && !(m === 'GET' || m === 'HEAD' || m === 'OPTIONS')) return req.abort();   // pass 1 never writes
      const f = (u.match(/scripts\/data\/(stat_overall_projected|fresh_fit)\.json/) || [])[1];
      if (f) return req.respond({ status: 200, contentType: 'application/json', body: fs.readFileSync(path.join(PRE_DIR, f + '.json')) });
      req.continue();
    });
    await page.goto(BASE + '__headless_publish__', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.setContent(`<!doctype html><html><head><base href="${BASE}"><script>window.tdcOwnerToken=function(){return 'headless';};try{localStorage.clear();}catch(e){}</script></head><body></body></html>`);
    for (const s of ownerScripts()) await page.addScriptTag({ url: BASE + s });
    const pri = await page.evaluate(async () => {
      if (window.TDCProjGrade && TDCProjGrade.ready) await TDCProjGrade.ready;
      if (window.TDCFresh && TDCFresh.load) await TDCFresh.load();
      if (window.TDCInjury && TDCInjury.load) { try { await TDCInjury.load(); } catch (e) {} }
      const ovr = (window.TDCFresh && TDCFresh.ratingOverrides) ? TDCFresh.ratingOverrides() : null;
      const d = await TDC_RATINGS.rebuild(ovr);
      const o = {}; d.teams.forEach(t => { const v = t.preRating != null ? t.preRating : t.rating; if (t.full && Number.isFinite(+v)) o[t.full] = +v; });
      return o;
    });
    const n = Object.keys(pri).length;
    if (n < 300) { log(`preseason prior: only ${n} teams — not using it`); return null; }
    log(`preseason prior: ${n} teams rated with no real games`);
    return pri;
  } finally { await browser.close(); }
}

async function publishRatingsAndAwards() {
  const pp = (await import(process.env.PUPPETEER_MODULE || 'puppeteer')).default;
  let PRIOR = null; try { PRIOR = await preseasonPrior(pp); } catch (e) { log('preseason prior failed: ' + (e.message || e)); }
  const browser = await pp.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const wrote = {};
  try {
    const page = await browser.newPage();
    page.on('response', r => { if (r.status() >= 400 && !r.url().includes('__headless_publish__')) log(`  [${r.status()}] ${r.url().slice(0, 160)}`); });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url(), m = req.method();
      if (!u.startsWith(SB) || m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return req.continue();
      const table = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
      let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
      const bad = (table === 'predictive_ratings' || table === 'award_projections') ? sane(table, body) : 'not allowed';
      if (bad) { log(`  ✗ blocked ${m} ${table}: ${bad}`); wrote[table] = 'blocked: ' + bad; return req.abort(); }
      if (DRY) { log(`  [dry] would write ${table}`); wrote[table] = 'dry'; return req.abort(); }
      wrote[table] = 'sent';
      req.continue({ headers: { ...req.headers(), apikey: KEY, authorization: 'Bearer ' + KEY } });
    });
    await page.goto(BASE + '__headless_publish__', { waitUntil: 'domcontentloaded' }).catch(() => {});
    // a blank page AT the site root, so the engines' relative fetches ('scripts/data/...') resolve as on the site
    await page.setContent(`<!doctype html><html><head><base href="${BASE}"><script>window.tdcOwnerToken=function(){return 'headless';};window.TDC_PRIOR=${JSON.stringify(PRIOR)};</script></head><body></body></html>`);
    for (const s of ownerScripts()) await page.addScriptTag({ url: BASE + s });
    const res = await page.evaluate(async () => {
      if (window.TDCProjGrade && TDCProjGrade.ready) await TDCProjGrade.ready;
      if (window.TDCFresh && TDCFresh.load) await TDCFresh.load();
      if (window.TDCInjury && TDCInjury.load) { try { await TDCInjury.load(); } catch (e) {} }
      const ovr = (window.TDCFresh && TDCFresh.ratingOverrides) ? TDCFresh.ratingOverrides() : null;
      const d = await TDC_RATINGS.rebuild(ovr);
      let a = null; try { a = await TDC_AWARDS.refresh(); } catch (e) { a = { error: String(e) }; }
      const top = d.teams.slice().sort((x, y) => y.rating - x.rating).slice(0, 5).map(t => t.team + ' ' + t.rating.toFixed(1));
      const pre = d.teams.filter(t => t.priorSrc === 'preseason'), drift = pre.length ? pre.reduce((a, t) => a + Math.abs(t.rosterNow - t.preRating), 0) / pre.length : 0;
      return { n: d.teams.length, top, pre: pre.length, drift: +drift.toFixed(2), scrim: d.teams.filter(t => t.scrimAdj).length, awards: a && a.conferences ? Object.keys(a.conferences).length : a };
    });
    log(`ratings: computed ${res.n} teams (top: ${res.top.join(', ')}); ${res.pre} on the preseason prior (avg |real-blended roster − prior| ${res.drift}); ${res.scrim} with a scrimmage adjustment; awards: ${JSON.stringify(res.awards)}`);
  } finally { await browser.close(); }
  return wrote;
}

async function verify() {
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  for (const t of ['predictive_ratings', 'award_projections']) {
    const r = await (await fetch(`${SB}/rest/v1/${t}?season=eq.2027&select=updated_at`, { headers: H })).json();
    const u = r && r[0] && r[0].updated_at ? new Date(r[0].updated_at) : null;
    if (!u || u < t0) throw new Error(`${t} was not updated (last ${u ? u.toISOString() : 'never'})`);
    log(`✓ ${t} updated ${u.toISOString()}`);
  }
}

try {
  await publishTeamProjections();
  const wrote = await publishRatingsAndAwards();
  if (!DRY) {
    if (wrote.predictive_ratings !== 'sent') throw new Error('ratings were not written: ' + (wrote.predictive_ratings || 'no write attempted'));
    await new Promise(r => setTimeout(r, 1500));
    await verify();
  }
  log('done');
} catch (e) { console.error('✗', e.message || e); process.exit(1); }
