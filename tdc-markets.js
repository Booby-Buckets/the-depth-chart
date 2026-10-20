/* tdc-markets.js — the Betting Lab's "Markets" tab (owner, Oct 20 2026: "a Kalshi style prediction model").
 *
 * Every question our model can price, laid out the way prediction markets do it: a card per question, each
 * outcome with its chance and a Yes / No contract price in cents (Yes ¢ = our chance, No ¢ = the rest, a
 * contract pays $1). Clicking a price opens a ticket that shows what a stake would return at that price, the
 * fair American odds, and the sportsbook price + edge when the odds feed has one. Nothing is traded: these are
 * model prices, not an exchange.
 *
 *   Championship  national title, Final Four, make the field              (TDC_BL.sim → TDCPost.run)
 *   Conferences   regular-season title per league                          (same sims, CT[code])
 *   Win totals    "how many wins?" ladders, one per team                    (same sims, CT[code].proj[team].W)
 *   Games         the next game days, who wins                              (schedule_2027.json + TDC_RATINGS.lineFor)
 *   Awards        National Player of the Year                               (award_odds.json)
 *
 * Page contract (betting.html): panel #bl-markets with #mkCats (buttons[data-cat]), #mkSearch, #mkHero,
 * #mkGrid, #mkMsg and the ticket #mkTicket. Needs tdc-betlab.js first (TDC_BL.sim/ratings/book/logo/short).
 */
(function () {
  if (window.TDC_MK) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var BL = function () { return window.TDC_BL; };
  var ST = { cat: 'all', q: '', open: {}, markets: null, loading: null };

  // ── prices ─────────────────────────────────────────────────────────────────
  function yesC(p) { return Math.max(1, Math.min(99, Math.round(p * 100))); }
  function chance(p) { var v = p * 100; return v < 1 ? '<1%' : v > 99 ? '>99%' : Math.round(v) + '%'; }

  // ── market builders: {id, cat, title, sub, icon(team full|'trophy'), outcomes:[{key,label,team,p,book}], more, note} ──
  function champMarkets(res, book) {
    var T = res.teams.filter(function (t) { return !t.ineligible; });
    var top = function (k, n, min) { return T.filter(function (t) { return (t[k] || 0) >= min; }).sort(function (a, b) { return b[k] - a[k]; }).slice(0, n); };
    var out = [];
    var bt = (book && book.title) || {};
    out.push({ id: 'champ', hk: ['champ'], cat: 'champ', hero: true, title: 'Who will win the 2027 national championship?', sub: 'NCAA tournament · April 2027', icon: 'trophy',
      outcomes: top('champ', 40, 0.0005).map(function (t) { return { label: BL().short(t.team), team: t.team, p: t.champ, book: bt[t.team] || null }; }) });
    var bf = (book && book.f4) || {};
    out.push({ id: 'f4', hk: ['f4'], cat: 'champ', title: 'Who will make the Final Four?', sub: 'Four teams win · each priced on its own', icon: 'trophy',
      outcomes: top('f4', 40, 0.002).map(function (t) { return { label: BL().short(t.team), team: t.team, p: t.f4, book: bf[t.team] || null }; }) });
    out.push({ id: 'one', hk: ['one'], cat: 'champ', title: 'Who will earn a No. 1 seed?', sub: 'Selection Sunday · four teams win', icon: 'trophy',
      outcomes: T.filter(function (t) { return t.seed && t.seed[1] >= 0.005; }).sort(function (a, b) { return b.seed[1] - a.seed[1]; }).slice(0, 30)
        .map(function (t) { return { label: BL().short(t.team), team: t.team, p: t.seed[1] }; }) });
    // bubble questions: real at-large bubbles only. A one-bid-league team's "make the field" is just "win the
    // conference tournament" (owner, Oct 20: McNeese at 50% was exactly that), so the at-large path has to carry
    // most of the chance: P(field) − P(auto bid) ≥ 70% of P(field).
    var aq = {}; Object.keys(res.CT).forEach(function (c) { var C = res.CT[c]; (C && C.teams || []).forEach(function (x) { aq[x.team] = x.champ || 0; }); });
    T.filter(function (t) { var a = aq[t.team] || 0; return t.ncaa > 0.25 && t.ncaa < 0.8 && (t.ncaa - a) >= 0.7 * t.ncaa; })
      .sort(function (a, b) { return Math.abs(a.ncaa - 0.5) - Math.abs(b.ncaa - 0.5); }).slice(0, 8).forEach(function (t) {
      var a = aq[t.team] || 0;
      out.push({ id: 'bub-' + t.team, hk: ['ncaa'], cat: 'champ', title: 'Will ' + BL().short(t.team) + ' make the NCAA tournament?', sub: 'Bubble watch · ' + Math.round((t.ncaa - a) * 100) + '% at-large, ' + Math.round(a * 100) + '% auto bid', icon: t.team, binary: true,
        outcomes: [{ label: 'Makes the field', team: t.team, p: t.ncaa }] });
    });
    return out;
  }
  var POWER = ['SEC', 'B10', 'BIG-12', 'ACC', 'Big-East', 'MWC', 'WCC', 'A10', 'AAC'];
  function confMarkets(res) {
    var out = [];
    Object.keys(res.CT).forEach(function (code) {
      var C = res.CT[code]; if (!C || !C.teams || !C.teams.length) return;
      var name = (C.fmt && C.fmt.name) || code, rk = POWER.indexOf(code);
      out.push({ id: 'conf-' + code, hk: ['conf', code], cat: 'conf', order: rk < 0 ? 50 : rk, title: 'Who will win the ' + name + ' regular season?', sub: name + ' · ties count as a win', icon: C.teams.slice().sort(function (a, b) { return b.title - a.title; })[0].team,
        outcomes: C.teams.slice().sort(function (a, b) { return b.title - a.title; }).filter(function (t) { return t.title >= 0.002; })
          .map(function (t) { return { label: BL().short(t.team), team: t.team, p: t.title }; }) });
      out.push({ id: 'ct-' + code, hk: ['ct', code], cat: 'conf', order: (rk < 0 ? 50 : rk) + 0.5, title: 'Who will win the ' + name + ' tournament?', sub: name + ' · the automatic bid', icon: 'trophy',
        outcomes: C.teams.slice().sort(function (a, b) { return b.champ - a.champ; }).filter(function (t) { return t.champ >= 0.002; })
          .map(function (t) { return { label: BL().short(t.team), team: t.team, p: t.champ }; }) });
    });
    return out.sort(function (a, b) { return a.order - b.order; });
  }
  // "How many wins?" ladders: Kalshi-style strike rungs around the team's median
  function winMarkets(res) {
    var out = [], rows = BL().rows();
    Object.keys(res.CT).forEach(function (code) {
      var C = res.CT[code]; if (!C || !C.proj) return;
      Object.keys(C.proj).forEach(function (full) {
        var P = C.proj[full]; if (!P || !P.W || !P.W.length) return;
        var W = Array.prototype.slice.call(P.W), n = W.length, med = W.slice().sort(function (a, b) { return a - b; })[Math.floor(n / 2)];
        var rungs = []; for (var k = med - 4; k <= med + 4; k += 2) if (k > 0 && k <= P.n) rungs.push(k);
        var r = rows[full] || {};
        out.push({ id: 'wins-' + full, cat: 'wins', rank: r.rank || 999, title: 'How many games will ' + BL().short(full) + ' win?', sub: 'Regular season · ' + P.n + ' games on the schedule', icon: full,
          outcomes: rungs.reverse().map(function (k) { return { label: k + '+ wins', team: null, p: W.filter(function (w) { return w >= k; }).length / n }; }) });
      });
    });
    return out.sort(function (a, b) { return a.rank - b.rank; });
  }
  function gameMarkets() {
    return Promise.all([fetch('scripts/data/schedule_2027.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/results_2027.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })])
      .then(function (a) {
        var S = a[0], res = a[1]; if (!S || !S.games) return [];
        var done = {}; ((res && res.games) || []).forEach(function (g) { done[g[0]] = 1; });
        var rows = BL().rows(), today = new Date().toISOString().slice(0, 10), T = S.teams;
        var up = S.games.filter(function (g) { return g[1] >= today && !done[g[0]] && rows[T[g[2]]] && rows[T[g[3]]]; });
        var days = Array.from(new Set(up.map(function (g) { return g[1]; }))).sort().slice(0, 3);
        var out = [];
        up.filter(function (g) { return days.indexOf(g[1]) >= 0; }).forEach(function (g) {
          var H = rows[T[g[2]]], A = rows[T[g[3]]], neutral = !!g[4];
          var L = window.TDC_RATINGS.lineFor(A, H, neutral ? 'neutral' : 'away'), pA = L.probA / 100;
          var d = new Date(g[1] + 'T12:00:00'), when = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          out.push({ id: 'g-' + g[0], cat: 'games', date: g[1], quality: Math.min(H.rating, A.rating), title: BL().short(A.full) + (neutral ? ' vs ' : ' at ') + BL().short(H.full), sub: when + (neutral ? ' · neutral site' : '') + ' · ' + L.spread, icon: null, game: true, gm: { a: A, h: H, neutral: neutral },
            outcomes: [{ label: BL().short(A.full), team: A.full, p: pA }, { label: BL().short(H.full), team: H.full, p: 1 - pA }] });
        });
        return out.sort(function (a, b) { return a.date.localeCompare(b.date) || b.quality - a.quality; });
      });
  }
  function awardMarkets() {
    return fetch('scripts/data/award_odds.json?v=' + (window.TDC_BL_AWV || 1)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) {
        if (!d || !d.national) return [];
        return [{ id: 'npoy', cat: 'awards', title: 'Who will win National Player of the Year?', sub: 'Wooden / Naismith consensus · ' + (d.mode === 'preseason' ? 'preseason' : 'in-season') + ' odds', icon: 'trophy',
          outcomes: d.national.map(function (p) { return { label: p.name, sub: p.team, team: p.team, p: p.p, player: p.espn_id }; }) }];
      });
  }
  // ── price history: scripts/data/market_history_2027.json (nightly, scripts/snapshot_markets.mjs) for the season
  // markets; game markets re-price each day's published power ratings (rank_history_2027.json) through lineFor ──
  var HX = { days: [], idx: {}, rk: null };
  function loadHist() {
    var j = function (u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    return Promise.all([j('scripts/data/market_history_2027.json'), j('scripts/data/rank_history_2027.json')]).then(function (a) {
      var M = a[0], R = a[1];
      if (M && M.days) { HX.days = Object.keys(M.days).sort();
        HX.days.forEach(function (d) { var D = M.days[d], o = HX.idx[d] = {};
          var put = function (key, list) { var m = o[key] = {}; (list || []).forEach(function (x) { m[M.teams[x[0]]] = x[1] / 1000; }); };
          ['champ', 'f4', 'one', 'ncaa'].forEach(function (k) { put(k, D[k]); });
          Object.keys(D.conf || {}).forEach(function (c) { put('conf|' + c, D.conf[c]); });
          Object.keys(D.ct || {}).forEach(function (c) { put('ct|' + c, D.ct[c]); }); }); }
      HX.rk = (R && R.days) || null;
    });
  }
  // [[date, p], …] for one outcome; a team missing from a day's list was below the snapshot's floor (≈0)
  function histOf(m, o, oi) {
    if (m.gm) {
      if (!HX.rk) return [];
      var out = [];
      Object.keys(HX.rk).sort().forEach(function (d) { var D = HX.rk[d], ra = D[m.gm.a.full], rh = D[m.gm.h.full]; if (!ra || !rh) return;
        var L = window.TDC_RATINGS.lineFor(Object.assign({}, m.gm.a, { rating: ra[1] }), Object.assign({}, m.gm.h, { rating: rh[1] }), m.gm.neutral ? 'neutral' : 'away');
        var pA = L.probA / 100; out.push([d, oi === 0 ? pA : 1 - pA]); });
      return out;
    }
    if (!m.hk || !o.team) return [];
    var key = m.hk.length > 1 ? m.hk[0] + '|' + m.hk[1] : m.hk[0];
    return HX.days.filter(function (d) { return HX.idx[d][key]; }).map(function (d) { var v = HX.idx[d][key][o.team]; return [d, v == null ? 0 : v]; });
  }
  var LINE_COL = ['#2563EB', '#E8590C', '#16A34A', '#9333EA', '#DB2777'];
  function md(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  // a prediction-market price chart: one line per outcome in cents, today's live price as the last point
  function lineChart(series, W, H) {
    var dates = Array.from(new Set([].concat.apply([], series.map(function (s) { return s.pts.map(function (p) { return p[0]; }); })))).sort();
    if (dates.length < 2) return '';
    var mx = 0; series.forEach(function (s) { s.pts.forEach(function (p) { mx = Math.max(mx, p[1]); }); });
    var top = Math.min(100, Math.max(10, Math.ceil(mx * 100 * 1.15 / 5) * 5)), step = top > 50 ? 25 : top > 20 ? 10 : 5;
    var L = 4, Rp = 40, T = 8, B = 18;
    var X = function (d) { return L + dates.indexOf(d) / (dates.length - 1) * (W - L - Rp); }, Y = function (p) { return T + (1 - p * 100 / top) * (H - T - B); };
    var g = '';
    for (var v = 0; v <= top; v += step) g += '<line x1="' + L + '" x2="' + (W - Rp) + '" y1="' + Y(v / 100).toFixed(1) + '" y2="' + Y(v / 100).toFixed(1) + '" stroke="var(--border)"' + (v ? ' stroke-dasharray="2 3"' : '') + '/><text x="' + (W - Rp + 6) + '" y="' + (Y(v / 100) + 3).toFixed(1) + '" font-size="9.5" fill="var(--text3)">' + v + '¢</text>';
    var lines = series.map(function (s) {
      var d = s.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(' '), last = s.pts[s.pts.length - 1];
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + X(last[0]).toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="3" fill="' + s.color + '"/>';
    }).join('');
    return '<svg class="mk-ch" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Price history">' + g + lines +
      '<text x="' + L + '" y="' + (H - 4) + '" font-size="9.5" fill="var(--text3)">' + md(dates[0]) + '</text><text x="' + (W - Rp) + '" y="' + (H - 4) + '" font-size="9.5" text-anchor="end" fill="var(--text3)">' + md(dates[dates.length - 1]) + '</text></svg>';
  }
  // chart + colour keys for a market's top outcomes, once there are 3+ days of prices (today's live price included)
  var TODAY = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  function chartFor(m, n, W, H) {
    var ser = [];
    m.outcomes.slice(0, n).forEach(function (o, i) { var pts = histOf(m, o, i).filter(function (p) { return p[0] < TODAY; }).concat([[TODAY, o.p]]);
      if (pts.length >= 3) ser.push({ o: o, color: LINE_COL[i % LINE_COL.length], pts: pts }); });
    if (!ser.length) return null;
    ser.forEach(function (s) { s.o._col = s.color; s.o._chg = Math.round(s.o.p * 100) - Math.round(s.pts[0][1] * 100); s.o._since = s.pts[0][0]; });
    return lineChart(ser, W, H);
  }

  function load() {
    if (ST.loading) return ST.loading;
    msg('Pricing every market from 2,000 simulated seasons…');
    return (ST.loading = BL().ratings().then(function () { return Promise.all([BL().sim(), BL().book(), gameMarkets(), awardMarkets(), loadHist()]); })
      .then(function (a) {
        var res = a[0], book = a[1]; msg('');
        var list = [];
        // front-page order: the next games first, then the season-long questions
        list = list.concat(a[2] || []);
        if (res) list = list.concat(champMarkets(res, book), confMarkets(res));
        list = list.concat(a[3] || []);
        if (res) list = list.concat(winMarkets(res));
        ST.markets = list; return list;
      }).catch(function (e) { console.warn('markets', e); msg('Markets could not load.'); return []; }));
  }
  function msg(t) { var m = $('mkMsg'); if (m) { m.textContent = t || ''; m.hidden = !t; } }

  // ── drawing ────────────────────────────────────────────────────────────────
  function icon(m) {
    if (m.icon === 'trophy') return '<span class="mk-ic mk-tro" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4h10v3a5 5 0 0 1-10 0V4Zm-3 1h3v2a3 3 0 0 1-3-2Zm16 0h-3v2a3 3 0 0 0 3-2ZM10 13h4v3h-4zM8 17h8v3H8z" fill="currentColor"/></svg></span>';
    var l = m.icon && BL().logo(m.icon); return l ? '<span class="mk-ic"><img src="' + l + '" alt="" loading="lazy"></span>' : '';
  }
  function oRow(m, o, i) {
    var y = yesC(o.p), l = o.team && !m.game && m.icon !== o.team ? BL().logo(o.team) : '';
    return '<div class="mk-o"><div class="mk-on">' + (m.game && o.team ? '<img class="mk-ol" src="' + BL().logo(o.team) + '" alt="">' : l ? '<img class="mk-ol" src="' + l + '" alt="">' : '') +
      (o._col ? '<i class="mk-key" style="background:' + o._col + '"></i>' : '') + '<span>' + esc(o.label) + (o.sub ? ' <small>' + esc(o.sub) + '</small>' : '') + '</span></div>' +
      '<div class="mk-pc">' + chance(o.p) + (o._chg ? '<small class="' + (o._chg > 0 ? 'up' : 'dn') + '" title="since ' + md(o._since) + '">' + (o._chg > 0 ? '▲' : '▼') + Math.abs(o._chg) + '</small>' : '') + '</div>' +
      '<button class="mk-y" data-m="' + esc(m.id) + '" data-i="' + i + '" data-side="yes">Yes ' + y + '¢</button>' +
      '<button class="mk-n" data-m="' + esc(m.id) + '" data-i="' + i + '" data-side="no">No ' + (100 - y) + '¢</button></div>';
  }
  function card(m) {
    var open = ST.open[m.id], lim = m.game || m.binary ? 2 : 4, list = open ? m.outcomes.slice(0, 20) : m.outcomes.slice(0, lim);
    var more = m.outcomes.length > lim ? '<button class="mk-more" data-more="' + esc(m.id) + '">' + (open ? 'Show fewer' : '+ ' + (Math.min(20, m.outcomes.length) - lim) + ' more') + '</button>' : '';
    var bk = m.outcomes.some(function (o) { return o.book; }) ? '<span class="mk-bk">book prices in</span>' : '';
    var ch = chartFor(m, m.game ? 2 : m.binary ? 1 : 3, 340, 96);
    return '<article class="mk-card' + (m.game ? ' mk-game' : '') + '" data-mid="' + esc(m.id) + '" tabindex="0" aria-label="Open ' + esc(m.title) + '"><header>' + icon(m) + '<div><h3>' + esc(m.title) + '</h3><div class="mk-sub">' + esc(m.sub || '') + '</div></div></header>' + (ch || '') +
      '<div class="mk-os">' + list.map(function (o, i) { return oRow(m, o, i); }).join('') + '</div>' +
      '<footer>' + more + '<span class="mk-src">Our model · view only</span>' + bk + '</footer></article>';
  }
  function hero(m) {
    var top = m.outcomes.slice(0, 8), mx = top.length ? top[0].p : 1, ch = chartFor(m, 5, 460, 230);
    return '<article class="mk-hero" data-mid="' + esc(m.id) + '"><div class="mk-hl"><header>' + icon(m) + '<div><div class="mk-kick">Featured market</div><h3>' + esc(m.title) + '</h3><div class="mk-sub">' + esc(m.sub) + '</div></div></header>' +
      '<div class="mk-os">' + top.slice(0, 5).map(function (o, i) { return oRow(m, o, i); }).join('') + '</div>' +
      '<footer><button class="mk-more" data-cat-jump="champ">All championship markets</button><span class="mk-src">Our model · view only</span></footer></div>' +
      (ch ? '<div class="mk-hr"><div class="mk-kick">Price history · Yes ¢</div>' + ch + '</div></article>' :
      '<div class="mk-hr" aria-label="Chance to win the title"><div class="mk-kick">Chance to win it all</div>' +
      top.map(function (o) { var l = o.team ? BL().logo(o.team) : '';
        return '<div class="mk-bar"><span class="mk-bn">' + (l ? '<img src="' + l + '" alt="">' : '') + esc(o.label) + '</span><span class="mk-bt"><i style="width:' + (100 * o.p / mx).toFixed(1) + '%"></i></span><b>' + chance(o.p) + '</b></div>'; }).join('') +
      '<div class="mk-sub" style="margin-top:8px">Price lines start once three days of prices are saved.</div></div></article>');
  }
  function render() {
    var host = $('mkGrid'); if (!host) return;
    if (!ST.markets) { load().then(function () { if (ST.markets) render(); }); return; }
    var q = ST.q.toLowerCase().trim(), cat = ST.cat;
    var list = ST.markets.filter(function (m) { return (cat === 'all' || m.cat === cat) && !m.hero; });
    if (q) list = ST.markets.filter(function (m) { return (m.title + ' ' + m.outcomes.slice(0, 12).map(function (o) { return o.label; }).join(' ')).toLowerCase().indexOf(q) >= 0; });
    // "All" is a front page: a few of each kind, not every team's win ladder
    if (cat === 'all' && !q) {
      var by = {}; list = list.filter(function (m) { by[m.cat] = (by[m.cat] || 0) + 1; return by[m.cat] <= ({ games: 6, champ: 4, conf: 6, wins: 6, awards: 2 }[m.cat] || 4); });
    } else if (!q) list = list.slice(0, cat === 'wins' ? 36 : 60);
    var H = ST.markets.filter(function (m) { return m.hero; })[0];
    $('mkHero').innerHTML = H && (cat === 'all' || cat === 'champ') && !q ? hero(H) : '';
    host.innerHTML = list.length ? list.map(card).join('') : '<div class="mk-empty">' + (cat === 'games' ? 'No games on the schedule in the next few days.' : 'No markets match.') + '</div>';
    var c = $('mkCount'); if (c) c.textContent = ST.markets.length.toLocaleString() + ' markets';
  }

  // ── market detail (owner, Oct 20: "when you click on the market … show the lines like a kalshi one") ──
  // a big price chart of the top outcomes with a hover crosshair, range chips, then every outcome with its price
  var DT = { m: null, range: 'all' };
  function detailSeries(m, n) {
    var ser = [];
    m.outcomes.slice(0, n).forEach(function (o, i) { var pts = histOf(m, o, i).filter(function (p) { return p[0] < TODAY; }).concat([[TODAY, o.p]]);
      if (DT.range !== 'all') { var cut = new Date(new Date(TODAY + 'T12:00:00') - (DT.range === '1w' ? 7 : 30) * 864e5).toISOString().slice(0, 10); pts = pts.filter(function (p) { return p[0] >= cut; }); }
      if (pts.length >= 2) ser.push({ o: o, color: LINE_COL[i % LINE_COL.length], pts: pts }); });
    ser.forEach(function (s) { s.o._col = s.color; s.o._chg = Math.round(s.o.p * 100) - Math.round(s.pts[0][1] * 100); s.o._since = s.pts[0][0]; });
    return ser;
  }
  function bigChart(ser, W, H) {
    var dates = Array.from(new Set([].concat.apply([], ser.map(function (s) { return s.pts.map(function (p) { return p[0]; }); })))).sort();
    var mx = 0; ser.forEach(function (s) { s.pts.forEach(function (p) { mx = Math.max(mx, p[1]); }); });
    var top = Math.min(100, Math.max(10, Math.ceil(mx * 100 * 1.12 / 5) * 5)), step = top > 50 ? 25 : top > 20 ? 10 : 5;
    var small = W < 500, L = 6, Rp = small ? 128 : 150, T = 12, B = 24, X = function (d) { return L + dates.indexOf(d) / Math.max(1, dates.length - 1) * (W - L - Rp); }, Y = function (p) { return T + (1 - p * 100 / top) * (H - T - B); };
    var g = '';
    for (var v = 0; v <= top; v += step) g += '<line x1="' + L + '" x2="' + (W - Rp) + '" y1="' + Y(v / 100).toFixed(1) + '" y2="' + Y(v / 100).toFixed(1) + '" stroke="var(--border)"' + (v ? ' stroke-dasharray="2 3"' : '') + '/><text x="' + (W - Rp + 6) + '" y="' + (Y(v / 100) + 3.5).toFixed(1) + '" font-size="11" fill="var(--text3)">' + v + '¢</text>';
    var ticks = dates.length <= 6 ? dates : [dates[0], dates[Math.floor(dates.length / 3)], dates[Math.floor(2 * dates.length / 3)], dates[dates.length - 1]];
    g += ticks.map(function (d, i) { return '<text x="' + X(d).toFixed(1) + '" y="' + (H - 6) + '" font-size="11" fill="var(--text3)" text-anchor="' + (i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle') + '">' + md(d) + '</text>'; }).join('');
    // end labels: name + price at the last point, nudged apart so they don't overlap
    var ends = ser.map(function (s) { var l = s.pts[s.pts.length - 1]; return { s: s, y: Y(l[1]), x: X(l[0]) }; }).sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    var lines = ser.map(function (s) { return '<path d="' + s.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(' ') + '" fill="none" stroke="' + s.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>'; }).join('');
    var lab = ends.map(function (e) { var last = e.s.pts[e.s.pts.length - 1]; return '<circle cx="' + e.x.toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="3.5" fill="' + e.s.color + '"/><text x="' + (W - Rp + 31) + '" y="' + (e.y + 4).toFixed(1) + '" font-size="11.5" font-weight="700" fill="' + e.s.color + '">' + esc(String(e.s.o.label).slice(0, small ? 10 : 14)) + ' ' + yesC(last[1]) + '¢</text>'; }).join('');
    DT.geo = { dates: dates, X: X, Y: Y, W: W, H: H, L: L, Rp: Rp, T: T, B: B, ser: ser };
    return '<div class="mk-dch"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Price history">' + g + lines + lab +
      '<line class="mk-xh" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--text3)" stroke-dasharray="3 3" visibility="hidden"/><rect class="mk-hit" x="' + L + '" y="0" width="' + (W - L - Rp) + '" height="' + H + '" fill="transparent"/></svg><div class="mk-tip" hidden></div></div>';
  }
  function hover(e) {
    var G = DT.geo, svg = e.currentTarget.ownerSVGElement || e.currentTarget; if (!G || !G.dates.length) return;
    var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * G.W, best = 0, bd = 1e9;
    G.dates.forEach(function (d, i) { var dx = Math.abs(G.X(d) - x); if (dx < bd) { bd = dx; best = i; } });
    var d = G.dates[best], xh = svg.querySelector('.mk-xh'), tip = svg.parentNode.querySelector('.mk-tip');
    xh.setAttribute('x1', G.X(d)); xh.setAttribute('x2', G.X(d)); xh.setAttribute('visibility', 'visible');
    tip.innerHTML = '<b>' + md(d) + (d === TODAY ? ' · now' : '') + '</b>' + G.ser.map(function (s) { var p = s.pts.filter(function (q) { return q[0] === d; })[0];
      return p ? '<div><i style="background:' + s.color + '"></i>' + esc(s.o.label) + '<span>' + yesC(p[1]) + '¢</span></div>' : ''; }).join('');
    tip.hidden = false; var px = G.X(d) / G.W * r.width; tip.style.left = Math.min(r.width - 170, Math.max(0, px + 12)) + 'px';
  }
  function detail(id) {
    var m = find(id); if (!m) return; DT.m = m; paintDetail(); $('mkDetail').hidden = false; document.body.classList.add('mk-open');
  }
  function paintDetail() {
    var m = DT.m, n = m.game ? 2 : m.binary ? 1 : 6, ser = detailSeries(m, n), lead = m.outcomes[0];
    var narrow = window.innerWidth < 640, chart = ser.length ? bigChart(ser, narrow ? 400 : 760, narrow ? 300 : 320) : '<div class="mk-nochart">Price lines fill in as each night’s prices are saved (we started saving them Oct 20, 2026). Today’s prices are below.</div>';
    var list = m.outcomes.slice(0, 20);
    $('mkDetail').innerHTML = '<div class="mk-dt"><button class="mk-x" data-close aria-label="Close">×</button>' +
      '<header>' + icon(m) + '<div><h3>' + esc(m.title) + '</h3><div class="mk-sub">' + esc(m.sub || '') + '</div></div></header>' +
      '<div class="mk-view">View only · you can’t bet here</div>' +
      '<div class="mk-lead"><b>' + chance(lead.p) + '</b> ' + esc(m.binary ? 'chance' : lead.label + ' chance') + (lead._chg ? ' <span class="' + (lead._chg > 0 ? 'up' : 'dn') + '">' + (lead._chg > 0 ? '▲' : '▼') + Math.abs(lead._chg) + ' since ' + md(lead._since) + '</span>' : '') + '</div>' +
      (ser.length ? '<div class="mk-rng">' + [['1w', '1W'], ['1m', '1M'], ['all', 'All']].map(function (r) { return '<button data-rng="' + r[0] + '" class="' + (DT.range === r[0] ? 'on' : '') + '">' + r[1] + '</button>'; }).join('') + '</div>' : '') +
      chart +
      '<div class="mk-os mk-dos">' + list.map(function (o, i) { return oRow(m, o, i); }).join('') + '</div>' +
      '<p class="mk-fine">' + (m.game ? 'Priced from our power ratings (the same line as the Games tab), re-priced with each day’s saved ratings for the chart.' : m.cat === 'awards' ? 'Priced from our award model.' : 'Priced from 2,000 simulated seasons and tournaments; the chart uses the nightly saved prices.') +
      ' These are our model’s prices written the way prediction markets show them, so you can see where our lines sit. Nothing here can be bought, sold or bet.</p></div>';
    var hit = $('mkDetail').querySelector('.mk-hit');
    if (hit) { hit.addEventListener('mousemove', hover); hit.addEventListener('mouseleave', function () { var d = $('mkDetail'); var t = d.querySelector('.mk-tip'), xh = d.querySelector('.mk-xh'); if (t) t.hidden = true; if (xh) xh.setAttribute('visibility', 'hidden'); }); }
  }
  function closeDetail() { var t = $('mkDetail'); if (t) t.hidden = true; if ($('mkTicket').hidden) document.body.classList.remove('mk-open'); }

  // ── the ticket ─────────────────────────────────────────────────────────────
  var TK = null;
  function find(id) { return (ST.markets || []).filter(function (m) { return m.id === id; })[0]; }
  function ticket(id, i, side) {
    var m = find(id); if (!m) return; var o = m.outcomes[+i]; if (!o) return;
    TK = { m: m, o: o, side: side, amt: TK ? TK.amt : 25 };
    paintTicket(); $('mkTicket').hidden = false; document.body.classList.add('mk-open');
  }
  function paintTicket() {
    var m = TK.m, o = TK.o, yes = TK.side === 'yes', c = yes ? yesC(o.p) : 100 - yesC(o.p), p = yes ? o.p : 1 - o.p;
    var amt = Math.max(0, +TK.amt || 0), n = Math.floor(amt * 100 / c), pay = n, profit = pay - n * c / 100;
    var fairO = BL().fairTxt(p), b = o.book, bP = b ? (yes ? b.p : 1 - b.p) : null;
    var q = m.game ? 'Will ' + o.label + ' win?' : m.binary ? m.title : (m.cat === 'wins' ? m.title.replace('How many games will ', 'Will ').replace(' win?', ' win ' + o.label.replace('+ wins', ' or more games') + '?') : 'Will ' + o.label + ' ' + verb(m) + '?');
    $('mkTicket').innerHTML = '<div class="mk-tk"><button class="mk-x" data-close aria-label="Close">×</button>' +
      '<div class="mk-view">Price check · view only, you can’t bet here</div><div class="mk-kick">' + esc(m.title) + '</div><h3>' + esc(q) + '</h3>' +
      '<div class="mk-side"><button data-side="yes" class="' + (yes ? 'on y' : '') + '">Yes ' + yesC(o.p) + '¢</button><button data-side="no" class="' + (!yes ? 'on n' : '') + '">No ' + (100 - yesC(o.p)) + '¢</button></div>' +
      '<label class="mk-amt">Example amount <span>$</span><input id="mkAmt" type="number" min="1" step="1" inputmode="decimal" value="' + amt + '"></label>' +
      '<dl class="mk-dl"><div><dt>Contracts</dt><dd>' + n.toLocaleString() + ' at ' + c + '¢</dd></div>' +
      '<div><dt>Would return if ' + (yes ? 'Yes' : 'No') + '</dt><dd><b>$' + pay.toLocaleString() + '</b> <span class="pos">+$' + profit.toFixed(2) + '</span></dd></div>' +
      '<div><dt>Our chance</dt><dd>' + chance(p) + '</dd></div>' +
      '<div><dt>Fair odds</dt><dd>' + fairO + '</dd></div>' +
      (b ? '<div><dt>Books</dt><dd>' + BL().oddsTxt(yes ? b.price : null) + ' · ' + chance(bP) + ' <span class="' + (p - bP >= 0.01 ? 'pos' : p - bP <= -0.01 ? 'neg' : '') + '">' + (p - bP >= 0 ? '+' : '−') + Math.abs((p - bP) * 100).toFixed(1) + ' pts</span></dd></div>' : '') +
      '</dl><p class="mk-fine">Prices are our model’s chances: Yes at 63¢ means we give it a 63% chance and a contract pays $1 if it happens. The numbers above show what an amount would return at our price, to compare with real markets. You can’t place a bet on The Depth Chart.</p></div>';
  }
  function verb(m) { return m.id === 'champ' ? 'win the national championship' : m.id === 'f4' ? 'make the Final Four' : m.id === 'one' ? 'earn a No. 1 seed' : m.id === 'npoy' ? 'win National Player of the Year' :
    /^conf-/.test(m.id) ? 'win the ' + m.sub.split(' · ')[0] + ' regular season' : /^ct-/.test(m.id) ? 'win the ' + m.sub.split(' · ')[0] + ' tournament' : 'win'; }
  function close() { var t = $('mkTicket'); if (t) t.hidden = true; if ($('mkDetail').hidden) document.body.classList.remove('mk-open'); }

  function boot() {
    var cats = $('mkCats'); if (!cats) return;
    cats.addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (!b) return; ST.cat = b.dataset.cat; cats.querySelectorAll('[data-cat]').forEach(function (x) { x.classList.toggle('on', x === b); }); render(); });
    var s = $('mkSearch'); if (s) s.addEventListener('input', function () { ST.q = s.value || ''; render(); });
    $('bl-markets').addEventListener('click', function (e) {
      var b = e.target.closest('.mk-y,.mk-n'); if (b) { ticket(b.dataset.m, b.dataset.i, b.dataset.side); return; }
      var mo = e.target.closest('[data-more]'); if (mo) { ST.open[mo.dataset.more] = !ST.open[mo.dataset.more]; render(); return; }
      var cj = e.target.closest('[data-cat-jump]'); if (cj) { var t = cats.querySelector('[data-cat="' + cj.dataset.catJump + '"]'); if (t) t.click(); return; }
      if (e.target.closest('#mkDetail,#mkTicket')) return;
      var cd = e.target.closest('[data-mid]'); if (cd) detail(cd.dataset.mid);
    });
    $('bl-markets').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.mk-card[data-mid]')) { e.preventDefault(); detail(e.target.dataset.mid); } });
    var dt = $('mkDetail');
    dt.addEventListener('click', function (e) { if (e.target.closest('[data-close]') || e.target === dt) { closeDetail(); return; }
      var rg = e.target.closest('[data-rng]'); if (rg) { DT.range = rg.dataset.rng; paintDetail(); return; }
      var b2 = e.target.closest('.mk-y,.mk-n'); if (b2) { e.stopPropagation(); ticket(b2.dataset.m, b2.dataset.i, b2.dataset.side); } });
    var tk = $('mkTicket');
    tk.addEventListener('click', function (e) { if (e.target.closest('[data-close]') || e.target === tk) { close(); return; } var sb = e.target.closest('.mk-side [data-side]'); if (sb) { TK.side = sb.dataset.side; paintTicket(); } });
    tk.addEventListener('input', function (e) { if (e.target.id === 'mkAmt') { TK.amt = e.target.value; var pos = e.target.selectionStart; paintTicket(); var i = $('mkAmt'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) {} } });
    document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return; if (!$('mkTicket').hidden) close(); else closeDetail(); });
  }
  window.TDC_MK = { render: render, load: load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
