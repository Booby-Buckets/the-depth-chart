// Owner-only live pull of the paid odds feed (the-odds-api) for TDC Bet's Arbs page, so arbs are priced on prices
// seconds old instead of the archive's 4-a-day snapshot (scripts/archive_live_odds.py). Same platforms and parsing:
// US sportsbooks (us,us2) + exchanges (us_ex, fees taken out of the price) + Pinnacle (the sharp reference), main
// markets only (spreads, totals, moneylines) — ~12 credits a pull.
//
// Spends the owner's API credits, so it is locked to the owner's account: the caller's Supabase session token is
// checked against Supabase auth and the email must be the owner's. Results are shared for 45 s so two open tabs
// don't pay twice.
//
//   GET /api/odds   (Authorization: Bearer <owner's Supabase access token>)
//   → { generated, games: [odds_live.json game shape], remaining, used }
//
// Needs the ODDS_API_KEY environment variable in the Vercel project (Settings → Environment Variables).

var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var SB_KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
var OWNER = 'blee4824@gmail.com';
var API = 'https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds';
var SOURCES = [['regions=us,us2', 'book'], ['regions=us_ex', 'ex'], ['bookmakers=pinnacle', 'sharp']];
var CACHE_MS = 45000;
// exchange fees (mirrors archive_live_odds.py): Kalshi's taker fee per $1 contract; others a commission on net winnings
var EX_COMMISSION = { novig: 0, prophetx: 0, betopenly: 0, polymarket: 0, sporttrade: 0 };

var cache = { at: 0, body: null }, owners = {};

async function isOwner(token) {
  if (!token) return false;
  var hit = owners[token]; if (hit && hit > Date.now()) return true;
  try {
    var r = await fetch(SB + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token } });
    if (!r.ok) return false;
    var u = await r.json();
    if (String(u.email || '').toLowerCase() !== OWNER) return false;
    owners[token] = Date.now() + 5 * 60000;
    return true;
  } catch (e) { return false; }
}

function cost(o) { return o > 0 ? 100 / (o + 100) : -o / (-o + 100); }
function am(c) { c = Math.min(Math.max(c, 0.01), 0.99); return c >= 0.5 ? Math.round(-100 * c / (1 - c)) : Math.round(100 * (1 - c) / c); }
function netPrice(key, kind, p) {
  if (p == null || kind !== 'ex') return p;
  if (key === 'kalshi') { var c = cost(p); return am(c + 0.07 * c * (1 - c)); }
  var rate = EX_COMMISSION[key] || 0; if (!rate) return Math.round(p);
  var d = p > 0 ? 1 + p / 100 : 1 + 100 / -p; d = 1 + (d - 1) * (1 - rate);
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function median(xs) { xs = xs.filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; }); var n = xs.length; return !n ? null : n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2; }

function toGames(events, snap) {
  return events.map(function (ev) {
    var home = ev.home_team, books = {}, sp = [], to = [], mlh = [], mla = [];
    (ev.bookmakers || []).forEach(function (bk) {
      var key = bk.key, kind = bk._kind, b = { t: bk.title || key, u: bk.last_update };
      var px = function (o) { return netPrice(key, kind, o && o.price); };
      (bk.markets || []).forEach(function (mk) {
        var oc = mk.outcomes || [], h = oc.find(function (o) { return o.name === home; }), a = oc.find(function (o) { return o.name !== home; });
        var ov = oc.find(function (o) { return o.name === 'Over'; }), un = oc.find(function (o) { return o.name === 'Under'; });
        if (mk.key === 'spreads' && h && a && h.point != null) { b.sp = [h.point, px(h), px(a)]; if (kind !== 'ex') sp.push(h.point); }
        else if (mk.key === 'totals' && ov && un && ov.point != null) { b.to = [ov.point, px(ov), px(un)]; if (kind !== 'ex') to.push(ov.point); }
        else if (mk.key === 'h2h' && h && a) { b.ml = [px(h), px(a)]; if (kind !== 'ex') { mlh.push(h.price); mla.push(a.price); } }
      });
      if (Object.keys(b).length > 2) { if (kind !== 'book') b.k = kind; books[key] = b; }
    });
    return { id: ev.id, commence: ev.commence_time, home: home, away: ev.away_team, spread: median(sp), total: median(to),
      ml_home: median(mlh), ml_away: median(mla), books: books, snapshot: snap, fast: true };
  }).filter(function (g) { return g.home && g.away; });
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  var auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!(await isOwner(auth))) { res.statusCode = 403; return res.end('{"error":"owner only"}'); }
  var key = process.env.ODDS_API_KEY;
  if (!key) { res.statusCode = 503; return res.end('{"error":"ODDS_API_KEY is not set in the Vercel project"}'); }
  if (cache.body && Date.now() - cache.at < CACHE_MS) { res.statusCode = 200; return res.end(cache.body); }
  try {
    var remaining = null, used = 0, failed = [], evs = {};
    var results = await Promise.all(SOURCES.map(function (s) {
      return fetch(API + '?apiKey=' + encodeURIComponent(key) + '&' + s[0] + '&markets=spreads,totals,h2h&oddsFormat=american')
        .then(function (r) {
          if (r.headers.get('x-requests-remaining') != null) remaining = +r.headers.get('x-requests-remaining');
          used += +(r.headers.get('x-requests-last') || 0);
          if (!r.ok) { failed.push(s[1] + ' ' + r.status); return []; }
          return r.json();
        }).then(function (body) { return { body: body || [], kind: s[1] }; });
    }));
    results.forEach(function (r) {
      r.body.forEach(function (ev) {
        var e = evs[ev.id] || (evs[ev.id] = Object.assign({}, ev, { bookmakers: [] }));
        (ev.bookmakers || []).forEach(function (bk) { if (r.kind === 'sharp' && bk.key !== 'pinnacle') return; if (!e.bookmakers.some(function (x) { return x.key === bk.key; })) e.bookmakers.push(Object.assign({}, bk, { _kind: r.kind })); });
      });
    });
    if (failed.length === SOURCES.length) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'odds feed refused every call', failed: failed })); }
    var snap = new Date().toISOString();
    cache = { at: Date.now(), body: JSON.stringify({ generated: snap, games: toGames(Object.values(evs), snap), remaining: remaining, used: used, failed: failed }) };
    res.statusCode = 200; res.end(cache.body);
  } catch (e) {
    res.statusCode = 502; res.end('{"error":"odds feed unavailable"}');
  }
};
