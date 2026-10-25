/* nba-live.js — live prices for bet/nba-tonight.html. The page's board (scripts/data/nba_compare/<id>.json) carries
 * OUR numbers, rebuilt every 30 min before tip; this re-pulls every source's PRICES in the browser and re-prices the
 * whole board with the same math as scripts/nba_line_compare.py, so value / gaps / best price track the market.
 *
 *   DraftKings  ESPN's odds feed (sports.core.api.espn.com) — main lines, team totals, every prop + milestone ladder
 *   Polymarket  gamma-api.polymarket.com (CORS-open)
 *   Kalshi      /api/kalshi (our read-only pass-through: Kalshi sends no CORS headers)
 *
 *   NBALive.refresh(G, model) → Promise<{markets, props, ladders, multi, sources, at, ok:{dk,kalshi,poly}}>
 *   G = the board JSON; model = prop_model_nba.json
 */
(function (g) {
  'use strict';
  var CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
  var TICK = { SA: 'SAS', GS: 'GSW', NO: 'NOP', NY: 'NYK', UTAH: 'UTA', WSH: 'WAS' };
  var K_SERIES = { KXNBAGAME: 'ml', KXNBASPREAD: 'sp', KXNBATOTAL: 'tot', KXNBATEAMTOTAL: 'tt', KXNBAPTS: 'pts', KXNBAREB: 'reb', KXNBAAST: 'ast', KXNBA3PT: 'tpm', KXNBAPRA: 'pra' };
  var PROP_TYPES = { 'Total Points': 'pts', 'Total Rebounds': 'reb', 'Total Assists': 'ast', 'Total 3-Point Field Goals': 'tpm',
    'Total Points, Rebounds, and Assists': 'pra', 'Total Points and Rebounds': 'pr', 'Total Points and Assists': 'pa', 'Total Assists and Rebounds': 'ra' };
  var MILE_TYPES = { 'Points Milestones': 'pts', 'Rebounds Milestones': 'reb', 'Assists Milestones': 'ast', '3-Point Field Goals Milestones': 'tpm',
    'Points + Assists + Rebounds Milestones': 'pra', 'Points + Rebounds Milestones': 'pr', 'Points + Assists Milestones': 'pa', 'Rebounds + Assists Milestones': 'ra' };
  var POLY_STAT = { 'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast', '3-Pointers Made': 'tpm', 'Pts + Reb + Ast': 'pra', 'Points + Rebounds + Assists': 'pra' };
  var LABEL = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', tpm: 'Threes', pra: 'Pts+Reb+Ast', pr: 'Pts+Reb', pa: 'Pts+Ast', ra: 'Reb+Ast' };
  var KEYS = { pts: ['pts'], reb: ['reb'], ast: ['ast'], tpm: ['tpm'], pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast'] };

  function getJ(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function am(s) { var n = parseFloat(String(s).replace('+', '')); return isFinite(n) ? Math.round(n) : null; }
  function dec(o) { return o > 0 ? 1 + o / 100 : 1 + 100 / -o; }
  function imp(o) { return o > 0 ? 100 / (o + 100) : -o / (-o + 100); }
  function kfee(c) { return 0.07 * c * (1 - c); }
  function nk(n) { return String(n || '').toLowerCase().replace(' jr.', '').replace(' iii', '').replace(' ii', '').replace(/[^a-z ]/g, '').trim(); }
  function fmt(x) { x = +x; return String(Math.round(x * 10) / 10); }                    // one spelling per number in keys
  function refId(x, key) { var m = String((x || {}).$ref || '').match(new RegExp('/' + key + '/(\\d+)')); return m ? m[1] : null; }
  function Phi(z) { var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  function nbCdf(mu, v, k) {
    mu = Math.max(mu, 0.05); var c, p, i;
    if (v <= mu * 1.0001) { p = Math.exp(-mu); c = p; for (i = 1; i <= k; i++) { p *= mu / i; c += p; } return c; }
    var r = mu * mu / (v - mu), q = r / (r + mu); p = Math.exp(r * Math.log(q)); c = p; for (i = 1; i <= k; i++) { p *= (i - 1 + r) / i * (1 - q); c += p; } return c;
  }
  function pOver(model, stat, mean, rate, sdm, line) {
    var M = (model && model.stats) || {};
    if (stat === 'pts' || stat === 'pra' || stat === 'pr' || stat === 'pa') {
      var k = (M[stat === 'pts' ? 'pts' : 'pra'] || {}).k || 1.9, sd = k * Math.sqrt(Math.max(mean, 0.1));
      return Math.min(0.999, Math.max(0.001, 1 - Phi((line - mean) / sd)));
    }
    var a = stat === 'ra' ? (((M.reb || {}).alpha || 0.07) + ((M.ast || {}).alpha || 0.07)) / 2 : ((M[stat] || {}).alpha || 0.07);
    var v = mean + a * mean * mean + Math.pow(rate * (sdm || 5), 2) * 0.5;
    return Math.min(0.999, Math.max(0.001, 1 - nbCdf(mean, v, Math.floor(line))));
  }

  function refresh(G, model) {
    var gid = G.id, ha = G.home.abbr, aa = G.away.abbr, H = TICK[ha] || ha, A = TICK[aa] || aa;
    var tipEt = new Date(new Date(G.tip).getTime() - 4 * 3600e3), MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var dcode = String(tipEt.getUTCFullYear()).slice(2) + MON[tipEt.getUTCMonth()] + String(tipEt.getUTCDate()).padStart(2, '0');
    var ymd = tipEt.toISOString().slice(0, 10);
    var nick = {}; nick[H] = G.home.name.indexOf('Trail Blazers') >= 0 ? 'Trail Blazers' : G.home.name.split(' ').pop(); nick[A] = G.away.name.indexOf('Trail Blazers') >= 0 ? 'Trail Blazers' : G.away.name.split(' ').pop();
    var byNick = {}; byNick[nick[H]] = H; byNick[nick[A]] = A;
    var C = G.consts || { sd_margin: 12, sd_total: 17.5, sd_team: 10.5, w: 0.35 };
    var P = {}; (G.players || []).forEach(function (p) { P[p.id] = p; P['n:' + nk(p.name)] = p; });

    function dkProps() {
      var all = [];
      function page(n) {
        return getJ(CORE + '/events/' + gid + '/competitions/' + gid + '/odds/100/propBets?limit=1000&page=' + n).then(function (d) {
          if (!d) return all; all = all.concat(d.items || []); return n < (d.pageCount || 1) ? page(n + 1) : all;
        });
      }
      return page(1);
    }
    return Promise.all([
      getJ(CORE + '/events/' + gid + '/competitions/' + gid + '/odds'), dkProps(),
      getJ('https://gamma-api.polymarket.com/events?slug=nba-' + A.toLowerCase() + '-' + H.toLowerCase() + '-' + ymd),
      getJ('/api/kalshi?events=' + Object.keys(K_SERIES).map(function (s) { return s + '-' + dcode + A + H; }).join(','))
    ]).then(function (res) {
      var odds = res[0], items = res[1] || [], poly = res[2], kal = res[3];
      var rows = {}, markets = [], props = [], ladders = [];
      function add(key, label, kind, src, cost, mid, vol, thin, extra) {
        if (cost == null || !(cost > 0.005 && cost < 0.995)) return;
        var r = rows[key] || (rows[key] = { key: key, label: label, kind: kind, src: {} });
        if (extra) Object.keys(extra).forEach(function (k) { if (r[k] == null) r[k] = extra[k]; });
        var o = r.src[src];
        if (!o || cost < o.cost) r.src[src] = { cost: +cost.toFixed(4), mid: mid == null ? null : +mid.toFixed(4), vol: vol || null, thin: !!thin };
      }
      var om = G.ours, mh = om.margin, tot = om.total, tp = {}; tp[H] = om.home_pts; tp[A] = om.away_pts;

      // ── DraftKings main lines ──
      var dk = odds && (odds.items || []).filter(function (i) { return String((i.provider || {}).id) === '100'; })[0];
      function addMarket(kind, label, line, price, p, mkt) {
        if (price == null) return;
        markets.push({ kind: kind, label: label, line: line, price: price, p: +p.toFixed(4), p_mkt: mkt == null ? null : +mkt.toFixed(4), ev: +(p * dec(price) - 1).toFixed(4) });
      }
      if (dk) {
        var ho = dk.homeTeamOdds || {}, ao = dk.awayTeamOdds || {}, sp = dk.spread;
        if (sp != null) {
          var hp = am(ho.spreadOdds), ap = am(ao.spreadOdds), nv = hp && ap ? imp(hp) / (imp(hp) + imp(ap)) : null, ph = Phi((mh + sp) / C.sd_margin);
          addMarket('spread', ha + ' ' + (sp > 0 ? '+' : '') + fmt(sp), sp, hp, ph, nv); addMarket('spread', aa + ' ' + (-sp > 0 ? '+' : '') + fmt(-sp), -sp, ap, 1 - ph, nv == null ? null : 1 - nv);
          if (hp) add('sp|' + H + '|' + fmt(sp), H + ' ' + (sp > 0 ? '+' : '') + fmt(sp), 'sp', 'dk', 1 / dec(hp), nv);
          if (ap) add('sp|' + A + '|' + fmt(-sp), A + ' ' + (-sp > 0 ? '+' : '') + fmt(-sp), 'sp', 'dk', 1 / dec(ap), nv == null ? null : 1 - nv);
        }
        if (dk.overUnder != null) {
          var ou = dk.overUnder, op = am(dk.overOdds), up = am(dk.underOdds), nv2 = op && up ? imp(op) / (imp(op) + imp(up)) : null, po = 1 - Phi((ou - tot) / C.sd_total);
          addMarket('total', 'Over ' + fmt(ou), ou, op, po, nv2); addMarket('total', 'Under ' + fmt(ou), ou, up, 1 - po, nv2 == null ? null : 1 - nv2);
          if (op) add('tot|over|' + fmt(ou), 'Over ' + fmt(ou), 'tot', 'dk', 1 / dec(op), nv2);
          if (up) add('tot|under|' + fmt(ou), 'Under ' + fmt(ou), 'tot', 'dk', 1 / dec(up), nv2 == null ? null : 1 - nv2);
        }
        var hm = am(ho.moneyLine), amn = am(ao.moneyLine);
        if (hm && amn) {
          var nv3 = imp(hm) / (imp(hm) + imp(amn)), pw = Phi(mh / C.sd_margin);
          addMarket('ml', ha + ' ML', null, hm, pw, nv3); addMarket('ml', aa + ' ML', null, amn, 1 - pw, 1 - nv3);
          add('ml|' + H, H + ' ML', 'ml', 'dk', 1 / dec(hm), nv3); add('ml|' + A, A + ' ML', 'ml', 'dk', 1 / dec(amn), 1 - nv3);
        }
      }
      // ── DraftKings prop feed: team totals, prop pairs, milestone ladders ──
      var byType = {}; items.forEach(function (it) { (byType[it.type.name] = byType[it.type.name] || []).push(it); });
      var teamAbbr = {}; // ESPN team id → our ticker abbr, from the main odds item
      if (dk) { var hid = refId((dk.homeTeamOdds || {}).team, 'teams'), aid = refId((dk.awayTeamOdds || {}).team, 'teams'); if (hid) teamAbbr[hid] = H; if (aid) teamAbbr[aid] = A; }
      var tt = {};
      (byType['Team Total Points'] || []).forEach(function (it) { var k = refId(it.team, 'teams') + '|' + ((it.odds.total || {}).value); (tt[k] = tt[k] || []).push(it); });
      Object.keys(tt).forEach(function (k) {
        var es = tt[k], t = teamAbbr[k.split('|')[0]]; if (es.length !== 2 || !t) return;
        var L = +k.split('|')[1], o = am(es[0].odds.american.value), u = am(es[1].odds.american.value), nv = imp(o) / (imp(o) + imp(u)), p = 1 - Phi((L - tp[t]) / C.sd_team);
        var ab = t === H ? ha : aa;
        markets.push({ kind: 'tt', label: ab + ' team total over ' + fmt(L), line: L, price: o, p: +p.toFixed(4), p_mkt: +nv.toFixed(4), ev: +(p * dec(o) - 1).toFixed(4) });
        markets.push({ kind: 'tt', label: ab + ' team total under ' + fmt(L), line: L, price: u, p: +(1 - p).toFixed(4), p_mkt: +(1 - nv).toFixed(4), ev: +((1 - p) * dec(u) - 1).toFixed(4) });
        add('tt|' + t + '|over|' + fmt(L), t + ' team total over ' + fmt(L), 'tt', 'dk', 1 / dec(o), nv);
        add('tt|' + t + '|under|' + fmt(L), t + ' team total under ' + fmt(L), 'tt', 'dk', 1 / dec(u), 1 - nv);
      });
      var miles = {};
      Object.keys(MILE_TYPES).forEach(function (tn) {
        (byType[tn] || []).forEach(function (it) {
          var pid = refId(it.athlete, 'athletes'), t = ((it.current || {}).target || {}).value, pr = am(it.odds.american.value);
          if (!pid || t == null || pr == null) return;
          var m = miles[pid + '|' + MILE_TYPES[tn]] = miles[pid + '|' + MILE_TYPES[tn]] || {}; (m[Math.round(t)] = m[Math.round(t)] || []).push(pr);
        });
      });
      Object.keys(miles).forEach(function (k) {     // keep the full-game ladder (DK files a quarter ladder under the same id)
        var ks = miles[k], clean = {}, floor = 0;
        Object.keys(ks).map(Number).sort(function (a, b) { return b - a; }).forEach(function (x) {
          var pr = ks[x].reduce(function (a, b) { return imp(b) > imp(a) ? b : a; });
          if (imp(pr) + 1e-9 >= floor) { clean[x] = pr; floor = imp(pr); }
        });
        miles[k] = clean;
      });
      function proj(pid, stat) {
        var p = P[pid]; if (!p || !(p.min > 0) || !p.mean) return null;
        var mean = KEYS[stat].reduce(function (s, x) { return s + (p.mean[x] || 0); }, 0);
        var rate = KEYS[stat].reduce(function (s, x) { return s + ((p.rates || {})[x] || (p.min ? (p.mean[x] || 0) / p.min : 0)); }, 0);
        return { p: p, mean: mean, rate: rate };
      }
      Object.keys(PROP_TYPES).forEach(function (tn) {
        var grp = {};
        (byType[tn] || []).forEach(function (it) { var k = refId(it.athlete, 'athletes') + '|' + (((it.current || {}).target || {}).value); (grp[k] = grp[k] || []).push(it); });
        Object.keys(grp).forEach(function (k) {
          var es = grp[k], pid = k.split('|')[0], line = +k.split('|')[1], stat = PROP_TYPES[tn]; if (es.length !== 2 || !isFinite(line)) return;
          var a = am(es[0].odds.american.value), b = am(es[1].odds.american.value), mk = (miles[pid + '|' + stat] || {})[Math.floor(line) + 1];
          var over = mk == null || Math.abs(mk - a) <= Math.abs(mk - b) ? a : b, under = over === a ? b : a;
          var x = proj(pid, stat); if (!x) return;
          var pl = x.p, po = pOver(model, stat, x.mean, x.rate, pl.sdm, line), nv = imp(over) / (imp(over) + imp(under)), pb = C.w * po + (1 - C.w) * nv, why = [];
          if (pl.g < 3 && (pl.last_g || 0) < 30) why.push('small sample (' + pl.g + ' games this season, ' + (pl.last_g || 0) + ' last)');
          if (line > 0 && Math.abs(x.mean - line) / Math.max(line, 2) > 0.3) why.push('our number is ' + Math.round(Math.abs(x.mean - line) / Math.max(line, 2) * 100) + '% off the book: likely a role or minutes change we don\'t see');
          props.push({ pid: pid, name: pl.name, team: pl.team, stat: stat, label: LABEL[stat], line: line, over: over, under: under, open_line: ((es[0].open || {}).target || {}).value,
            mean: +x.mean.toFixed(1), p_over: +po.toFixed(4), p_mkt: +nv.toFixed(4), p_blend: +pb.toFixed(4), evb_over: +(pb * dec(over) - 1).toFixed(4), evb_under: +((1 - pb) * dec(under) - 1).toFixed(4),
            trust: why.length ? 'low' : 'ok', why: why, g: pl.g });
          var n = nk(pl.name);
          add('prop|' + n + '|' + stat + '|over|' + fmt(line), pl.name + ' ' + LABEL[stat] + ' over ' + fmt(line), 'prop', 'dk', 1 / dec(over), nv, null, false, { pid: pid, stat: stat, name: pl.name });
          add('prop|' + n + '|' + stat + '|under|' + fmt(line), pl.name + ' ' + LABEL[stat] + ' under ' + fmt(line), 'prop', 'dk', 1 / dec(under), 1 - nv, null, false, { pid: pid, stat: stat, name: pl.name });
        });
      });
      Object.keys(miles).forEach(function (k) {
        var pid = k.split('|')[0], stat = k.split('|')[1], x = proj(pid, stat); if (!x) return;
        var rungs = Object.keys(miles[k]).map(Number).sort(function (a, b) { return a - b; }).map(function (kk) {
          var pr = miles[k][kk], p = pOver(model, stat, x.mean, x.rate, x.p.sdm, kk - 0.5);
          add('prop|' + nk(x.p.name) + '|' + stat + '|over|' + fmt(kk - 0.5), x.p.name + ' ' + LABEL[stat] + ' ' + kk + '+', 'prop', 'dk', 1 / dec(pr), imp(pr), null, false, { pid: pid, stat: stat, name: x.p.name });
          return { k: kk, price: pr, p: +p.toFixed(4), p_book: +imp(pr).toFixed(4), ev: +(p * dec(pr) - 1).toFixed(4) };
        });
        ladders.push({ pid: pid, name: x.p.name, team: x.p.team, stat: stat, label: LABEL[stat], mean: +x.mean.toFixed(1), rungs: rungs });
      });

      // ── Kalshi (fee in) ──
      ((kal && kal.markets) || []).forEach(function (m) {
        var kind = K_SERIES[String(m.event_ticker || '').split('-')[0]]; if (!kind) return;
        var ya = parseFloat(m.yes_ask_dollars), yb = parseFloat(m.yes_bid_dollars), na = parseFloat(m.no_ask_dollars), vol = parseFloat(m.volume_fp) || 0;
        var mid = ya && yb ? (ya + yb) / 2 : null, thin = !ya || !yb || ya - yb > 0.06, yc = ya ? ya + kfee(ya) : null, nc = na ? na + kfee(na) : null;
        var fs = m.floor_strike == null ? null : +m.floor_strike, tk = String(m.ticker).split('-').pop(), t = (tk.match(/^[A-Z]+/) || [''])[0], o = t === H ? A : H;
        if (kind === 'ml') add('ml|' + tk, tk + ' ML', 'ml', 'kalshi', yc, mid, vol, thin);
        else if (kind === 'sp' && fs != null) { add('sp|' + t + '|' + fmt(-fs), t + ' ' + fmt(-fs), 'sp', 'kalshi', yc, mid, vol, thin); add('sp|' + o + '|' + fmt(fs), o + ' +' + fmt(fs), 'sp', 'kalshi', nc, mid == null ? null : 1 - mid, vol, thin); }
        else if (kind === 'tot' && fs != null) { add('tot|over|' + fmt(fs), 'Over ' + fmt(fs), 'tot', 'kalshi', yc, mid, vol, thin); add('tot|under|' + fmt(fs), 'Under ' + fmt(fs), 'tot', 'kalshi', nc, mid == null ? null : 1 - mid, vol, thin); }
        else if (kind === 'tt' && fs != null) { add('tt|' + t + '|over|' + fmt(fs), t + ' team total over ' + fmt(fs), 'tt', 'kalshi', yc, mid, vol, thin); add('tt|' + t + '|under|' + fmt(fs), t + ' team total under ' + fmt(fs), 'tt', 'kalshi', nc, mid == null ? null : 1 - mid, vol, thin); }
        else if (fs != null) {
          var nm = String(m.title || '').split(':')[0], n = nk(nm), pl = P['n:' + n];
          add('prop|' + n + '|' + kind + '|over|' + fmt(fs), nm + ' ' + LABEL[kind] + ' ' + Math.round(fs + 0.5) + '+', 'prop', 'kalshi', yc, mid, vol, thin, { pid: pl && pl.id, stat: kind, name: nm });
          add('prop|' + n + '|' + kind + '|under|' + fmt(fs), nm + ' ' + LABEL[kind] + ' under ' + Math.round(fs + 0.5), 'prop', 'kalshi', nc, mid == null ? null : 1 - mid, vol, thin, { pid: pl && pl.id, stat: kind, name: nm });
        }
      });
      // ── Polymarket ──
      ((poly && poly[0] && poly[0].markets) || []).forEach(function (m) {
        var q = m.question || '', outs; try { outs = JSON.parse(m.outcomes || '[]'); } catch (e) { outs = []; }
        var ba = parseFloat(m.bestAsk), bb = parseFloat(m.bestBid), vol = Math.round(parseFloat(m.volume) || 0);
        if (!isFinite(ba) || !isFinite(bb) || outs.length !== 2) return;
        var thin = ba - bb > 0.06, c0 = ba, c1 = 1 - bb, mid = (ba + bb) / 2;
        var ms = q.match(/^Spread: (.+?) \(([-+][\d.]+)\)$/), mo = q.match(/O\/U ([\d.]+)$/);
        if (q === nick[A] + ' vs. ' + nick[H] || q === nick[H] + ' vs. ' + nick[A]) {
          var t0 = byNick[outs[0]], t1 = byNick[outs[1]];
          if (t0 && t1) { add('ml|' + t0, t0 + ' ML', 'ml', 'poly', c0, mid, vol, thin); add('ml|' + t1, t1 + ' ML', 'ml', 'poly', c1, 1 - mid, vol, thin); }
        } else if (ms && byNick[ms[1]]) {
          var t = byNick[ms[1]], o = t === H ? A : H, L = +ms[2];
          add('sp|' + t + '|' + fmt(L), t + ' ' + (L > 0 ? '+' : '') + fmt(L), 'sp', 'poly', c0, mid, vol, thin); add('sp|' + o + '|' + fmt(-L), o + ' ' + (-L > 0 ? '+' : '') + fmt(-L), 'sp', 'poly', c1, 1 - mid, vol, thin);
        } else if (mo && q.indexOf(nick[A] + ' vs. ' + nick[H] + ': O/U') === 0) {
          var L2 = +mo[1]; add('tot|over|' + fmt(L2), 'Over ' + fmt(L2), 'tot', 'poly', c0, mid, vol, thin); add('tot|under|' + fmt(L2), 'Under ' + fmt(L2), 'tot', 'poly', c1, 1 - mid, vol, thin);
        } else if (mo && q.indexOf('Team Total') > 0 && !/1H|2H/.test(q)) {
          var tt2 = byNick[q.split(' Team Total')[0]];
          if (tt2) { var L3 = +mo[1]; add('tt|' + tt2 + '|over|' + fmt(L3), tt2 + ' team total over ' + fmt(L3), 'tt', 'poly', c0, mid, vol, thin); add('tt|' + tt2 + '|under|' + fmt(L3), tt2 + ' team total under ' + fmt(L3), 'tt', 'poly', c1, 1 - mid, vol, thin); }
        } else if (mo && q.indexOf(':') > 0) {
          var nm = q.split(':')[0], rest = q.slice(q.indexOf(':') + 1).trim().replace(/ O\/U [\d.]+$/, ''), st = POLY_STAT[rest];
          if (st) { var n = nk(nm), pl = P['n:' + n], L4 = +mo[1];
            add('prop|' + n + '|' + st + '|over|' + fmt(L4), nm + ' ' + LABEL[st] + ' over ' + fmt(L4), 'prop', 'poly', c0, mid, vol, thin, { pid: pl && pl.id, stat: st, name: nm });
            add('prop|' + n + '|' + st + '|under|' + fmt(L4), nm + ' ' + LABEL[st] + ' under ' + fmt(L4), 'prop', 'poly', c1, 1 - mid, vol, thin, { pid: pl && pl.id, stat: st, name: nm }); }
        }
      });

      // ── price every outcome: ours, the market's consensus, the cheapest liquid source, value ──
      var low = {}; props.forEach(function (p) { if (p.trust === 'low') low[p.pid] = 1; });
      var multi = Object.keys(rows).map(function (key) {
        var r = rows[key], k = key.split('|'), p = null;
        if (r.kind === 'ml') p = k[1] === H ? Phi(mh / C.sd_margin) : 1 - Phi(mh / C.sd_margin);
        else if (r.kind === 'sp') p = Phi(((k[1] === H ? mh : -mh) + +k[2]) / C.sd_margin);
        else if (r.kind === 'tot') { var po = 1 - Phi((+k[2] - tot) / C.sd_total); p = k[1] === 'over' ? po : 1 - po; }
        else if (r.kind === 'tt') { var pt = 1 - Phi((+k[3] - (tp[k[1]] || 110)) / C.sd_team); p = k[2] === 'over' ? pt : 1 - pt; }
        else if (r.kind === 'prop' && r.pid) { var x = proj(r.pid, r.stat); if (x) { var p2 = pOver(model, r.stat, x.mean, x.rate, x.p.sdm, +k[4]); p = k[3] === 'over' ? p2 : 1 - p2; r.mean = +x.mean.toFixed(1);
          if (low[r.pid] || (x.p.g < 3 && (x.p.last_g || 0) < 30)) r.trust = 'low'; } }
        var liq = Object.keys(r.src).filter(function (s) { return !r.src[s].thin; });
        var mids = liq.map(function (s) { return r.src[s].mid; }).filter(function (v) { return v != null; });
        var cons = mids.length ? mids.reduce(function (a, b) { return a + b; }, 0) / mids.length : null;
        r.p = p == null ? null : +p.toFixed(4); r.cons = cons == null ? null : +cons.toFixed(4);
        r.p_blend = p == null || cons == null ? null : +(C.w * p + (1 - C.w) * cons).toFixed(4);
        if (liq.length) {
          var best = liq.reduce(function (a, b) { return r.src[b].cost < r.src[a].cost ? b : a; });
          r.best = { src: best, cost: r.src[best].cost };
          r.ev = r.p_blend == null ? null : +(r.p_blend / r.best.cost - 1).toFixed(4);
          var costs = liq.map(function (s) { return r.src[s].cost; });
          r.gap_c = costs.length > 1 ? +((Math.max.apply(null, costs) - Math.min.apply(null, costs)) * 100).toFixed(1) : null;
          if (r.best.cost < 0.15 || r.best.cost > 0.85) r.longshot = true;
        }
        r.n_src = Object.keys(r.src).length;
        return r;
      });
      var sources = { dk: 0, kalshi: 0, poly: 0 }; multi.forEach(function (r) { Object.keys(r.src).forEach(function (s) { sources[s]++; }); });
      return { markets: markets, props: props, ladders: ladders, multi: multi, sources: sources, at: new Date().toISOString(),
        ok: { dk: !!dk || items.length > 0, kalshi: !!(kal && kal.markets && kal.markets.length), poly: !!(poly && poly[0]) }, n_lines: items.length + markets.length };
    });
  }
  g.NBALive = { refresh: refresh };
})(window);
