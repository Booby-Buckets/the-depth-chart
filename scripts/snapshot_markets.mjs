// Daily price snapshot for the Betting Lab's Markets tab (tdc-markets.js): runs the same season + tournament
// simulation the page runs (TDCPost.run, tdc-postseason.js on top of tdc-schedule / tdc-conftourney / tdc-ratings),
// in headless Chrome against a static server on the repo root, and appends today's prices to
// scripts/data/market_history_2027.json so the cards can draw Kalshi-style price lines.
//
// File shape (compact on purpose — one row a day for a whole season):
//   { season, note, teams:[full name…], days:{ 'YYYY-MM-DD': { sims, champ:[[i,p1000]…], f4, one, ncaa,
//     conf:{CODE:[[i,p1000]…]}, ct:{CODE:[[i,p1000]…]} } } }
// i = index into teams, p1000 = chance × 1000 (0.1-point resolution). Small chances are dropped.
//
//   python3 -m http.server 8765 &  BASE=http://localhost:8765/ node scripts/snapshot_markets.mjs
//   PUPPETEER_MODULE=/abs/path/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js CHROME_PATH=… (local runs)
//   SIMS=4000 (default) · DATE=YYYY-MM-DD to file under another day
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = path.join(ROOT, 'scripts/data/market_history_2027.json');
const SIMS = +process.env.SIMS || 4000;
const DAY = process.env.DATE || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);   // US-Eastern-ish day

// the exact scripts (and ?v= versions) the Betting Lab loads, so the snapshot prices match the page
function pageScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'betting.html'), 'utf8');
  return ['team-colors.js', 'tdc-ratings.js', 'tdc-schedule.js', 'tdc-conftourney.js', 'tdc-postseason.js'].map(f => {
    const m = html.match(new RegExp('src="(' + f.replace(/[.]/g, '\\.') + '[^"]*)"'));
    if (!m) throw new Error('betting.html no longer loads ' + f);
    return m[1];
  });
}

const pp = (await import(process.env.PUPPETEER_MODULE || 'puppeteer')).default;
const browser = await pp.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let res;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 200)));
  await page.goto(BASE + '__market_snapshot__', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.setContent(`<!doctype html><html><head><base href="${BASE}"></head><body></body></html>`);
  for (const s of pageScripts()) await page.addScriptTag({ url: BASE + s });
  res = await page.evaluate(async (SIMS) => {
    const r = await window.TDCPost.run({ sims: SIMS, fresh: true });
    if (!r) return null;
    const teams = r.teams.filter(t => !t.ineligible).map(t => ({ n: t.team, champ: t.champ || 0, f4: t.f4 || 0, one: (t.seed && t.seed[1]) || 0, ncaa: t.ncaa || 0 }));
    const conf = {}, ct = {};
    Object.keys(r.CT).forEach(c => { const C = r.CT[c]; if (!C || !C.teams) return;
      conf[c] = C.teams.map(t => [t.team, t.title || 0]); ct[c] = C.teams.map(t => [t.team, t.champ || 0]); });
    return { sims: r.sims, teams, conf, ct };
  }, SIMS);
} finally { await browser.close(); }
if (!res || !res.teams || res.teams.length < 300) { console.error('simulation came back empty or short — not writing'); process.exit(1); }

const H = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { season: '2027', teams: [], days: {} };
H.note = 'Daily Markets prices (scripts/snapshot_markets.mjs): [team index, chance x 1000]; small chances dropped.';
const ix = {}; H.teams.forEach((n, i) => { ix[n] = i; });
const id = n => { if (ix[n] == null) { ix[n] = H.teams.length; H.teams.push(n); } return ix[n]; };
const pk = (list, min, cap) => list.filter(x => x[1] >= min).sort((a, b) => b[1] - a[1]).slice(0, cap).map(x => [id(x[0]), Math.round(x[1] * 1000)]);
const T = res.teams;
const day = {
  sims: res.sims,
  champ: pk(T.map(t => [t.n, t.champ]), 0.001, 40),
  f4: pk(T.map(t => [t.n, t.f4]), 0.003, 40),
  one: pk(T.map(t => [t.n, t.one]), 0.003, 30),
  ncaa: pk(T.map(t => [t.n, t.ncaa]).filter(x => x[1] < 0.999), 0.03, 110),   // the bubble and everyone near it
  conf: {}, ct: {},
};
Object.keys(res.conf).forEach(c => { day.conf[c] = pk(res.conf[c], 0.005, 10); day.ct[c] = pk(res.ct[c], 0.005, 10); });
H.days[DAY] = day;
// keep the file ordered by date, and small: every day for the last 45, one a week before that
const ents = Object.entries(H.days).sort((a, b) => a[0].localeCompare(b[0]));
const cut = new Date(new Date(DAY + 'T12:00:00Z') - 45 * 864e5).toISOString().slice(0, 10);
let lastKept = null;
H.days = Object.fromEntries(ents.filter(([d]) => {
  if (d >= cut) return true;
  if (lastKept && (new Date(d) - new Date(lastKept)) / 864e5 < 7) return false;
  lastKept = d; return true;
}));
fs.writeFileSync(OUT, JSON.stringify(H));
console.log(`market history: ${DAY} · ${res.sims} sims · ${Object.keys(H.days).length} days · ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
