// Read-only pass-through to Kalshi's PUBLIC market data, for TDC Bet's live prices (bet/nba-live.js, bet/cbb-live.js).
// Kalshi doesn't send CORS headers, so a page on our domain can't read it directly; this fetches it server-side.
// Locked down on purpose: only GET /trade-api/v2/markets for NBA / men's college basketball tickers, cached ~20 s at the
// edge. No keys, no account endpoints, no other paths.
//
//   GET /api/kalshi?events=KXNBAGAME-26OCT24GSWPHX,KXNBASPREAD-26OCT24GSWPHX   up to 12 events, fetched in parallel
//   GET /api/kalshi?series=KXNCAAMBGAME,KXNCAAMBSPREAD                          every OPEN market in up to 6 series
//   → { markets: [...], fetched: ISO time }

var KALSHI = 'https://api.elections.kalshi.com/trade-api/v2/markets';
var EVENT = /^KX(NBA|NCAAMB)[A-Z0-9]{0,24}-\d{2}[A-Z]{3}\d{2}[A-Z0-9]{2,16}$/;   // KXNBAPTS-26OCT24SASDAL, KXNCAAMBGAME-26NOV02LIBHP
var SERIES = /^KX(NBA|NCAAMB)[A-Z0-9]{1,24}$/;

function slim(m) {
  return { ticker: m.ticker, event_ticker: m.event_ticker, title: m.title, yes_sub_title: m.yes_sub_title, floor_strike: m.floor_strike,
    yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars, no_ask_dollars: m.no_ask_dollars, volume_fp: m.volume_fp,
    status: m.status, expected_expiration_time: m.expected_expiration_time };
}
function get(url) {
  return fetch(url, { headers: { 'User-Agent': 'tdc-bet' } }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
}
async function series(s) {               // every open market in a series (up to 3 pages of 1,000)
  var out = [], cursor = '';
  for (var i = 0; i < 3; i++) {
    var d = await get(KALSHI + '?status=open&limit=1000&series_ticker=' + encodeURIComponent(s) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    out = out.concat(d.markets || []);
    cursor = d.cursor; if (!cursor || !(d.markets || []).length) break;
  }
  return out;
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');          // public market data; lets our own headless logger read it too
  try {
    var url = new URL(req.url, 'http://x');
    var list = function (k, re, n) { return String(url.searchParams.get(k) || '').split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(function (s) { return re.test(s); }).slice(0, n); };
    var events = list('events', EVENT, 12), ser = list('series', SERIES, 6);
    if (!events.length && !ser.length) { res.statusCode = 400; return res.end('{"error":"events= or series= with NBA / NCAAMB tickers"}'); }
    var lists = await Promise.all(events.map(function (ev) { return get(KALSHI + '?limit=200&event_ticker=' + encodeURIComponent(ev)).then(function (d) { return d.markets || []; }); })
      .concat(ser.map(series)));
    var markets = [];
    lists.forEach(function (l) { l.forEach(function (m) { markets.push(slim(m)); }); });
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=20');
    res.end(JSON.stringify({ markets: markets, fetched: new Date().toISOString() }));
  } catch (e) {
    res.statusCode = 502; res.end('{"error":"kalshi unavailable"}');
  }
};
