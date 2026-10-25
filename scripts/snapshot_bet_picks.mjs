// TDC Bet's pick log: freezes our line for every upcoming game BEFORE tip, so bet/record.html can grade the
// model honestly (no hindsight: in-season ratings move every night, so re-pricing a played game later would
// grade tomorrow's model on yesterday's games).
//
// Runs the page's own engine (bet/bet-core.js on top of tdc-ratings.js) in headless Chrome, prices every game
// dated today (US-Eastern) through the next 2 days, and writes them into scripts/data/bet_picks_2027.json.
// Days before today are never touched again; today's entries are refreshed by each pre-tip run (the nightly
// workflow runs ~6:30 ET, hours before the first tip).
//
// File shape: { season, note, picks: { <game id>: { d, h, a, n, m, t, ph, bs, bt, at, best:[{k, side, line, p, kind, label}] } } }
//   m = our home margin · t = our total · ph = home win % · bs/bt = book home spread (home's line, −4.5 = home laying)
//   / book total when the feed had one · best = the best bets the page showed (k: sp | to | pr)
//
//   --edges  ALSO log the edge board (bet/bet-edge.js against scripts/data/odds_live.json): every bet the board
//            lists, at the price and book it showed, keeps updating its CLOSING price until tip, so record.html can
//            grade results AND closing-line value. Run right after each odds pull (archive-odds.yml).
//
//   python3 -m http.server 8765 &  BASE=http://localhost:8765/ node scripts/snapshot_bet_picks.mjs [--edges]
//   PUPPETEER_MODULE=/abs/path/puppeteer/lib/esm/puppeteer/puppeteer.js CHROME_PATH=… (local runs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = path.join(ROOT, 'scripts/data/bet_picks_2027.json');
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const TODAY = process.env.DATE || etDay(Date.now());
const LAST = etDay(new Date(TODAY + 'T12:00:00Z').getTime() + 2 * 864e5);
const EDGES = process.argv.includes('--edges');

// the exact scripts (and ?v= versions) TDC Bet loads, so the log matches the page
function pageScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'bet/index.html'), 'utf8');
  return ['team-colors.js', 'tdc-ratings.js', 'bet/bet-core.js'].concat(EDGES ? ['bet/cbb-live.js', 'bet/bet-edge.js'] : []).map(f => {
    const m = html.match(new RegExp('src="(' + f.replace(/[.]/g, '\\.') + '[^"]*)"'));
    if (!m) throw new Error('bet/index.html no longer loads ' + f);
    return m[1];
  });
}

const pp = (await import(process.env.PUPPETEER_MODULE || 'puppeteer')).default;
const browser = await pp.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let res;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 200)));
  await page.goto(BASE + '__bet_snapshot__', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.setContent(`<!doctype html><html><head><base href="${BASE}"></head><body></body></html>`);
  for (const s of pageScripts()) await page.addScriptTag({ url: BASE + s });
  res = await page.evaluate(async (from, to) => {
    const B = window.TDCBet;
    const S = await B.load(); await B.loadProps();
    const out = {};
    S.dates.filter(d => d >= from && d <= to).forEach(d => {
      const rows = B.slate(d), cands = B.propCands(rows), bets = B.bets(rows, cands);
      rows.forEach(r => {
        if (r.exh) return;
        out[r.id] = { d, h: r.home, a: r.away, n: r.neutral ? 1 : 0, m: r.m, t: r.tot != null ? +r.tot.toFixed(1) : null, ph: r.probH,
          bs: r.mk && r.mk.spread != null ? -r.mk.spread : null, bt: r.mk && r.mk.total != null ? r.mk.total : null, best: [] };
      });
      bets.best.forEach(b => {
        const s = b.sel; if (!s || !out[s.gid]) return;
        out[s.gid].best.push({ k: { spread: 'sp', total: 'to', prop: 'pr' }[s.market], side: s.side, line: s.line, p: +s.p.toFixed(3), kind: b.kind, label: s.label,
          pid: s.pid || undefined, stat: s.stat || undefined, conf: b.conf });
      });
    });
    // edge board: every priced outcome (for closing prices) + which ones the board lists right now
    let edges = null;
    if (window.TDCEdge) {
      await TDCEdge.load();
      // free live prices (DraftKings via ESPN, Kalshi via the site's pass-through, Polymarket) fill any game the paid feed lacks
      window.TDC_KALSHI_BASE = 'https://bet.thedepthchartcbb.com/api/kalshi';
      const days = S.dates.filter(d => d >= from && d <= to);
      if (window.TDCLive && days.length) await TDCEdge.live(B.slate(days[0]));
      if (TDCEdge.has() || window.TDCLive) {
        edges = {};
        for (const d of days) {
          if (window.TDCLive) await TDCEdge.live(B.slate(d));
          const rows = B.slate(d).filter(r => !r.exh);
          const listed = new Set();
          const board = TDCEdge.board(rows).concat(await TDCEdge.props(rows));
          const gkey = b => [b.gid, b.market, b.side, b.team || '', b.pid || '', b.stat || ''].join('|');
          board.forEach(b => listed.add(gkey(b)));
          const all = TDCEdge.board(rows, { minEv: -9, showSuspect: true }).concat(await TDCEdge.props(rows, { all: true }));
          rows.forEach(r => { const gm = TDCEdge.game(r); if (gm) gm.bets.forEach(b => { if (b.market === 'alt') return; const k = gkey(b); if (!all.some(x => gkey(x) === k)) all.push(b); }); });
          all.forEach(b => {
            const k = gkey(b);
            edges[k] = { d: b.date, gid: b.gid, tip: b.tip, m: b.market, side: b.side, team: b.team, pid: b.pid, stat: b.stat, label: b.label, listed: listed.has(k),
              best: { book: b.book, price: b.price, point: b.point, p: +b.p.toFixed(4), ev: +b.ev.toFixed(4), kelly: +b.kelly.toFixed(4) },
              offers: (b.offers || [b]).map(o => [o.book, o.point, o.price, o.pMkt == null ? null : +o.pMkt.toFixed(4)]) };
          });
        }
      }
    }
    return { n: S.teams.length, picks: out, edges };
  }, TODAY, LAST);
} finally { await browser.close(); }
if (!res || res.n < 300) { console.error('ratings came back empty or short — not writing'); process.exit(1); }

const H = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { season: 2027, picks: {} };
H.note = 'TDC Bet pick log (scripts/snapshot_bet_picks.mjs): our line for each game, frozen before tip. Days before the run date are never rewritten.';
const at = new Date().toISOString();
let added = 0, kept = 0;
Object.entries(res.picks).forEach(([id, p]) => {
  const old = H.picks[id];
  if (old && old.d < TODAY) { kept++; return; }          // already played (or in the past): frozen
  H.picks[id] = Object.assign(p, { at }); added++;
});
// edges: a bet is logged the first time the board LISTS it (that's the price you'd have taken); until tip, every run
// refreshes its closing numbers. CLV = the closing market's chance for our exact bet minus our price's implied chance.
if (res.edges) {
  H.edges = H.edges || {};
  const now = Date.now(), imp = o => o > 0 ? 100 / (o + 100) : -o / (-o + 100);
  let logged = 0, closed = 0;
  Object.entries(res.edges).forEach(([k, e]) => {
    const tipMs = e.tip ? Date.parse(e.tip) : null;
    if (tipMs && tipMs <= now) return;                                  // started: frozen
    const old = H.edges[k];
    if (!old && !e.listed) return;                                      // only bets the board actually showed
    const rec = old || { d: e.d, gid: e.gid, tip: e.tip, m: e.m, side: e.side, team: e.team, pid: e.pid, stat: e.stat, label: e.label, bet: Object.assign({ at }, e.best) };
    if (!old) logged++;
    // closing: the market's chance for OUR bet at our point (nearest offered point), and the best price now
    const sameP = e.offers.filter(o => o[1] === rec.bet.point && o[3] != null);
    const near = sameP.length ? sameP : e.offers.filter(o => o[3] != null).sort((a, b) => Math.abs(a[1] - rec.bet.point) - Math.abs(b[1] - rec.bet.point)).slice(0, 1);
    if (near.length) {
      const pm = near.map(o => o[3]).sort((a, b) => a - b)[Math.floor(near.length / 2)];
      rec.close = { at, pMkt: pm, best: e.best.price, point: e.best.point, clv: +(pm - imp(rec.bet.price)).toFixed(4) };
      closed++;
    }
    H.edges[k] = rec;
  });
  console.log(`edges: ${logged} newly logged · ${closed} closing prices refreshed · ${Object.keys(H.edges).length} total`);
}
const json = JSON.stringify(H);
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (json !== prev) fs.writeFileSync(OUT, json);
console.log(`bet picks: ${TODAY}..${LAST} · ${added} priced · ${kept} frozen kept · ${Object.keys(H.picks).length} total · ${(json.length / 1024).toFixed(0)} KB`);
