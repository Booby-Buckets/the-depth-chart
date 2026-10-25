// Free, direct prediction-market prices for TDC Bet's Arbs page: Kalshi + Polymarket US, every major sport, read
// straight from each exchange's PUBLIC market data (no keys, no credits). Prediction markets don't limit winning
// accounts, so they're the side of an arb that matters most.
//
//   GET /api/pm?list=1                    → { sports: [{key, title, group}] }  the sports this endpoint covers
//   GET /api/pm?sport=basketball_nba      → { sport, generated, games: [...], ok: {kalshi, polymarket} }
//        games = one per exchange per game (the page joins them to the sportsbook feed by team names + start time):
//        { src: 'kalshi'|'polymarket', id, commence, home, away, names: {home: [...], away: [...]},
//          book: {t, k:'ex', u, ml, sp, to, cap: {ml, sp, to}, ref: {ml, sp, to}},
//          alt: {sp: [[pt, home, away, capH, capA, refH, refA]], to: [[pt, over, under, capO, capU, refO, refU]]} }
//        Prices are American odds AFTER the exchange's taker fee. cap = dollars you can spend at that price (top of
//        the book; Kalshi only, Polymarket's size needs ?book=). ref = the contract to buy ('k|TICKER|yes',
//        'p|slug|long' …) for ?book=. ml = [home, away], or [home, draw, away] for soccer; sp = [home handicap, …].
//   GET /api/pm?book=k|KXNBAGAME-…|yes,p|aec-nba-…|short   (up to 12)
//        → { books: {ref: [[cost incl. fee, contracts], …]} }  the ask ladder for that side, cheapest first
//
// Kalshi and Polymarket don't send CORS headers, so the page can't read them directly. Public market data only,
// cached ~15 s at the edge so many tabs cost the exchanges one pull.

var KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
var PMUS = 'https://gateway.polymarket.us';
var H = 3600e3;
// sport (the-odds-api key) → Kalshi series stem, Polymarket US league slug, total-line range for the slug grid,
// biggest spread worth looking for, hours from start to Kalshi's "occurrence" time (≈ the end of the game),
// and the total slug's infix (football totals are tsc-<event>-total-<n>)
var SPORTS = {
  basketball_ncaab: { title: 'NCAAB', group: 'Basketball', k: 'NCAAMB', p: 'cbb', tot: [118, 172], spr: 25, len: 2.5 },
  basketball_nba: { title: 'NBA', group: 'Basketball', k: 'NBA', p: 'nba', tot: [198, 252], spr: 20, len: 2.5 },
  basketball_wnba: { title: 'WNBA', group: 'Basketball', k: 'WNBA', p: 'wnba', tot: [148, 182], spr: 16, len: 2.5 },
  americanfootball_nfl: { title: 'NFL', group: 'American Football', k: 'NFL', p: 'nfl', tot: [33, 57], spr: 17, len: 3.25, tsl: 'total-' },
  americanfootball_ncaaf: { title: 'NCAAF', group: 'American Football', k: 'NCAAF', p: 'cfb', tot: [35, 75], spr: 35, len: 3.5, tsl: 'total-' },
  icehockey_nhl: { title: 'NHL', group: 'Ice Hockey', k: 'NHL', p: 'nhl', tot: [4.5, 7.5], spr: 2.5, len: 2.75 },
  baseball_mlb: { title: 'MLB', group: 'Baseball', k: 'MLB', p: 'mlb', tot: [5.5, 12.5], spr: 2.5, len: 3 },
  soccer_epl: { title: 'EPL', group: 'Soccer', k: 'EPL', p: 'epl', soccer: 1 },
  soccer_uefa_champs_league: { title: 'UEFA Champions League', group: 'Soccer', k: 'UCL', p: 'ucl', soccer: 1 },
  soccer_spain_la_liga: { title: 'La Liga - Spain', group: 'Soccer', k: 'LALIGA', p: 'lal', soccer: 1 },
  soccer_italy_serie_a: { title: 'Serie A - Italy', group: 'Soccer', k: 'SERIEA', p: 'sea', soccer: 1 },
  soccer_germany_bundesliga: { title: 'Bundesliga - Germany', group: 'Soccer', k: 'BUNDESLIGA', p: 'bun', soccer: 1 },
  soccer_france_ligue_one: { title: 'Ligue 1 - France', group: 'Soccer', k: 'LIGUE1', p: 'lg1', soccer: 1 },
  soccer_usa_mls: { title: 'MLS', group: 'Soccer', k: 'MLS', p: 'mls', soccer: 1 }
};
// Kalshi's taker fee is 0.07 × multiplier × P × (1 − P) per contract; the multiplier is per series (MLB 0.5, else 1)
var K_MULT = { KXMLBGAME: 0.5, KXMLBSPREAD: 0.5, KXMLBTOTAL: 0.5 };
var HORIZON = 7 * 24 * H;      // games starting in the next week
var MAX_GAMES = 30;            // Polymarket spread/total pulls per sport (one call a game, cached 45 s), soonest first
// margin standard deviation per sport: turns a moneyline into roughly where the spread sits, when Kalshi has no line
var SD = { basketball_ncaab: 11, basketball_nba: 12, basketball_wnba: 11, americanfootball_nfl: 13.5, americanfootball_ncaaf: 15.5 };
var cache = {};

function cached(k, ms) { var c = cache[k]; return c && Date.now() - c.at < ms ? c.data : null; }
function num(v) { var n = parseFloat(v && v.value != null ? v.value : v); return isFinite(n) ? n : null; }
function am(c) { c = Math.min(Math.max(c, 0.005), 0.995); return c >= 0.5 ? Math.round(-100 * c / (1 - c)) : Math.round(100 * (1 - c) / c); }
function withFee(c, theta) { return c + theta * c * (1 - c); }
// each exchange allows ~20-25 public reads a second per IP: keep under it (rolling one-second window per host) and
// back off once on a 429
var RL = {};
function slot(host, max) {
  var t = RL[host] || (RL[host] = []);
  return new Promise(function (res) {
    (function go() { var now = Date.now(); while (t.length && now - t[0] >= 1000) t.shift(); if (t.length < max) { t.push(now); res(); } else setTimeout(go, 1005 - (now - t[0])); })();
  });
}
function get(url, tries) {
  var host = url.indexOf(KALSHI) === 0 ? 'k' : 'p';
  return slot(host, host === 'k' ? 8 : 20).then(function () { return fetch(url, { headers: { 'User-Agent': 'tdc-bet', Accept: 'application/json' } }); })
    .then(function (r) {
      if (r.status === 429 && (tries || 0) < 2) return new Promise(function (res) { setTimeout(res, 1200 * ((tries || 0) + 1)); }).then(function () { return get(url, (tries || 0) + 1); });
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
}
// inverse normal CDF (Acklam's rational approximation; plenty for placing a slug grid)
function probit(p) {
  p = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
    b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
    c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
    d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], q, r;
  if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - 0.02425) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// run f over items, at most n at a time
function pool(items, f, n) {
  var out = new Array(items.length), i = 0;
  function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve(f(items[k])).then(function (v) { out[k] = v; }, function () { out[k] = null; }).then(next); }
  var w = []; for (var j = 0; j < Math.min(n, items.length); j++) w.push(next());
  return Promise.all(w).then(function () { return out; });
}
// the rung nearest a coin flip is the "main" line; every rung rides along as an alternate
function mainOf(rows) { return rows.length ? rows.slice().sort(function (a, b) { return Math.abs(Math.abs(a[1]) - 100) + Math.abs(Math.abs(a[2]) - 100) - Math.abs(Math.abs(b[1]) - 100) - Math.abs(Math.abs(b[2]) - 100); })[0] : null; }
function putMain(book, alt) {
  var s = mainOf(alt.sp), t = mainOf(alt.to);
  if (s) { book.sp = s.slice(0, 3); book.cap.sp = [s[3], s[4]]; book.ref.sp = [s[5], s[6]]; }
  if (t) { book.to = t.slice(0, 3); book.cap.to = [t[3], t[4]]; book.ref.to = [t[5], t[6]]; }
}

// ── Kalshi ──────────────────────────────────────────────────────────────────────────────────────────────────────
var MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
async function kSeries(s, pages) {
  var out = [], cursor = '';
  for (var i = 0; i < pages; i++) {
    var d = await get(KALSHI + '/markets?status=open&limit=1000&series_ticker=' + s + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (!d) break;
    out = out.concat(d.markets || []);
    cursor = d.cursor; if (!cursor || !(d.markets || []).length) break;
  }
  return out;
}
// a live two-sided quote: yes ask + no ask, both real, not a dead 1¢/99¢ book
function kq(m) {
  var ya = num(m.yes_ask_dollars), yb = num(m.yes_bid_dollars), na = num(m.no_ask_dollars), nb = num(m.no_bid_dollars);
  if (!(ya > 0 && ya < 1 && na > 0 && na < 1) || !(yb > 0) || !(nb > 0) || ya - yb > 0.1) return null;
  return { ya: ya, na: na, ys: num(m.yes_ask_size_fp) || 0, ns: num(m.yes_bid_size_fp) || 0 };   // buying NO takes the YES bids
}
async function kalshi(cfg) {
  var stem = 'KX' + cfg.k, ser = [stem + 'GAME', stem + 'SPREAD', stem + 'TOTAL'];
  var lists = await Promise.all(ser.map(function (s, i) { return kSeries(s, i ? 6 : 2); }));
  var ev = {}, now = Date.now();
  lists.forEach(function (list, si) {
    var theta = 0.07 * (K_MULT[ser[si]] || 1);
    list.forEach(function (m) {
      var et = String(m.event_ticker || ''), code = et.split('-').slice(1).join('-'); if (!code) return;
      var occ = Date.parse(m.occurrence_datetime || m.expected_expiration_time || '');
      var e = ev[code] || (ev[code] = { code: code, teams: {}, ml: {}, sp: [], to: [], occ: occ, theta: theta });
      var q = kq(m), suf = String(m.ticker).split('-').pop();
      var leg = function (c, size, side) { return { px: am(withFee(c, theta)), cap: Math.round(size * c), ref: 'k|' + m.ticker + '|' + side }; };
      if (si === 0) {
        e.teams[suf] = m.yes_sub_title || String(m.title || '').replace(/ wins$/, '');
        if (q) e.ml[suf] = leg(q.ya, q.ys, 'yes');
      } else if (q && m.floor_strike != null) {
        var L = +m.floor_strike;
        if (si === 1) e.sp.push({ team: (suf.match(/^[A-Z]+/) || [''])[0], L: L, yes: leg(q.ya, q.ys, 'yes'), no: leg(q.na, q.ns, 'no') });
        else e.to.push({ L: L, yes: leg(q.ya, q.ys, 'yes'), no: leg(q.na, q.ns, 'no') });
      }
    });
  });
  var games = [];
  Object.keys(ev).forEach(function (code) {
    var e = ev[code], codes = Object.keys(e.teams).filter(function (c) { return c !== 'TIE'; });
    if (codes.length !== 2) return;
    // the event code is DATE + first team's code + second team's: away first in US leagues, home first in soccer
    var tail = code.replace(/^\d{2}[A-Z]{3}\d{2}(\d{4})?/, ''), first = tail.indexOf(codes[0]) === 0 ? codes[0] : tail.indexOf(codes[1]) === 0 ? codes[1] : null;
    if (!first) return;
    var second = first === codes[0] ? codes[1] : codes[0], hc = cfg.soccer ? first : second, ac = cfg.soccer ? second : first;
    var dm = code.match(/^(\d{2})([A-Z]{3})(\d{2})/), start = isFinite(e.occ) ? e.occ - (cfg.len || 2) * H : dm ? Date.UTC(2000 + +dm[1], MON[dm[2]], +dm[3], 23) : null;
    if (!start || start < now - 0.25 * H || start > now + HORIZON) return;
    var book = { t: 'Kalshi', k: 'ex', u: new Date().toISOString(), cap: {}, ref: {} }, alt = { sp: [], to: [] };
    var mh = e.ml[hc], ma = e.ml[ac], md = e.ml.TIE;
    if (cfg.soccer) { if (mh && ma && md) { book.ml = [mh.px, md.px, ma.px]; book.cap.ml = [mh.cap, md.cap, ma.cap]; book.ref.ml = [mh.ref, md.ref, ma.ref]; } }
    else if (mh && ma) { book.ml = [mh.px, ma.px]; book.cap.ml = [mh.cap, ma.cap]; book.ref.ml = [mh.ref, ma.ref]; }
    e.sp.forEach(function (s) {          // "X wins by over L": YES = X −L, NO = the other side +L
      var homeX = s.team === hc; if (!homeX && s.team !== ac) return;
      var h = homeX ? s.yes : s.no, a = homeX ? s.no : s.yes;
      alt.sp.push([homeX ? -s.L : s.L, h.px, a.px, h.cap, a.cap, h.ref, a.ref]);
    });
    e.to.forEach(function (t) { alt.to.push([t.L, t.yes.px, t.no.px, t.yes.cap, t.no.cap, t.yes.ref, t.no.ref]); });
    putMain(book, alt);
    if (!book.ml && !book.sp && !book.to) return;
    games.push({ src: 'kalshi', id: 'k:' + code, tail: tail, commence: new Date(start).toISOString(), approx: true, home: e.teams[hc], away: e.teams[ac],
      names: { home: [e.teams[hc]], away: [e.teams[ac]] }, book: book, alt: alt });
  });
  return games;
}

// ── Polymarket US ───────────────────────────────────────────────────────────────────────────────────────────────
// long side costs the best ask; the other side costs 1 − best bid
function pq(m) {
  var b = num(m.bestBidQuote), a = num(m.bestAskQuote);
  if (!(a > 0 && a < 1) || !(b > 0 && b < 1) || a - b > 0.1) return null;
  return { long: a, short: 1 - b, theta: m.feeCoefficient != null ? +m.feeCoefficient : 0.0695 };
}
function teamNames(t) { if (!t) return []; return [t.safeName, t.name, t.alias, t.name && t.abbreviation ? t.abbreviation.toUpperCase() + ' ' + t.name : null].filter(Boolean); }
function slugNum(v) { var s = String(Math.abs(v)); return s.indexOf('.') >= 0 ? s.replace('.', 'pt') : s + 'pt0'; }
async function poly(cfg, sport, kgames) {
  var now = Date.now(), d = await get(PMUS + '/v2/leagues/' + cfg.p + '/events?limit=100');
  var evs = ((d && d.events) || []).filter(function (e) { var t = Date.parse(e.startTime || e.startDate || ''); return !e.closed && t > now - 0.25 * H && t < now + HORIZON; })
    .sort(function (a, b) { return Date.parse(a.startTime) - Date.parse(b.startTime); }).slice(0, MAX_GAMES);
  var out = await pool(evs, async function (e) {
    var home = null, away = null, book = { t: 'Polymarket', k: 'ex', u: new Date().toISOString(), cap: {}, ref: {} }, alt = { sp: [], to: [] };
    var ml = (e.markets || []).filter(function (m) { return m.sportsMarketTypeV2 === 'SPORTS_MARKET_TYPE_MONEYLINE' || m.sportsMarketTypeV2 === 'SPORTS_MARKET_TYPE_DRAWABLE_OUTCOME'; });
    // soccer lists home first ("Chelsea FC vs. Manchester United FC"; its sides' ordering means nothing); elsewhere
    // each moneyline side says which team is home
    if (cfg.soccer) { home = (e.teams || [])[0]; away = (e.teams || [])[1]; }
    else ml.forEach(function (m) { (m.marketSides || []).forEach(function (s) { if (s.team && s.team.ordering === 'home') home = s.team; if (s.team && s.team.ordering === 'away') away = s.team; }); });
    if (!home || !away) return null;
    var leg = function (c, q, slug, side) { return { px: am(withFee(c, q.theta)), cap: null, ref: 'p|' + slug + '|' + side }; };
    if (cfg.soccer) {        // three yes/no markets: home win, draw, away win (regulation time) — buy YES on each
      var by = {};
      ml.forEach(function (m) { var q = pq(m); if (!q) return; var s = String(m.slug), k = /-draw$/.test(s) ? 'd' : s.slice(-((home.abbreviation || '').length + 1)) === '-' + home.abbreviation ? 'h' : s.slice(-((away.abbreviation || '').length + 1)) === '-' + away.abbreviation ? 'a' : null; if (k) by[k] = leg(q.long, q, s, 'long'); });
      if (by.h && by.d && by.a) { book.ml = [by.h.px, by.d.px, by.a.px]; book.cap.ml = [null, null, null]; book.ref.ml = [by.h.ref, by.d.ref, by.a.ref]; }
    } else {
      var m0 = ml[0], q0 = m0 && pq(m0);
      if (q0) {
        var longSide = (m0.marketSides || []).filter(function (s) { return s.long; })[0] || {}, longHome = !!(longSide.team && longSide.team.ordering === 'home');
        var L = leg(q0.long, q0, m0.slug, 'long'), S = leg(q0.short, q0, m0.slug, 'short'), h = longHome ? L : S, a = longHome ? S : L;
        book.ml = [h.px, a.px]; book.cap.ml = [null, null]; book.ref.ml = [h.ref, a.ref];
      }
      // spreads + totals aren't in the league listing: ask for a grid of slugs (asc-<event>-pos|neg-<n> = the away
      // team at ±n, tsc-<event>-<n> = total n); only markets that exist come back. The grid is aimed at Kalshi's lines
      // for the same game (same team codes) when it has them, else at the moneyline (spread) or the sport's range.
      var parts = e.slug.split('-'), tail = ((parts[1] || '') + (parts[2] || '')).toUpperCase();
      var kg = (kgames || []).filter(function (g) { return g.tail === tail && Math.abs(Date.parse(g.commence) - Date.parse(e.startTime)) < 36 * H; })[0];
      var center = kg && kg.book.sp ? -kg.book.sp[0] : null, tcen = kg && kg.book.to ? kg.book.to[0] : null;
      if (center == null && q0 && SD[sport]) center = SD[sport] * probit(longHome ? q0.long : 1 - q0.long);   // home's expected margin = away's fair handicap
      var slugs = [], seen = {}, add = function (sl) { if (!seen[sl]) { seen[sl] = 1; slugs.push(sl); } }, v;
      // away handicap v (+ = getting points); the main line sits near −(home's expected margin)
      var lo = center == null ? -cfg.spr : Math.max(-cfg.spr, Math.round(center) - 5.5), hi = center == null ? cfg.spr : Math.min(cfg.spr, Math.round(center) + 5.5);
      for (v = Math.floor(lo) + 0.5; v <= hi; v += 1) add('asc-' + e.slug + '-' + (v > 0 ? 'pos' : 'neg') + '-' + slugNum(v));
      var tlo = tcen == null ? cfg.tot[0] : tcen - 6, thi = tcen == null ? cfg.tot[1] : tcen + 6;
      for (v = Math.floor(tlo) + 0.5; v <= thi; v += 1) add('tsc-' + e.slug + '-' + (cfg.tsl || '') + slugNum(v));
      var gk = 'g:' + e.slug + ':' + slugs.length, got = cached(gk, 45000);
      if (!got) {
        got = [];
        for (var i = 0; i < slugs.length; i += 75) {
          var r = await get(PMUS + '/v1/markets?limit=200&closed=false&' + slugs.slice(i, i + 75).map(function (s) { return 'slug=' + encodeURIComponent(s); }).join('&'));
          got = got.concat((r && r.markets) || []);
        }
        cache[gk] = { at: Date.now(), data: got };
      }
      got.forEach(function (m) {
        var q = pq(m), line = num(m.line); if (!q || line == null) return;
        var lo = leg(q.long, q, m.slug, 'long'), sh = leg(q.short, q, m.slug, 'short');
        if (/^asc-/.test(m.slug)) {          // long = the AWAY team at `line`; short = home at −line
          var ls = (m.marketSides || []).filter(function (s) { return s.long; })[0] || {}, awayLong = !ls.team || ls.team.ordering !== 'home';
          var ah = awayLong ? line : -line;          // away handicap
          alt.sp.push(awayLong ? [-ah, sh.px, lo.px, null, null, sh.ref, lo.ref] : [-ah, lo.px, sh.px, null, null, lo.ref, sh.ref]);
        } else if (/^tsc-/.test(m.slug)) alt.to.push([line, lo.px, sh.px, null, null, lo.ref, sh.ref]);
      });
    }
    putMain(book, alt);
    if (!book.ml && !book.sp && !book.to) return null;
    return { src: 'polymarket', id: 'p:' + e.slug, commence: e.startTime, home: home.safeName || home.name, away: away.safeName || away.name,
      names: { home: teamNames(home), away: teamNames(away) }, book: book, alt: alt };
  }, 8);
  return out.filter(Boolean);
}

async function board(sport) {
  var hit = cached('s:' + sport, 15000); if (hit) return hit;
  var cfg = SPORTS[sport];
  var k = await kalshi(cfg).catch(function () { return null; });
  var p = await poly(cfg, sport, k).catch(function () { return null; }), r = [k, p];
  var data = { sport: sport, sportT: cfg.title, generated: new Date().toISOString(), games: (r[0] || []).concat(r[1] || []), ok: { kalshi: !!r[0], polymarket: !!r[1] } };
  cache['s:' + sport] = { at: Date.now(), data: data };
  return data;
}

// ── order-book depth for one side of one contract: the asks you'd walk, fee included ──
async function depth(ref) {
  var p = String(ref).split('|'), src = p[0], id = p[1], side = p[2];
  if (src === 'k' && /^KX[A-Z0-9-]{4,80}$/.test(id) && (side === 'yes' || side === 'no')) {
    var d = await get(KALSHI + '/markets/' + id + '/orderbook?depth=40'), ob = (d && (d.orderbook_fp || d.orderbook)) || {};
    // a book of bids only: buying YES takes the NO bids (cost 1 − bid), buying NO takes the YES bids
    var bids = (side === 'yes' ? ob.no_dollars : ob.yes_dollars) || [], theta = 0.07 * (K_MULT[id.split('-')[0]] || 1);
    return bids.map(function (b) { var c = 1 - +b[0]; return [withFee(c, theta), +b[1]]; }).filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return a[0] - b[0]; });
  }
  if (src === 'p' && /^[a-z0-9-]{4,120}$/.test(id) && (side === 'long' || side === 'short')) {
    var r = await get(PMUS + '/v1/markets/' + id + '/book'), md = (r && r.marketData) || {}, theta2 = 0.0695;
    var lv = side === 'long' ? (md.offers || []).map(function (o) { return [num(o.px), num(o.qty)]; }) : (md.bids || []).map(function (o) { return [1 - num(o.px), num(o.qty)]; });
    return lv.filter(function (x) { return x[0] > 0 && x[1] > 0; }).map(function (x) { return [withFee(x[0], theta2), x[1]]; }).sort(function (a, b) { return a[0] - b[0]; });
  }
  return null;
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    var url = new URL(req.url, 'http://x');
    if (url.searchParams.get('list')) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.end(JSON.stringify({ sports: Object.keys(SPORTS).map(function (k) { return { key: k, title: SPORTS[k].title, group: SPORTS[k].group }; }) }));
    }
    var refs = String(url.searchParams.get('book') || '').split(',').filter(Boolean).slice(0, 12);
    if (refs.length) {
      var lad = await Promise.all(refs.map(depth)), books = {};
      refs.forEach(function (r, i) { if (lad[i]) books[r] = lad[i]; });
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=5');
      return res.end(JSON.stringify({ books: books, fetched: new Date().toISOString() }));
    }
    var sport = url.searchParams.get('sport');
    if (!SPORTS[sport]) { res.statusCode = 400; return res.end('{"error":"sport= one of ' + Object.keys(SPORTS).join(', ') + '"}'); }
    var data = await board(sport);
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=15');
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 502; res.end('{"error":"prediction markets unavailable"}');
  }
};
