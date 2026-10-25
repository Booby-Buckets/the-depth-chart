// Read-only pass-through to Kalshi's PUBLIC market data, for TDC Bet's live prices (bet/nba-tonight.html).
// Kalshi doesn't send CORS headers, so a page on our domain can't read it directly; this fetches it server-side.
// Locked down on purpose: only GET /trade-api/v2/markets?event_ticker=… for NBA series tickers, up to 12 events per
// call (fetched in parallel, merged), cached ~20 s at the edge. No keys, no account endpoints, no other paths.
//
//   GET /api/kalshi?events=KXNBAGAME-26OCT24GSWPHX,KXNBASPREAD-26OCT24GSWPHX,…
//   → { markets: [...], fetched: ISO time }

var KALSHI = 'https://api.elections.kalshi.com/trade-api/v2/markets';
var OK = /^KXNBA[A-Z0-9]{0,24}-\d{2}[A-Z]{3}\d{2}[A-Z]{4,8}$/;      // e.g. KXNBAPTS-26OCT24SASDAL

module.exports = async function (req, res) {
  try {
    var url = new URL(req.url, 'http://x');
    var events = String(url.searchParams.get('events') || '').split(',').map(function (s) { return s.trim().toUpperCase(); })
      .filter(function (s) { return OK.test(s); }).slice(0, 12);
    if (!events.length) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"events= one or more NBA event tickers"}'); }
    var lists = await Promise.all(events.map(function (ev) {
      return fetch(KALSHI + '?limit=200&event_ticker=' + encodeURIComponent(ev), { headers: { 'User-Agent': 'tdc-bet' } })
        .then(function (r) { return r.ok ? r.json() : { markets: [] }; })
        .catch(function () { return { markets: [] }; });
    }));
    var markets = [];
    lists.forEach(function (l) {
      (l.markets || []).forEach(function (m) {
        // only the fields the page prices from
        markets.push({ ticker: m.ticker, event_ticker: m.event_ticker, title: m.title, floor_strike: m.floor_strike,
          yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars, no_ask_dollars: m.no_ask_dollars, volume_fp: m.volume_fp, status: m.status });
      });
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=20');
    res.end(JSON.stringify({ markets: markets, fetched: new Date().toISOString() }));
  } catch (e) {
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"kalshi unavailable"}');
  }
};
