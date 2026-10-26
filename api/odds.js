// Owner-only live pull of the paid odds feed (the-odds-api) for TDC Bet's Arbs page, so arbs are priced on prices
// seconds old instead of the archive's 4-a-day snapshot (scripts/archive_live_odds.py). Same platforms and parsing:
// US sportsbooks (us,us2) + exchanges (us_ex, fees taken out of the price) + Pinnacle (the sharp reference).
// Every sport the feed has in season, not just college basketball.
//
// Spends the owner's API credits, so it is locked to the owner's account: the caller's Supabase session token is
// checked against Supabase auth and the email must be the owner's. Results are shared for 45 s so two open tabs
// don't pay twice.
//
//   (all calls: Authorization: Bearer <owner's Supabase access token>)
//   GET /api/odds?list=1                 → { sports: [{key, title, group}] }  sports in season now (free: 0 credits)
//   GET /api/odds?sports=nba_key,…       → { generated, games, remaining, used }  main markets, ~12 credits per sport
//                                          (default basketball_ncaab); games carry sport + sportT; soccer ml = [home, draw, away]
//   GET /api/odds?props=<sport>&max=12   → { sport, props: {eventId: [{p, m, b: {book: [line, over, under]}}]}, used }
//                                          player props for the next `max` games inside 12 h, us+us2 books,
//                                          ~2 credits per market per game (basketball 5 markets = ~10 a game)
//
// Needs the ODDS_API_KEY environment variable in the Vercel project (Settings → Environment Variables).

var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var SB_KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
var OWNER = 'blee4824@gmail.com';
var BASE = 'https://api.the-odds-api.com/v4/sports';
var SPORT = /^[a-z0-9_]{3,60}$/;
// prop markets worth pulling per sport (over/under markets only — yes-only markets like anytime TD can't be arbed)
var PROPS = {
  basketball: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'],
  americanfootball: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_pass_tds'],
  icehockey: ['player_points', 'player_shots_on_goal'],
  baseball: ['batter_hits', 'batter_total_bases', 'pitcher_strikeouts']
};
var SOURCES = [['regions=us,us2', 'book'], ['regions=us_ex', 'ex'], ['bookmakers=pinnacle', 'sharp']];
var CACHE_MS = 45000;
// exchange fees (mirrors archive_live_odds.py): a commission on net winnings (ProphetX 2%; BetOpenly, Sporttrade
// unverified), or a taker fee of theta x P x (1 - P) per $1 contract (Kalshi 0.07, Polymarket US 0.0695)
var EX_COMMISSION = { novig: 0, prophetx: 0.02, betopenly: 0, sporttrade: 0 };
var EX_QUADRATIC = { kalshi: 0.07, polymarket: 0.0695 };

var cache = {}, owners = {};   // cache[key] = {at, data}
function cached(k, ms) { var c = cache[k]; return c && Date.now() - c.at < ms ? c.data : null; }

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
  if (EX_QUADRATIC[key]) { var c = cost(p); return am(c + EX_QUADRATIC[key] * c * (1 - c)); }
  var rate = EX_COMMISSION[key] || 0; if (!rate) return Math.round(p);
  var d = p > 0 ? 1 + p / 100 : 1 + 100 / -p; d = 1 + (d - 1) * (1 - rate);
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function median(xs) { xs = xs.filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; }); var n = xs.length; return !n ? null : n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2; }

function toGames(events, snap, sport, sportT) {
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
        else if (mk.key === 'h2h' && h && a) {
          var dr = oc.find(function (o) { return o.name === 'Draw'; }), aw = oc.find(function (o) { return o.name !== home && o.name !== 'Draw'; });
          if (dr && aw) b.ml = [px(h), px(dr), px(aw)];                   // soccer: home / draw / away
          else { b.ml = [px(h), px(a)]; if (kind !== 'ex') { mlh.push(h.price); mla.push(a.price); } }
        }
      });
      if (Object.keys(b).length > 2) { if (kind !== 'book') b.k = kind; books[key] = b; }
    });
    return { id: ev.id, commence: ev.commence_time, home: home, away: ev.away_team, spread: median(sp), total: median(to),
      ml_home: median(mlh), ml_away: median(mla), books: books, snapshot: snap, fast: true, sport: sport, sportT: sportT };
  }).filter(function (g) { return g.home && g.away; });
}

function headerNum(r, h) { var v = r.headers.get(h); return v == null ? null : +v; }

// main markets for one sport, every source, cached 45 s. win = {from, to} ISO times: only games starting inside it
// (the alert scanner's "today only"; the-odds-api charges nothing when no game falls inside)
function isoS(t) { return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
async function sportBoard(key, sport, titles, win) {
  var ck = 'b:' + sport + (win ? ':' + win.from + ':' + win.to : ''), wq = win ? '&commenceTimeFrom=' + isoS(win.from) + '&commenceTimeTo=' + isoS(win.to) : '';
  var hit = cached(ck, CACHE_MS); if (hit) return Object.assign({ cached: true }, hit);
  var remaining = null, used = 0, failed = [], evs = {};
  var results = await Promise.all(SOURCES.map(function (s) {
    return fetch(BASE + '/' + sport + '/odds?apiKey=' + encodeURIComponent(key) + '&' + s[0] + '&markets=spreads,totals,h2h&oddsFormat=american' + wq)
      .then(function (r) {
        if (headerNum(r, 'x-requests-remaining') != null) remaining = headerNum(r, 'x-requests-remaining');
        used += headerNum(r, 'x-requests-last') || 0;
        if (!r.ok) { failed.push(sport + ' ' + s[1] + ' ' + r.status); return []; }
        return r.json();
      }).catch(function () { failed.push(sport + ' ' + s[1]); return []; }).then(function (body) { return { body: Array.isArray(body) ? body : [], kind: s[1] }; });
  }));
  results.forEach(function (r) {
    r.body.forEach(function (ev) {
      var e = evs[ev.id] || (evs[ev.id] = Object.assign({}, ev, { bookmakers: [] }));
      (ev.bookmakers || []).forEach(function (bk) { if (r.kind === 'sharp' && bk.key !== 'pinnacle') return; if (!e.bookmakers.some(function (x) { return x.key === bk.key; })) e.bookmakers.push(Object.assign({}, bk, { _kind: r.kind })); });
    });
  });
  var snap = new Date().toISOString(), data = { games: toGames(Object.values(evs), snap, sport, (titles && titles[sport]) || sport), remaining: remaining, used: used, failed: failed };
  if (failed.length < SOURCES.length) cache[ck] = { at: Date.now(), data: data };
  return data;
}

// sports in season (the /sports endpoint costs nothing); outright-only competitions (futures) left out
async function sportList(key) {
  var hit = cached('list', 10 * 60000); if (hit) return hit;
  var r = await fetch(BASE + '?apiKey=' + encodeURIComponent(key));
  if (!r.ok) throw new Error('sports ' + r.status);
  var list = (await r.json()).filter(function (s) { return s.active && !s.has_outrights; }).map(function (s) { return { key: s.key, title: s.title, group: s.group }; });
  cache.list = { at: Date.now(), data: list };
  return list;
}

// how many games start inside win (the /events endpoint is free), so the scanner never pays for an empty pull
async function eventCount(key, sport, win) {
  var r = await fetch(BASE + '/' + sport + '/events?apiKey=' + encodeURIComponent(key) + '&commenceTimeFrom=' + isoS(win.from) + '&commenceTimeTo=' + isoS(win.to));
  if (!r.ok) throw new Error('events ' + r.status);
  var b = await r.json(); return Array.isArray(b) ? b.length : 0;
}

// player props for the next games of one sport (each game is its own call), cached 4 min
async function sportProps(key, sport, max) {
  var mk = PROPS[sport.split('_')[0]]; if (!mk) return { sport: sport, props: {}, used: 0, note: 'no prop markets for this sport' };
  var ck = 'p:' + sport + ':' + max, hit = cached(ck, 4 * 60000); if (hit) return Object.assign({ cached: true }, hit);
  var er = await fetch(BASE + '/' + sport + '/events?apiKey=' + encodeURIComponent(key));      // free
  if (!er.ok) throw new Error('events ' + er.status);
  var now = Date.now(), soon = (await er.json()).filter(function (e) { var t = Date.parse(e.commence_time); return t > now && t - now < 12 * 3600000; })
    .sort(function (a, b) { return Date.parse(a.commence_time) - Date.parse(b.commence_time); }).slice(0, max);
  var props = {}, used = 0, remaining = null;
  for (var i = 0; i < soon.length; i += 6) {
    await Promise.all(soon.slice(i, i + 6).map(function (e) {
      return fetch(BASE + '/' + sport + '/events/' + e.id + '/odds?apiKey=' + encodeURIComponent(key) + '&regions=us,us2&markets=' + mk.join(',') + '&oddsFormat=american')
        .then(function (r) { used += headerNum(r, 'x-requests-last') || 0; if (headerNum(r, 'x-requests-remaining') != null) remaining = headerNum(r, 'x-requests-remaining'); return r.ok ? r.json() : null; })
        .then(function (ev) {
          if (!ev) return;
          var lines = {};   // one entry per player + market + line, every book that hangs that exact line
          (ev.bookmakers || []).forEach(function (bk) {
            (bk.markets || []).forEach(function (m) {
              (m.outcomes || []).forEach(function (o) {
                if (!o.description || o.point == null || (o.name !== 'Over' && o.name !== 'Under')) return;
                var k = o.description + '|' + m.key + '|' + o.point, L = lines[k] || (lines[k] = { p: o.description, m: m.key, b: {} });
                var v = L.b[bk.key] || (L.b[bk.key] = [o.point, null, null]); v[o.name === 'Over' ? 1 : 2] = o.price;
              });
            });
          });
          props[e.id] = Object.values(lines).filter(function (L) { return Object.keys(L.b).length; });
        }).catch(function () {});
    }));
  }
  var data = { sport: sport, props: props, games: soon.length, used: used, remaining: remaining };
  cache[ck] = { at: Date.now(), data: data };
  return data;
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  var auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!(await isOwner(auth))) { res.statusCode = 403; return res.end('{"error":"owner only"}'); }
  var key = process.env.ODDS_API_KEY;
  if (!key) { res.statusCode = 503; return res.end('{"error":"ODDS_API_KEY is not set in the Vercel project"}'); }
  try {
    var url = new URL(req.url, 'http://x');
    if (url.searchParams.get('list')) { res.statusCode = 200; return res.end(JSON.stringify({ sports: await sportList(key) })); }
    var ps = url.searchParams.get('props');
    if (ps) {
      if (!SPORT.test(ps)) { res.statusCode = 400; return res.end('{"error":"bad sport"}'); }
      var max = Math.min(20, Math.max(1, +url.searchParams.get('max') || 12));
      res.statusCode = 200; return res.end(JSON.stringify(await sportProps(key, ps, max)));
    }
    var sports = String(url.searchParams.get('sports') || 'basketball_ncaab').split(',').filter(function (x) { return SPORT.test(x); }).slice(0, 25);
    var titles = {}; try { (await sportList(key)).forEach(function (s) { titles[s.key] = s.title; }); } catch (e) {}
    var boards = await Promise.all(sports.map(function (sp) { return sportBoard(key, sp, titles); }));
    var games = [], used = 0, remaining = null, failed = [];
    boards.forEach(function (b) { games = games.concat(b.games); if (!b.cached) used += b.used; if (b.remaining != null) remaining = b.remaining; failed = failed.concat(b.failed || []); });
    if (!games.length && failed.length >= sports.length * SOURCES.length) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'odds feed refused every call', failed: failed })); }
    res.statusCode = 200; res.end(JSON.stringify({ generated: new Date().toISOString(), games: games, remaining: remaining, used: used, failed: failed }));
  } catch (e) {
    res.statusCode = 502; res.end('{"error":"odds feed unavailable"}');
  }
};

// the alert scanner (api/arb-scan.js) reuses the same pulls
module.exports.sportBoard = sportBoard;
module.exports.sportList = sportList;
module.exports.eventCount = eventCount;
