/* tdc-betlab.js — the Betting Lab's market tabs: everything you can bet on, priced by our model.
 *
 *   Futures      national title · Final Four · make the NCAA field · No. 1 seed   (TDCPost.run)
 *   Conferences  regular-season title · conference tournament · NCAA bid, per league (TDCPost.run → CT)
 *   Win totals   every team's regular-season win line, over/under odds            (the same simulated seasons)
 *   Awards       National POY + each league's POY / DPOY / Freshman / Sixth Man    (award_odds.json)
 *
 *   Markets      the same prices as prediction-market contracts (tdc-markets.js)
 *
 * Every price is "fair": our probability turned into American odds with no vig. When the odds feed has a
 * book price (odds_futures.json, written by scripts/archive_live_odds.py) it sits beside ours, de-vigged,
 * with the edge = our % minus the book's %. The simulation (~4 s) runs once, the first time one of the
 * three simulated tabs opens; Games / Props / Trends / Tools never pay for it.
 *
 * Page contract (betting.html): panels #bl-<tab>, a tab strip #blTabs with buttons[data-tab], and the hosts
 * below (#futTbl, #confTbl, #wtTbl, #awTbl …). Exposes window.TDC_BL = { show, fair }.
 */
(function () {
  if (window.TDC_BL) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // ── odds math ──────────────────────────────────────────────────────────────
  // fair American odds for probability p (no vig); null when the price would be meaningless
  function fair(p) {
    if (p == null || !isFinite(p) || p <= 0.0005 || p >= 0.9995) return null;
    var o = p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
    o = Math.abs(o) >= 1000 ? Math.round(o / 50) * 50 : Math.abs(o) >= 300 ? Math.round(o / 10) * 10 : Math.round(o / 5) * 5;
    return Math.max(-50000, Math.min(50000, o));
  }
  function oddsTxt(o) { return o == null ? '—' : (o > 0 ? '+' : '−') + Math.abs(o).toLocaleString('en-US'); }
  function fairTxt(p) { var o = fair(p); return o == null ? (p != null && p >= 0.9995 ? 'lock' : '—') : oddsTxt(o); }
  function implied(o) { return o == null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100); }
  function pct(p, d) {
    if (p == null) return '—';
    if (p > 0 && p < 0.001) return '<0.1%';
    var v = p * 100; return (v >= 99.95 ? '>99.9' : v.toFixed(d == null ? (v < 10 ? 1 : 0) : d)) + '%';
  }

  // ── names, logos ───────────────────────────────────────────────────────────
  var R = { rows: {}, byShort: {} };
  function short(full) { var t = R.rows[full]; var s = (t && t.team) || full; try { if (window.tdcShortSchool) return tdcShortSchool(s) || s; } catch (e) {} return s; }
  function logo(full) { var t = R.rows[full]; var c = window.tdcTeamColor && (tdcTeamColor((t && t.team) || full) || tdcTeamColor(full)); return (c && c.logo) || ''; }
  function teamCell(full) {
    var t = R.rows[full], l = logo(full);
    return '<a class="bl-tm" href="team.html?team=' + encodeURIComponent((t && t.team) || full) + '">' +
      '<span class="bl-lg">' + (l ? '<img src="' + l + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</span>' +
      (t && t.rank ? '<span class="bl-rk">' + t.rank + '</span>' : '') + esc(short(full)) + '</a>';
  }
  function loadRatings() {
    if (R.ready) return R.ready;
    return (R.ready = TDC_RATINGS.get().then(function (D) {
      var teams = (D.teams || []).filter(function (t) { return t.rating != null; }).sort(function (a, b) { return b.rating - a.rating; });
      teams.forEach(function (t, i) { if (t.rank == null) t.rank = i + 1; R.rows[t.full] = t; });
      return D;
    }));
  }

  // ── book futures (odds_futures.json) ───────────────────────────────────────
  // {generated, markets:{title:{teams:[{name, norm, price, books}]}}} — matched to our rows by the odds-feed
  // normalizer (same word list as build_odds_history.py), de-vigged across the whole market.
  var MASCOT = new Set(('blue devils devils wildcats tigers bulldogs cougars gators aggies huskies volunteers cavaliers cyclones boilermakers jayhawks razorbacks fighting illini cardinals hurricanes eagles bears wolverines spartans hawkeyes gaels red raiders seahawks zips rams lopes utes hoosiers buckeyes badgers cornhuskers terrapins nittany lions demon deacons yellow jackets tar heels wolfpack orange hokies seminoles panthers knights bearcats bruins trojans sun devils golden gophers musketeers friars pirates bluejays gamecocks commodores rebels crimson tide mean green golden eagles ragin cajuns owls minutemen catamounts privateers redhawks red storm crimson vandals broncos mustangs lobos aztecs falcons flames phoenix runnin rebels anteaters gauchos toreros dons waves highlanders titans matadors 49ers roadrunners bobcats mountaineers').split(/\s+/));
  function oNorm(n) { n = (n || '').toLowerCase().trim().replace(/&/g, 'and'); n = n.replace(/\bst\.?\b/g, 'state').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(university|univ|the|of)\b/g, ' '); return n.split(/\s+/).filter(function (t) { return t && !MASCOT.has(t); }).join(' ').trim(); }
  var BOOK = null;   // market -> { full name -> {price, p (no-vig)} }
  function loadBook() {
    if (BOOK) return Promise.resolve(BOOK);
    return fetch('scripts/data/odds_futures.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) {
        BOOK = { stamp: d && d.generated };
        if (!d || !d.markets) return BOOK;
        var nm = {}; Object.keys(R.rows).forEach(function (f) { var t = R.rows[f]; [oNorm(f), oNorm(t.team)].forEach(function (k) { if (k && !nm[k]) nm[k] = f; }); });
        Object.keys(d.markets).forEach(function (mk) {
          var list = (d.markets[mk].teams || []).filter(function (x) { return x.price != null; });
          var sum = list.reduce(function (s, x) { return s + implied(x.price); }, 0) || 1;   // de-vig over the whole market
          var m = BOOK[mk] = {};
          list.forEach(function (x) { var f = nm[x.norm || oNorm(x.name)]; if (f) m[f] = { price: x.price, p: implied(x.price) / sum, books: x.books }; });
        });
        return BOOK;
      });
  }

  // ── the simulation (shared by Futures, Conferences, Win totals) ────────────
  var SIM = null;
  function runSim() {
    if (SIM) return SIM;
    var msg = function (t) { ['futMsg', 'confMsg', 'wtMsg'].forEach(function (id) { var el = $(id); if (el) el.textContent = t; }); };
    msg('Simulating the season and March, 2,000 times…');
    return (SIM = loadRatings().then(function () {
      return window.TDCPost.run({ progress: function (f) { msg('Simulating every league… ' + Math.round(f * 100) + '%'); } });
    }).then(function (res) {
      msg('');
      if (res && res.CT) Object.keys(res.CT).forEach(function (c) { var f = res.CT[c] && res.CT[c].fmt; CONF_LABEL[c] = (f && f.name) || c; });
      return res;
    }).catch(function (e) { console.warn('betlab sim', e); msg('The simulation could not load.'); return null; }));
  }

  // ── sheet helpers ──────────────────────────────────────────────────────────
  function sheet(id, head, rows, opts) {
    var el = $(id); if (!el) return;
    opts = opts || {};
    el.innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + (rows || '<tr><td colspan="12" class="empty">' + (opts.empty || 'Nothing to show.') + '</td></tr>') + '</tbody>';
    if (window.tdcSheetHeat) tdcSheetHeat(el);
  }
  function more(id, n, shown, onToggle) {
    var b = $(id); if (!b) return;
    b.style.display = n > shown.lim ? '' : 'none';
    b.textContent = shown.all ? 'Show fewer' : 'Show all ' + n;
    b.onclick = function () { shown.all = !shown.all; onToggle(); };
  }
  function edgeCell(ours, book) {
    if (!book) return '<td class="dim">—</td><td class="dim">—</td><td class="dim">—</td>';
    var e = ours - book.p;
    return '<td>' + oddsTxt(book.price) + '</td><td class="dim">' + pct(book.p) + '</td>' +
      '<td class="' + (e >= 0.01 ? 'pos' : e <= -0.01 ? 'neg' : 'dim') + '">' + (e >= 0 ? '+' : '−') + Math.abs(e * 100).toFixed(1) + '</td>';
  }
  var CONF_LABEL = {};   // league code -> display name
  function confName(code) { return CONF_LABEL[code] || code || ''; }

  // ── FUTURES ────────────────────────────────────────────────────────────────
  var FUT = { mk: 'champ', q: '', show: { lim: 68, all: false } };
  var FUT_MK = {
    champ: { label: 'National title', book: 'title', min: 0.0005 },
    f4: { label: 'Final Four', book: 'f4', min: 0.002 },
    ncaa: { label: 'Make the NCAA field', book: null, min: 0.01 },
    one: { label: 'No. 1 seed', book: null, min: 0.002 },
    nitChamp: { label: 'NIT title', book: null, min: 0.002 },
  };
  function futP(t, mk) { return mk === 'one' ? (t.seed && t.seed[1]) || 0 : t[mk] || 0; }
  function renderFutures() {
    runSim().then(function (res) {
      if (!res) return;
      return loadBook().then(function () {
        var mk = FUT.mk, M = FUT_MK[mk], book = (M.book && BOOK[M.book]) || null, hasBook = !!(book && Object.keys(book).length);
        var q = FUT.q.toLowerCase();
        var rows = res.teams.filter(function (t) { return !t.ineligible && futP(t, mk) >= M.min; })
          .filter(function (t) { return !q || (t.team + ' ' + short(t.team)).toLowerCase().indexOf(q) >= 0; })
          .sort(function (a, b) { return futP(b, mk) - futP(a, mk); });
        var lim = FUT.show.all ? rows.length : Math.min(rows.length, FUT.show.lim);
        var body = rows.slice(0, lim).map(function (t, i) {
          var p = futP(t, mk), b = book && book[t.team];
          return '<tr><td class="rk">' + (i + 1) + '</td><td class="l nm">' + teamCell(t.team) + '</td><td class="l dim">' + esc(confName(t.conf)) + '</td>' +
            '<td class="big" data-v="' + p + '">' + pct(p) + '</td><td>' + fairTxt(p) + '</td>' +
            (hasBook ? edgeCell(p, b) : '') +
            '<td class="dim">' + (t.avgSeed ? t.avgSeed.toFixed(1) : '—') + '</td><td class="dim">' + pct(t.ncaa) + '</td></tr>';
        }).join('');
        var head = '<th class="rk">#</th><th class="l">Team</th><th class="l">Conf</th><th data-heat="1" title="Our chance, from 2,000 simulated seasons and tournaments">Our %</th><th data-fit-keep title="Fair price for our chance, no vig">Fair odds</th>' +
          (hasBook ? '<th title="Consensus book price">Book</th><th title="Book chance with the vig removed across the market">Book %</th><th data-fit-keep title="Our % minus the book %, in points">Edge</th>' : '') +
          '<th title="Average seed when in the field">Avg seed</th><th title="Chance to make the NCAA field">In field</th>';
        sheet('futTbl', head, body, { empty: 'No teams match.' });
        more('futMore', rows.length, FUT.show, renderFutures);
        $('futHint').textContent = M.label + ' · ' + res.sims.toLocaleString() + ' simulated seasons' + (hasBook ? ' · book prices as of ' + new Date(BOOK.stamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ' · book prices appear when the feed has them');
      });
    });
  }

  // ── CONFERENCES ────────────────────────────────────────────────────────────
  var CONF = { code: null };
  var POWER = ['SEC', 'BIG-12', 'B10', 'ACC', 'Big-East', 'MWC', 'WCC', 'A10', 'AAC', 'PAC-12'];
  function renderConf() {
    runSim().then(function (res) {
      if (!res) return;
      var codes = Object.keys(res.CT).filter(function (c) { return res.CT[c] && res.CT[c].teams && res.CT[c].teams.length; });
      codes.forEach(function (c) { var f = res.CT[c].fmt; CONF_LABEL[c] = (f && f.name) || c; });
      var strength = {}; codes.forEach(function (c) { var ts = res.CT[c].teams; strength[c] = ts.reduce(function (s, t) { return s + ((R.rows[t.team] || {}).rating || -20); }, 0) / ts.length; });
      codes.sort(function (a, b) { return strength[b] - strength[a]; });
      var sel = $('confSel2');
      if (sel && !sel.options.length) {
        sel.innerHTML = codes.map(function (c) { return '<option value="' + c + '">' + esc(confName(c)) + '</option>'; }).join('');
        sel.onchange = function () { CONF.code = sel.value; renderConf(); };
      }
      if (!CONF.code) CONF.code = codes.indexOf('SEC') >= 0 ? 'SEC' : codes[0];
      if (sel) sel.value = CONF.code;
      var C = res.CT[CONF.code]; if (!C) return;
      var rows = C.teams.slice().sort(function (a, b) { return (b.title - a.title) || (b.champ - a.champ); });
      var body = rows.map(function (t, i) {
        var pt = res.byTeam[t.team] || {};
        return '<tr><td class="rk">' + (i + 1) + '</td><td class="l nm">' + teamCell(t.team) + '</td>' +
          '<td>' + t.cw.toFixed(1) + '–' + t.cl.toFixed(1) + '</td>' +
          '<td class="big" data-v="' + t.title + '">' + pct(t.title) + '</td><td>' + fairTxt(t.title) + '</td>' +
          '<td class="dim">' + pct(t.outright) + '</td>' +
          '<td class="big" data-v="' + t.champ + '">' + pct(t.champ) + '</td><td>' + fairTxt(t.champ) + '</td>' +
          '<td data-v="' + (pt.ncaa || 0) + '">' + pct(pt.ncaa) + '</td><td class="dim">' + (t.avgSeed != null ? t.avgSeed.toFixed(1) : '—') + '</td></tr>';
      }).join('');
      var head = '<th class="rk">#</th><th class="l">Team</th><th title="Projected conference record">Conf record</th>' +
        '<th data-heat="1" title="Chance to win or share the regular-season title">Reg. season</th><th>Fair odds</th><th title="Chance to win it outright">Outright</th>' +
        '<th data-heat="1" title="Chance to win the conference tournament (the automatic bid)">Tournament</th><th>Fair odds</th>' +
        '<th data-heat="1" title="Chance to make the NCAA field">NCAA bid</th><th title="Average seed in the conference tournament">Conf seed</th>';
      sheet('confTbl', head, body);
      $('confHint').textContent = (C.fmt && C.fmt.name ? C.fmt.name + ' · ' : '') + C.teams.length + ' teams · ' + C.sims.toLocaleString() + ' simulated seasons';
    });
  }

  // ── WIN TOTALS ─────────────────────────────────────────────────────────────
  // line = the half-point nearest our median wins; over/under = share of simulated seasons above / below it
  var WT = { conf: '', q: '', sort: 'rank', show: { lim: 75, all: false } };
  function winRows(res) {
    if (WT.rows) return WT.rows;
    var out = [];
    Object.keys(res.CT).forEach(function (code) {
      var C = res.CT[code]; if (!C || !C.proj) return;
      Object.keys(C.proj).forEach(function (full) {
        var P = C.proj[full]; if (!P || !P.W || !P.W.length) return;
        var W = Array.prototype.slice.call(P.W).sort(function (a, b) { return a - b; }), n = W.length;
        // our line = the half-point that splits the simulated seasons closest to 50/50 (a lean only means
        // something against a BOOK number, so we don't manufacture one from integer rounding)
        var med = W[Math.floor(n / 2)], overAt = function (L) { return W.filter(function (w) { return w > L; }).length / n; };
        var line = [med - 0.5, med + 0.5].sort(function (a, b) { return Math.abs(overAt(a) - 0.5) - Math.abs(overAt(b) - 0.5); })[0];
        var over = overAt(line);
        out.push({ full: full, code: code, n: P.n, expW: P.expW, line: line, over: over, under: 1 - over, lo: P.lo, hi: P.hi, p20: P.p20, p25: P.p25,
          rank: (R.rows[full] || {}).rank || 999 });
      });
    });
    return (WT.rows = out);
  }
  function renderWins() {
    runSim().then(function (res) {
      if (!res) return;
      var all = winRows(res);
      var sel = $('wtConf');
      if (sel && sel.options.length <= 1) {
        var codes = Object.keys(res.CT).sort(function (a, b) { var ia = POWER.indexOf(a), ib = POWER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || confName(a).localeCompare(confName(b)); });
        codes.forEach(function (c) { var f = res.CT[c].fmt; CONF_LABEL[c] = (f && f.name) || CONF_LABEL[c] || c; });
        sel.innerHTML = '<option value="">All conferences</option>' + codes.map(function (c) { return '<option value="' + c + '">' + esc(confName(c)) + '</option>'; }).join('');
        sel.onchange = function () { WT.conf = sel.value; WT.show.all = false; renderWins(); };
      }
      var q = WT.q.toLowerCase();
      var rows = all.filter(function (r) { return (!WT.conf || r.code === WT.conf) && (!q || (r.full + ' ' + short(r.full)).toLowerCase().indexOf(q) >= 0); });
      var key = WT.sort;
      rows.sort(function (a, b) {
        if (key === 'rank') return a.rank - b.rank;
        return b[key] - a[key];
      });
      var lim = WT.show.all ? rows.length : Math.min(rows.length, WT.show.lim);
      var body = rows.slice(0, lim).map(function (r, i) {
        return '<tr><td class="rk">' + (i + 1) + '</td><td class="l nm">' + teamCell(r.full) + '</td><td class="l dim">' + esc(confName(r.code)) + '</td>' +
          '<td>' + r.n + '</td><td class="big">' + r.line.toFixed(1) + '</td>' +
          '<td data-v="' + r.over + '">' + pct(r.over, 0) + ' <span class="dim">' + fairTxt(r.over) + '</span></td>' +
          '<td data-v="' + r.under + '">' + pct(r.under, 0) + ' <span class="dim">' + fairTxt(r.under) + '</span></td>' +
          '<td>' + r.expW.toFixed(1) + '</td><td class="dim">' + r.lo + '–' + r.hi + '</td><td class="dim">' + pct(r.p20, 0) + '</td></tr>';
      }).join('');
      var head = '<th class="rk">#</th><th class="l">Team</th><th class="l">Conf</th><th title="Regular-season games on the schedule">G</th><th data-fit-keep title="Our win line: the half-point that splits our simulated seasons closest to 50/50">Line</th>' +
        '<th data-fit-keep title="Chance to finish over the line · fair price">Over</th><th data-fit-keep title="Chance to finish under the line · fair price">Under</th>' +
        '<th title="Expected wins">Exp W</th><th title="10th–90th percentile of simulated seasons">Range</th><th title="Chance of 20 or more wins">20+</th>';
      sheet('wtTbl', head, body, { empty: 'No teams match.' });
      more('wtMore', rows.length, WT.show, renderWins);
      $('wtHint').textContent = rows.length + ' teams · regular season, results so far included';
    });
  }

  // ── AWARDS ─────────────────────────────────────────────────────────────────
  var AW = { data: null, scope: 'national', race: 'poy' };
  var RACE = { poy: 'Player of the Year', dpoy: 'Defensive POY', roy: 'Freshman of the Year', sixth: 'Sixth Man' };
  function renderAwards() {
    var go = function (d) {
      if (!d) { sheet('awTbl', '<th></th>', '', { empty: 'Award odds are not available yet.' }); return; }
      var sel = $('awScope');
      if (sel && !sel.options.length) {
        var cs = Object.keys(d.conferences || {}).sort(function (a, b) { return (d.conferences[b].teams || 0) - (d.conferences[a].teams || 0) || a.localeCompare(b); });
        sel.innerHTML = '<option value="national">National Player of the Year</option>' + cs.map(function (c) { return '<option value="' + c + '">' + esc(d.conferences[c].label || c) + '</option>'; }).join('');
        sel.onchange = function () { AW.scope = sel.value; renderAwards(); };
      }
      var raceRow = $('awRace'); if (raceRow) raceRow.style.display = AW.scope === 'national' ? 'none' : '';
      var list = AW.scope === 'national' ? d.national : ((d.conferences[AW.scope] || {})[AW.race] || []);
      var body = (list || []).map(function (p, i) {
        return '<tr><td class="rk">' + (i + 1) + '</td><td class="l nm"><a href="player.html?espn=' + p.espn_id + '">' + esc(p.name) + '</a></td>' +
          '<td class="l dim">' + esc(p.team) + '</td><td class="dim">' + esc(p.pos || '') + '</td><td class="dim">' + esc(p.yr || '') + '</td>' +
          '<td class="big" data-v="' + p.p + '">' + pct(p.p) + '</td><td>' + fairTxt(p.p) + '</td>' +
          '<td>' + (p.ppg != null ? p.ppg.toFixed(1) : '—') + '</td><td>' + (p.rpg != null ? p.rpg.toFixed(1) : '—') + '</td><td>' + (p.apg != null ? p.apg.toFixed(1) : '—') + '</td></tr>';
      }).join('');
      var head = '<th class="rk">#</th><th class="l">Player</th><th class="l">Team</th><th>Pos</th><th>Yr</th><th data-heat="1" title="Our chance to win, from simulated seasons and past voting">Our %</th><th data-fit-keep>Fair odds</th><th title="Projected points per game">PPG</th><th>RPG</th><th>APG</th>';
      sheet('awTbl', head, body, { empty: 'No odds for this race yet.' });
      $('awHint').textContent = (AW.scope === 'national' ? 'National Player of the Year' : ((d.conferences[AW.scope] || {}).label || AW.scope) + ' · ' + RACE[AW.race]) +
        ' · ' + (d.mode === 'preseason' ? 'preseason' : 'in-season') + ' odds, built ' + d.built;
    };
    if (AW.data) return go(AW.data);
    fetch('scripts/data/award_odds.json?v=' + (window.TDC_BL_AWV || 1)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) { AW.data = d; loadRatings().then(function () { go(d); }); });
  }

  // ── tabs ───────────────────────────────────────────────────────────────────
  var RENDER = { futures: renderFutures, conferences: renderConf, wins: renderWins, awards: renderAwards, markets: function () { if (window.TDC_MK) TDC_MK.render(); } };
  var TABS = ['games', 'markets', 'props', 'futures', 'conferences', 'wins', 'awards', 'trends', 'tools'];
  function show(tab, push) {
    if (TABS.indexOf(tab) < 0) tab = 'games';
    document.querySelectorAll('#blTabs [data-tab]').forEach(function (b) { var on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    TABS.forEach(function (t) { var p = $('bl-' + t); if (p) p.hidden = t !== tab; });
    if (RENDER[tab]) RENDER[tab]();
    if (push !== false) {
      try { var u = new URL(location.href); u.searchParams.set('tab', tab); history.replaceState(null, '', u); } catch (e) {}
    }
  }
  function boot() {
    document.querySelectorAll('#blTabs [data-tab]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.tab); }); });
    document.querySelectorAll('#futPills [data-mk]').forEach(function (b) {
      b.addEventListener('click', function () { document.querySelectorAll('#futPills [data-mk]').forEach(function (x) { x.classList.toggle('on', x === b); }); FUT.mk = b.dataset.mk; FUT.show.all = false; renderFutures(); });
    });
    document.querySelectorAll('#awRace [data-race]').forEach(function (b) {
      b.addEventListener('click', function () { document.querySelectorAll('#awRace [data-race]').forEach(function (x) { x.classList.toggle('on', x === b); }); AW.race = b.dataset.race; renderAwards(); });
    });
    document.querySelectorAll('#wtSort [data-sort]').forEach(function (b) {
      b.addEventListener('click', function () { document.querySelectorAll('#wtSort [data-sort]').forEach(function (x) { x.classList.toggle('on', x === b); }); WT.sort = b.dataset.sort; renderWins(); });
    });
    var fq = $('futSearch'); if (fq) fq.oninput = function () { FUT.q = fq.value || ''; renderFutures(); };
    var wq = $('wtSearch'); if (wq) wq.oninput = function () { WT.q = wq.value || ''; renderWins(); };
    var want = new URLSearchParams(location.search).get('tab') || (location.hash || '').replace('#', '');
    show(want || 'games', false);
  }
  // shared with tdc-markets.js (the Markets tab prices the same simulated seasons)
  window.TDC_BL = { show: show, fair: fair, fairTxt: fairTxt, oddsTxt: oddsTxt, sim: runSim, ratings: loadRatings, book: loadBook,
    rows: function () { return R.rows; }, logo: logo, short: short };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
