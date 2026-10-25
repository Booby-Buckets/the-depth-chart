/* cbb-live.js — free live prices for TDC Bet's college board: DraftKings (ESPN's odds feed), Kalshi (via /api/kalshi)
 * and Polymarket, turned into the same game shape as scripts/data/odds_live.json so the edge finder (bet-edge.js)
 * prices them exactly like sportsbook-feed lines. Exchange prices become American odds from the cost to win $1
 * (Kalshi's taker fee included); each exchange's full spread / total ladder rides along as alternate lines.
 *
 *   TDCLive.odds(rows, opts) → Promise<{generated, live:true, games:[…], ok:{dk,kalshi,poly}}>
 *   rows = TDCBet slate rows (schedule ids are ESPN event ids). opts.kalshi = pass-through base (default /api/kalshi)
 * Needs bet-core.js.
 */
(function (g) {
  'use strict';
  var B = g.TDCBet;
  var CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball';
  var PROP_TYPES = { 'Total Points': 'pts', 'Total Rebounds': 'reb', 'Total Assists': 'ast', 'Total 3-Point Field Goals': 'tpm', 'Total Points, Rebounds, and Assists': 'pra' };
  var MILE = { 'Points Milestones': 'pts', 'Rebounds Milestones': 'reb', 'Assists Milestones': 'ast', '3-Point Field Goals Milestones': 'tpm', 'Points + Assists + Rebounds Milestones': 'pra' };
  var K_SER = ['KXNCAAMBGAME', 'KXNCAAMBSPREAD', 'KXNCAAMBTOTAL', 'KXNCAAMBTEAMTOTAL'];
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function getJ(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function am(s) { var n = parseFloat(String(s).replace('+', '')); return isFinite(n) ? Math.round(n) : null; }
  function amFromCost(c) { return c >= 0.5 ? -Math.round(100 * c / (1 - c)) : Math.round(100 * (1 - c) / c); }
  function imp(o) { return o > 0 ? 100 / (o + 100) : -o / (-o + 100); }
  function fee(c) { return c + 0.07 * c * (1 - c); }
  function refId(x, key) { var m = String((x || {}).$ref || '').match(new RegExp('/' + key + '/(\\d+)')); return m ? m[1] : null; }
  function norm(n) { return String(n || '').toLowerCase().replace(/&/g, 'and').replace(/\bst\.?(?=\s|$)/g, 'state').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(university|univ|the|of)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  // does an exchange's team name ("Grambling St.", "High Point") name this schedule team ("Grambling State Tigers")?
  function names(full) { var S = B.state(), t = S.byFull[full], a = [norm(full)]; if (t && t.team) a.push(norm(t.team)); try { a.push(norm(B.short(full))); } catch (e) {} return a.filter(Boolean); }
  function same(full, ex) { var k = norm(ex); if (!k) return false; return names(full).some(function (a) { return a === k || a.indexOf(k + ' ') === 0 || k.indexOf(a + ' ') === 0; }); }
  function etDate(iso) { var d = new Date(new Date(iso).getTime() - 4 * 3600e3); return d.toISOString().slice(0, 10); }
  function kdate(d) { var x = new Date(d + 'T12:00:00Z'); return String(x.getUTCFullYear()).slice(2) + MON[x.getUTCMonth()] + String(x.getUTCDate()).padStart(2, '0'); }
  function nearest(list, f) { return list.slice().sort(function (a, b) { return f(a) - f(b); })[0]; }

  // ── DraftKings via ESPN: main lines + props (props carry our player id: ESPN ids are our player ids) ──
  function dk(row) {
    var gid = row.id; if (!/^\d+$/.test(String(gid))) return Promise.resolve(null);
    // DraftKings only posts college props on bigger games: don't ask for the rest
    var propsToo = Math.max(B.rank(row.home) || 400, B.rank(row.away) || 400) <= 150;
    return Promise.all([getJ(CORE + '/events/' + gid + '/competitions/' + gid + '/odds'), propsToo ? getJ(CORE + '/events/' + gid + '/competitions/' + gid + '/odds/100/propBets?limit=1000') : null]).then(function (r) {
      var it = r[0] && (r[0].items || []).filter(function (i) { return String((i.provider || {}).id) === '100'; })[0]; if (!it) return null;
      var ho = it.homeTeamOdds || {}, ao = it.awayTeamOdds || {}, book = { t: 'DraftKings' };
      if (it.spread != null && am(ho.spreadOdds) && am(ao.spreadOdds)) book.sp = [it.spread, am(ho.spreadOdds), am(ao.spreadOdds)];
      if (it.overUnder != null && am(it.overOdds) && am(it.underOdds)) book.to = [it.overUnder, am(it.overOdds), am(it.underOdds)];
      if (am(ho.moneyLine) && am(ao.moneyLine)) book.ml = [am(ho.moneyLine), am(ao.moneyLine)];
      var items = (r[1] && r[1].items) || [], props = [], by = {}, miles = {};
      items.forEach(function (x) { (by[x.type.name] = by[x.type.name] || []).push(x); });
      Object.keys(MILE).forEach(function (tn) { (by[tn] || []).forEach(function (x) { var pid = refId(x.athlete, 'athletes'), t = ((x.current || {}).target || {}).value, pr = am(x.odds.american.value); if (pid && t != null && pr != null) (miles[pid + '|' + MILE[tn]] = miles[pid + '|' + MILE[tn]] || {})[Math.round(t)] = pr; }); });
      Object.keys(PROP_TYPES).forEach(function (tn) {
        var grp = {};
        (by[tn] || []).forEach(function (x) { var k = refId(x.athlete, 'athletes') + '|' + (((x.current || {}).target || {}).value); (grp[k] = grp[k] || []).push(x); });
        Object.keys(grp).forEach(function (k) {
          var es = grp[k]; if (es.length !== 2) return;
          var pid = k.split('|')[0], line = +k.split('|')[1], st = PROP_TYPES[tn], a = am(es[0].odds.american.value), b = am(es[1].odds.american.value);
          var mk = (miles[pid + '|' + st] || {})[Math.floor(line) + 1], over = mk == null || Math.abs(mk - a) <= Math.abs(mk - b) ? a : b, under = over === a ? b : a;
          props.push({ p: null, pid: pid, m: st, b: { draftkings: [line, over, under] } });
        });
      });
      return { book: book, props: props };
    });
  }

  // ── Kalshi: every open market in the four college series, grouped by event, matched to games by team name ──
  function kalshi(base) {
    return getJ((base || g.TDC_KALSHI_BASE || '/api/kalshi') + '?series=' + K_SER.join(',')).then(function (d) {
      var ev = {};
      ((d && d.markets) || []).forEach(function (m) {
        var parts = String(m.event_ticker || '').split('-'), ser = parts[0], code = parts.slice(1).join('-'); if (!code) return;
        var e = ev[code] = ev[code] || { code: code, teams: {}, ml: {}, sp: [], to: [], tt: [] };
        var ya = parseFloat(m.yes_ask_dollars), yb = parseFloat(m.yes_bid_dollars), na = parseFloat(m.no_ask_dollars), tk = String(m.ticker).split('-').pop();
        var ok = ya > 0 && yb > 0 && ya - yb <= 0.08 && na > 0;                     // thin quotes don't count as a price
        if (ser === 'KXNCAAMBGAME') { e.teams[tk] = m.yes_sub_title || String(m.title || '').replace(/ wins$/, ''); if (ya > 0 && yb > 0 && ya - yb <= 0.08) e.ml[tk] = ya; }
        else if (ok && m.floor_strike != null) {
          var t = (tk.match(/^[A-Z]+/) || [''])[0], L = +m.floor_strike;
          if (ser === 'KXNCAAMBSPREAD') e.sp.push({ team: t, L: L, yes: ya, no: na });
          else if (ser === 'KXNCAAMBTOTAL') e.to.push({ L: L, yes: ya, no: na });
          else if (ser === 'KXNCAAMBTEAMTOTAL') e.tt.push({ team: t, L: L, yes: ya, no: na });
        }
      });
      return ev;
    });
  }
  function kalshiBook(e, row, dkBook) {
    var codes = Object.keys(e.teams); if (codes.length !== 2) return null;
    var hc = codes.filter(function (c) { return same(row.home, e.teams[c]); })[0], ac = codes.filter(function (c) { return same(row.away, e.teams[c]); })[0];
    if (!hc || !ac || hc === ac) return null;
    var book = { t: 'Kalshi' }, alt = { sp: [], to: [] }, tt = {};
    if (e.ml[hc] && e.ml[ac]) book.ml = [amFromCost(fee(e.ml[hc])), amFromCost(fee(e.ml[ac]))];
    e.sp.forEach(function (s) {                    // "X wins by over L": yes = X −L, no = the other side +L
      var homeIsX = s.team === hc; if (!homeIsX && s.team !== ac) return;
      var hp = homeIsX ? -s.L : s.L, hPrice = amFromCost(fee(homeIsX ? s.yes : s.no)), aPrice = amFromCost(fee(homeIsX ? s.no : s.yes));
      alt.sp.push([hp, hPrice, aPrice]);
    });
    e.to.forEach(function (t) { alt.to.push([t.L, amFromCost(fee(t.yes)), amFromCost(fee(t.no))]); });
    var dsp = dkBook && dkBook.sp ? dkBook.sp[0] : null, dto = dkBook && dkBook.to ? dkBook.to[0] : null;
    if (alt.sp.length) book.sp = nearest(alt.sp, function (x) { return dsp != null ? Math.abs(x[0] - dsp) : Math.abs(imp(x[1]) - 0.5); });
    if (alt.to.length) book.to = nearest(alt.to, function (x) { return dto != null ? Math.abs(x[0] - dto) : Math.abs(imp(x[1]) - 0.5); });
    ['home', 'away'].forEach(function (side) {
      var c = side === 'home' ? hc : ac, rungs = e.tt.filter(function (x) { return x.team === c; }); if (!rungs.length) return;
      var r = nearest(rungs, function (x) { return Math.abs(x.yes - 0.5); }); tt[side] = [r.L, amFromCost(fee(r.yes)), amFromCost(fee(r.no))];
    });
    return { book: book, alt: alt, tt: tt };
  }

  // ── Polymarket: college game events, matched by the two names in the title ──
  function poly() {
    return Promise.all(['cbb', 'ncaab', 'college-basketball'].map(function (tag) { return getJ('https://gamma-api.polymarket.com/events?tag_slug=' + tag + '&closed=false&limit=500'); }))
      .then(function (ls) { var seen = {}, out = []; ls.forEach(function (l) { (l || []).forEach(function (e) { if (!seen[e.id] && / vs\.? /.test(e.title || '')) { seen[e.id] = 1; out.push(e); } }); }); return out; });
  }
  function polyBook(events, row) {
    var e = events.filter(function (x) {
      var t = String(x.title).split(/ vs\.? /); return t.length === 2 && ((same(row.away, t[0]) && same(row.home, t[1])) || (same(row.home, t[0]) && same(row.away, t[1])));
    })[0];
    if (!e) return null;
    var book = { t: 'Polymarket' }, alt = { sp: [], to: [] };
    (e.markets || []).forEach(function (m) {
      var outs; try { outs = JSON.parse(m.outcomes || '[]'); } catch (x) { outs = []; }
      var ba = parseFloat(m.bestAsk), bb = parseFloat(m.bestBid); if (!(ba > 0) || !(bb > 0) || ba - bb > 0.08 || outs.length !== 2) return;
      var q = m.question || '', c0 = ba, c1 = 1 - bb, ms = q.match(/^Spread: (.+?) \(([-+][\d.]+)\)$/), mo = q.match(/: O\/U ([\d.]+)$/);
      if (q === e.title) {
        var h0 = same(row.home, outs[0]); if (!h0 && !same(row.away, outs[0])) return;
        book.ml = h0 ? [amFromCost(c0), amFromCost(c1)] : [amFromCost(c1), amFromCost(c0)];
      } else if (ms) {
        var isHome = same(row.home, ms[1]); if (!isHome && !same(row.away, ms[1])) return;
        var L = +ms[2], hp = isHome ? L : -L;
        alt.sp.push(isHome ? [hp, amFromCost(c0), amFromCost(c1)] : [hp, amFromCost(c1), amFromCost(c0)]);
      } else if (mo && q.indexOf('Team Total') < 0 && q.indexOf(':') === e.title.length) {
        alt.to.push([+mo[1], amFromCost(c0), amFromCost(c1)]);
      }
    });
    if (alt.sp.length) book.sp = nearest(alt.sp, function (x) { return Math.abs(imp(x[1]) - 0.5); });
    if (alt.to.length) book.to = nearest(alt.to, function (x) { return Math.abs(imp(x[1]) - 0.5); });
    return Object.keys(book).length > 1 ? { book: book, alt: alt } : null;
  }

  // run f over items, at most n at a time (a 150-game opening night shouldn't fire 300 requests at once)
  function pool(items, f, n) {
    var out = new Array(items.length), i = 0;
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return f(items[k]).then(function (v) { out[k] = v; }, function () { out[k] = null; }).then(next); }
    var w = []; for (var j = 0; j < Math.min(n, items.length); j++) w.push(next());
    return Promise.all(w).then(function () { return out; });
  }
  function odds(rows, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return !r.exh; });
    var days = {}; rows.forEach(function (r) { days[r.date.replace(/-/g, '')] = 1; });
    var tips = Promise.all(Object.keys(days).map(function (d) { return getJ('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=400&dates=' + d); }))
      .then(function (ls) { var t = {}; ls.forEach(function (j) { ((j && j.events) || []).forEach(function (e) { t[String(e.id)] = e.date; }); }); return t; });
    return Promise.all([pool(rows, dk, 8), kalshi(opts.kalshi), poly(), tips]).then(function (res) {
      var dks = res[0], kev = res[1] || {}, pev = res[2] || [], tip = res[3] || {}, games = [], ok = { dk: false, kalshi: Object.keys(kev).length > 0, poly: pev.length > 0 };
      rows.forEach(function (row, i) {
        // Kalshi dates its events its own way (a late tip can land on the next day): accept a day either side, both names must match
        var d = dks[i], dd = new Date(row.date + 'T12:00:00Z'), kds = [-1, 0, 1].map(function (k) { return kdate(new Date(dd.getTime() + k * 864e5).toISOString().slice(0, 10)); }), books = {}, alt = {}, tt = {}, props = [];
        if (d) { ok.dk = true; books.draftkings = d.book; props = d.props; }
        var kc = Object.keys(kev).filter(function (c) { return kds.some(function (k) { return c.indexOf(k) === 0; }); }).map(function (c) { return kalshiBook(kev[c], row, d && d.book); }).filter(Boolean)[0];
        if (kc) { books.kalshi = kc.book; alt.kalshi = kc.alt; if (kc.tt.home || kc.tt.away) tt.kalshi = kc.tt; }
        var pb = polyBook(pev, row); if (pb) { books.polymarket = pb.book; alt.polymarket = pb.alt; }
        if (!Object.keys(books).length) return;
        // real tip time from ESPN (the logger freezes a game at tip); unknown → treat the whole day as started at noon ET
        games.push({ id: 'live-' + row.id, commence: tip[String(row.id)] || (row.date + 'T16:00:00Z'), home: row.home, away: row.away, books: books, alt: alt, tt: tt, props: props, live: true });
      });
      return { generated: new Date().toISOString(), live: true, games: games, ok: ok };
    });
  }
  g.TDCLive = { odds: odds };
})(window);
