/* ============================================================
   TDC TEAM TREND — a team's season as a trend line (owner, Oct 2026: "show in the trendline how [teams] are trending in
   the offseason and as the regular season goes on", our own stats, not a copy of the reference charts).

   Every game is a dot: green = win, red = loss; circle = home, square = away, diamond = neutral; bigger = tougher
   opponent. The default stat is the GAME POWER RATING — the margin adjusted for the opponent and the venue, on the same
   points scale as the homepage Power Rating (a team's season of game ratings averages out to about its Power Rating):
       game rating = margin + opponent's rating ± home edge (3.7)
   Lines: dotted = 5-game rolling average, solid = season-to-date average, grey = straight-line trend, red dotted = the
   season mean. 2026-27 also draws the PRESEASON: the team's daily Power Rating (scripts/data/rank_history_2027.json,
   one snapshot per day) and its scrimmages (hollow), so the line runs from the offseason into the season.

   Data: Supabase games (+ team_seasons ratings) for past seasons; predictive_ratings for 2026-27 opponents.
   API: TDCTeamTrend.render(host, { full: 'Duke Blue Devils', short: 'Duke' })
============================================================ */
(function (g) {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye', HCA = 3.7;
  var H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  var J = {};
  function get(url) { if (!J[url]) J[url] = fetch(url, { headers: url.indexOf(SB) === 0 ? H : {} }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); return J[url]; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function shortNm(full) { try { return (g.tdcShortSchool && g.tdcShortSchool(full)) || String(full || '').replace(/ \S+$/, ''); } catch (e) { return full; } }
  function md(d) { var x = new Date(d + 'T12:00:00'); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function sg(v, d) { if (v == null || !isFinite(v)) return '—'; var s = (+v).toFixed(d == null ? 1 : d); return (v > 0 ? '+' : '') + s; }
  var STATS = {
    perf: { lab: 'Game Power Rating', note: 'margin adjusted for opponent and venue, same scale as Power Rating', f: function (p) { return p.perf; }, sign: true },
    margin: { lab: 'Scoring margin', note: 'points scored minus allowed', f: function (p) { return p.margin; }, sign: true },
    pf: { lab: 'Points scored', note: '', f: function (p) { return p.pf; } },
    pa: { lab: 'Points allowed', note: 'lower is better', f: function (p) { return p.pa; } }
  };

  // ── data ──
  function ratings2027() {
    return get(SB + '/predictive_ratings?select=data&season=eq.2027').then(function (r) {
      var m = {}; ((r && r[0] && r[0].data && r[0].data.teams) || []).forEach(function (t) { m[t.full] = +t.rating; }); return m; });
  }
  function ratingsFor(season) {
    if (season === 2027) return ratings2027();
    return get(SB + '/team_seasons?select=team,srs&season_year=eq.' + season + '&order=team.asc&limit=1000').then(function (r) {
      var m = {}; (r || []).forEach(function (t) { if (t.srs != null) m[t.team] = +t.srs; }); return m; });
  }
  function gamesFor(full, season) {
    var q = encodeURIComponent('(home.eq."' + full + '",away.eq."' + full + '")');
    return get(SB + '/games?select=id,date,home,away,home_score,away_score,neutral,status&season_year=eq.' + season + '&or=' + q + '&order=date.asc&limit=60');
  }
  function point(full, gm, R, kind) {
    var home = gm.home === full, us = home ? gm.home_score : gm.away_score, them = home ? gm.away_score : gm.home_score;
    if (us == null || them == null) return null;
    var opp = home ? gm.away : gm.home, oR = R[opp], venue = gm.neutral ? 'N' : home ? 'H' : 'A', m = us - them;
    return { kind: kind, id: gm.id, date: gm.date, opp: opp, venue: venue, win: m > 0, pf: us, pa: them, margin: m, oppR: oR,
      perf: oR == null ? null : m + oR + (venue === 'H' ? -HCA : venue === 'A' ? HCA : 0) };
  }
  function load(full, season) {
    var jobs = [ratingsFor(season), gamesFor(full, season)];
    if (season === 2027) jobs.push(get('scripts/data/rank_history_2027.json?v=1'), get('scripts/data/scrimmages_2027.json'), get('scripts/data/scrimmage_results_2027.json'));
    return Promise.all(jobs).then(function (a) {
      var R = a[0] || {}, pts = (a[1] || []).filter(function (x) { return /FINAL/.test(x.status || 'FINAL'); }).map(function (x) { return point(full, x, R, 'game'); }).filter(Boolean), days = [], scr = [];
      if (season === 2027) {
        var Hh = a[2], Sx = a[3], Rx = a[4];
        if (Hh && Hh.days) Object.keys(Hh.days).sort().forEach(function (d) { var v = Hh.days[d][full]; if (v) days.push({ date: d, rank: v[0], rating: v[1] }); });
        ((Sx && Sx.games) || []).forEach(function (sg2) { var r = Rx && Rx.results && Rx.results[sg2.id]; if (sg2.canceled || !r || r.hs == null) return;
          if (sg2.home !== full && sg2.away !== full) return;
          var p = point(full, { id: sg2.id, date: sg2.date, home: sg2.home, away: sg2.away, home_score: r.hs, away_score: r.as, neutral: sg2.neutral }, R, 'scrim'); if (p) scr.push(p); });
      }
      return { games: pts, days: days, scrims: scr };
    });
  }

  // ── chart ──
  function linreg(xs, ys) { var n = xs.length; if (n < 2) return null; var mx = 0, my = 0, i; for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
    var sxx = 0, sxy = 0; for (i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); } var b = sxx ? sxy / sxx : 0; return { a: my - b * mx, b: b }; }
  function smooth(P) { if (P.length < 2) return ''; var d = 'M' + P[0][0] + ',' + P[0][1];
    for (var i = 1; i < P.length; i++) { var p0 = P[i - 1], p1 = P[i], cx = (p0[0] + p1[0]) / 2; d += ' C' + cx + ',' + p0[1] + ' ' + cx + ',' + p1[1] + ' ' + p1[0] + ',' + p1[1]; } return d; }
  function draw(host, st, data, opt) {
    var S = STATS[opt.stat] || STATS.perf, all = data.games.filter(function (p) { return S.f(p) != null; });
    var a = Math.max(1, Math.min(all.length, opt.start || 1)), b = Math.max(a, Math.min(all.length, opt.end || all.length));
    var G = all.slice(a - 1, b), SC = data.scrims.filter(function (p) { return S.f(p) != null; }), D = opt.stat === 'perf' ? data.days : [];
    var W = Math.max(320, Math.min(host.clientWidth || 900, 1100)), Hh = Math.round(Math.min(440, Math.max(280, W * 0.42))), pl = 12, pr = 44, pt = 14, pb = 30;
    var dates = G.map(function (p) { return p.date; }).concat(SC.map(function (p) { return p.date; }), D.map(function (p) { return p.date; })).sort();
    if (!dates.length) return '<div class="tt-empty">No ' + (opt.season === 2027 ? '2026-27 data yet — daily ratings and scrimmages fill in here through the preseason, games from opening night.' : 'games found for this season.') + '</div>';
    var t0 = +new Date(dates[0] + 'T12:00:00'), t1 = +new Date(dates[dates.length - 1] + 'T12:00:00'); if (t1 - t0 < 864e5 * 6) { t0 -= 864e5 * 3; t1 += 864e5 * 3; }
    var ys = G.map(S.f).concat(SC.map(S.f), D.map(function (p) { return p.rating; }));
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), padY = Math.max(4, (hi - lo) * 0.08); lo -= padY; hi += padY;
    var X = function (d) { return pl + (W - pl - pr) * ((+new Date(d + 'T12:00:00') - t0) / Math.max(1, t1 - t0)); }, Y = function (v) { return pt + (Hh - pt - pb) * (1 - (v - lo) / Math.max(1e-6, hi - lo)); };
    var s = '<svg class="tt-svg" viewBox="0 0 ' + W + ' ' + Hh + '" width="100%" role="img" aria-label="' + esc(S.lab) + ' trend">';
    // grid + y labels
    var step = [1, 2, 5, 10, 20, 25, 50].find(function (k) { return (hi - lo) / k <= 8; }) || 50;
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) { s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="tt-grid' + (v === 0 && S.sign ? ' z' : '') + '"/><text x="' + (W - pr + 6) + '" y="' + (Y(v) + 4) + '" class="tt-ax">' + (S.sign && v > 0 ? '+' : '') + v + '</text>'; }
    // month ticks
    var mo = new Date(t0); mo.setDate(1); mo.setMonth(mo.getMonth() + 1);
    for (; +mo <= t1; mo.setMonth(mo.getMonth() + 1)) { var x = pl + (W - pl - pr) * ((+mo - t0) / Math.max(1, t1 - t0)); s += '<line x1="' + x + '" x2="' + x + '" y1="' + pt + '" y2="' + (Hh - pb) + '" class="tt-grid v"/><text x="' + x + '" y="' + (Hh - 10) + '" class="tt-ax" text-anchor="middle">' + mo.toLocaleDateString('en-US', { month: 'short' }) + '</text>'; }
    // season mean (red dotted) + straight-line trend (grey)
    var gv = G.map(S.f), mean = gv.length ? gv.reduce(function (x, y) { return x + y; }, 0) / gv.length : null;
    if (mean != null && G.length >= 2) s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(mean) + '" y2="' + Y(mean) + '" class="tt-mean"/>';
    if (G.length >= 3) { var lr = linreg(G.map(function (p, i) { return i; }), gv); s += '<line x1="' + X(G[0].date) + '" x2="' + X(G[G.length - 1].date) + '" y1="' + Y(lr.a) + '" y2="' + Y(lr.a + lr.b * (G.length - 1)) + '" class="tt-reg"/>'; }
    // preseason daily Power Rating
    if (D.length >= 2) s += '<path d="' + smooth(D.map(function (p) { return [X(p.date), Y(p.rating)]; })) + '" class="tt-days" style="stroke:' + (opt.color || 'var(--accent)') + '"/>';
    if (D.length) { var dl = D[D.length - 1]; s += '<circle cx="' + X(dl.date) + '" cy="' + Y(dl.rating) + '" r="4" style="fill:' + (opt.color || 'var(--accent)') + '"/>'; }
    // season-to-date average (solid) + 5-game rolling (dotted)
    if (G.length >= 2) { var cum = 0, C = G.map(function (p, i) { cum += S.f(p); return [X(p.date), Y(cum / (i + 1))]; }); s += '<path d="' + smooth(C) + '" class="tt-cum"/>';
      var Rr = G.map(function (p, i) { var w = G.slice(Math.max(0, i - 4), i + 1).map(S.f); return [X(p.date), Y(w.reduce(function (x, y) { return x + y; }, 0) / w.length)]; }); s += '<path d="' + smooth(Rr) + '" class="tt-roll"/>'; }
    // dots: games (size = opponent strength), scrimmages hollow
    var oz = function (p) { var r = p.oppR == null ? -10 : p.oppR; return Math.max(4, Math.min(12, 7 + r * 0.22)); };
    var mark = function (p, cls) { var cx = X(p.date), cy = Y(S.f(p)), r = oz(p), tip = esc(md(p.date) + ' · ' + (p.venue === 'A' ? '@ ' : 'vs ') + shortNm(p.opp) + ' · ' + (p.win ? 'W ' : 'L ') + p.pf + '–' + p.pa + (p.kind === 'scrim' ? ' (scrimmage)' : '') + ' · ' + S.lab + ' ' + (S.sign ? sg(S.f(p)) : S.f(p)) + (p.oppR != null ? ' · opp rating ' + sg(p.oppR) : ''));
      var c = cls + (p.win ? ' w' : ' l'), at = ' class="' + c + '" data-tip="' + tip + '"' + (p.kind === 'game' ? ' data-href="game.html?id=' + p.id + '"' : p.kind === 'scrim' ? ' data-href="scrimmage.html?id=' + encodeURIComponent(p.id) + '"' : '');
      if (p.venue === 'H') return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + at + '/>';
      if (p.venue === 'N') return '<path d="M' + cx + ',' + (cy - r * 1.2) + ' L' + (cx + r * 1.2) + ',' + cy + ' L' + cx + ',' + (cy + r * 1.2) + ' L' + (cx - r * 1.2) + ',' + cy + 'Z"' + at + '/>';
      return '<rect x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + 2 * r + '" height="' + 2 * r + '"' + at + '/>'; };
    s += SC.map(function (p) { return mark(p, 'tt-dot sc'); }).join('') + G.map(function (p) { return mark(p, 'tt-dot'); }).join('') + '</svg>';
    var sd = gv.length >= 2 ? Math.sqrt(gv.reduce(function (x, y) { return x + (y - mean) * (y - mean); }, 0) / (gv.length - 1)) : null;
    var lr2 = G.length >= 3 ? linreg(G.map(function (p, i) { return i; }), gv) : null;
    var foot = '<div class="tt-foot">' + (all.length < 2 ? '' : '<label>Games <input type="number" class="tt-a" min="1" max="' + all.length + '" value="' + a + '"> to <input type="number" class="tt-b" min="1" max="' + all.length + '" value="' + b + '"> of ' + all.length + '</label>') +
      (mean != null ? '<span>Average <b>' + (S.sign ? sg(mean) : mean.toFixed(1)) + '</b></span>' : '') + (sd != null ? '<span>Spread (std. dev.) <b>' + sd.toFixed(1) + '</b></span>' : '') +
      (lr2 ? '<span>Trend <b style="color:' + ((opt.stat === 'pa' ? -lr2.b : lr2.b) >= 0 ? 'var(--tt-up)' : 'var(--tt-dn)') + '">' + sg(lr2.b * 10) + '</b> per 10 games</span>' : '') +
      (D.length ? '<span>Preseason Power Rating <b>' + sg(D[0].rating) + '</b>' + (D.length > 1 ? ' → <b>' + sg(D[D.length - 1].rating) + '</b>' : '') + ' (#' + D[D.length - 1].rank + ')</span>' : '') + '</div>';
    return s + foot;
  }
  function legend(opt) {
    return '<div class="tt-lg"><span><i class="k c w"></i>win</span><span><i class="k c l"></i>loss</span><span>● home · ■ away · ◆ neutral · bigger = tougher opponent</span>' +
      (opt.season === 2027 ? '<span><i class="k h"></i>scrimmage</span><span><i class="k ln" style="background:' + (opt.color || 'var(--accent)') + '"></i>daily Power Rating</span>' : '') +
      '<span><i class="k ln roll"></i>5-game average</span><span><i class="k ln cum"></i>season average so far</span><span><i class="k ln reg"></i>trend</span><span><i class="k ln mean"></i>season mean</span></div>';
  }

  function render(host, o) {
    if (!host || !o || !o.full) return;
    var cur = 2027, seasons = []; for (var y = cur; y >= 2007; y--) seasons.push(y);
    var opt = { stat: 'perf', season: o.season || null, color: o.color };
    host.innerHTML = '<div class="tt-wrap"><div class="tt-ctl"><label>Trend stat <select class="tt-stat">' + Object.keys(STATS).map(function (k) { return '<option value="' + k + '">' + STATS[k].lab + '</option>'; }).join('') + '</select></label>' +
      '<label>Season <select class="tt-season">' + seasons.map(function (y) { return '<option value="' + y + '">' + (y - 1) + '-' + String(y).slice(2) + '</option>'; }).join('') + '</select></label><span class="tt-note"></span></div><div class="tt-body"><div class="tt-empty">Loading…</div></div><div class="tt-tip"></div></div>';
    var body = host.querySelector('.tt-body'), tip = host.querySelector('.tt-tip'), data = null;
    var paint = function () { if (!data) return; var S = STATS[opt.stat]; host.querySelector('.tt-note').textContent = S.note; body.innerHTML = draw(body, opt.stat, data, opt) + legend(opt); };
    var go = function (season) { opt.season = season; opt.start = opt.end = null; host.querySelector('.tt-season').value = season; body.innerHTML = '<div class="tt-empty">Loading…</div>';
      load(o.full, season).then(function (d) { data = d; paint(); }); };
    host.querySelector('.tt-stat').addEventListener('change', function (e) { opt.stat = e.target.value; opt.start = opt.end = null; paint(); });
    host.querySelector('.tt-season').addEventListener('change', function (e) { go(+e.target.value); });
    body.addEventListener('change', function (e) { if (e.target.classList.contains('tt-a')) opt.start = +e.target.value; if (e.target.classList.contains('tt-b')) opt.end = +e.target.value; paint(); });
    body.addEventListener('mousemove', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { tip.classList.remove('on'); return; }
      tip.textContent = t.getAttribute('data-tip'); var w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX - w / 2)) + 'px'; tip.style.top = (e.clientY - h - 14 < 8 ? e.clientY + 18 : e.clientY - h - 14) + 'px'; tip.classList.add('on'); });
    body.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
    body.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-href]'); if (t) location.href = t.getAttribute('data-href'); });
    // 2026-27 when it has something to show (games, scrimmages or 2+ daily ratings), else last season
    if (opt.season) go(opt.season);
    else load(o.full, cur).then(function (d) { if (d.games.length || d.scrims.length || d.days.length >= 2) { data = d; opt.season = cur; host.querySelector('.tt-season').value = cur; paint(); } else go(cur - 1); });
  }

  if (!document.getElementById('tt-styles')) {
    var st = document.createElement('style'); st.id = 'tt-styles';
    st.textContent = ':root{--tt-up:#1a8c3a;--tt-dn:#c0392b;--tt-w:rgba(46,160,90,.45);--tt-l:rgba(215,70,60,.38);}' +
      ':root[data-theme="dark"]{--tt-up:#5ee89a;--tt-dn:#ff7b6b;--tt-w:rgba(94,232,154,.4);--tt-l:rgba(255,123,107,.36);}' +
      '.tt-wrap{position:relative;}.tt-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 0 8px;font-size:12px;font-weight:700;color:var(--text2);}' +
      '.tt-ctl select{margin-left:6px;font:600 12px Inter,system-ui,sans-serif;padding:4px 6px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--text);}' +
      '.tt-note{font-weight:500;color:var(--text3);font-size:11px;}.tt-svg{display:block;}' +
      '.tt-grid{stroke:var(--border);stroke-width:1;}.tt-grid.v{stroke-dasharray:2 4;}.tt-grid.z{stroke:var(--text3);}' +
      '.tt-ax{font:600 11px Inter,system-ui,sans-serif;fill:var(--text3);}' +
      '.tt-mean{stroke:#d24a3b;stroke-width:1.4;stroke-dasharray:2 3;}.tt-reg{stroke:var(--text3);stroke-width:2;opacity:.7;}' +
      '.tt-cum{fill:none;stroke:var(--text);stroke-width:3.2;stroke-linecap:round;}.tt-roll{fill:none;stroke:var(--text);stroke-width:3;stroke-dasharray:3 4;stroke-linecap:round;opacity:.85;}' +
      '.tt-days{fill:none;stroke-width:3;}' +
      '.tt-dot{cursor:pointer;}.tt-dot.w{fill:var(--tt-w);}.tt-dot.l{fill:var(--tt-l);}.tt-dot.sc{fill:none!important;stroke-width:2;}.tt-dot.sc.w{stroke:var(--tt-up);}.tt-dot.sc.l{stroke:var(--tt-dn);}' +
      '.tt-dot:hover{stroke:var(--text);stroke-width:1.5;}' +
      '.tt-foot{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin-top:6px;font-size:12px;color:var(--text2);}.tt-foot b{color:var(--text);font-variant-numeric:tabular-nums;}' +
      '.tt-foot input{width:46px;margin:0 4px;font:600 12px Inter,system-ui,sans-serif;padding:2px 4px;border:1px solid var(--border2);border-radius:5px;background:var(--bg);color:var(--text);}' +
      '.tt-lg{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;font-size:11px;color:var(--text3);}.tt-lg .k{display:inline-block;vertical-align:middle;margin-right:5px;}' +
      '.tt-lg .k.c{width:10px;height:10px;border-radius:50%;}.tt-lg .k.c.w{background:var(--tt-w);}.tt-lg .k.c.l{background:var(--tt-l);}.tt-lg .k.h{width:9px;height:9px;border-radius:50%;border:2px solid var(--text3);}' +
      '.tt-lg .k.ln{width:18px;height:3px;background:var(--text);}.tt-lg .k.ln.roll{background:repeating-linear-gradient(90deg,var(--text) 0 3px,transparent 3px 6px);}.tt-lg .k.ln.reg{background:var(--text3);}.tt-lg .k.ln.mean{background:repeating-linear-gradient(90deg,#d24a3b 0 2px,transparent 2px 4px);}' +
      '.tt-empty{padding:28px 12px;text-align:center;color:var(--text3);font-size:13px;border:1px dashed var(--border2);border-radius:8px;}' +
      '.tt-tip{position:fixed;z-index:100000;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--text);color:var(--bg);font:700 11px Inter,system-ui,sans-serif;padding:6px 9px;border-radius:6px;max-width:320px;box-shadow:0 6px 18px rgba(0,0,0,.3);}.tt-tip.on{opacity:1;}';
    document.head.appendChild(st);
  }
  g.TDCTeamTrend = { render: render, load: load };
})(window);
