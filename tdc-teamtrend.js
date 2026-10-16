/* ============================================================
   TDC TEAM TREND — a team's season as a trend line (owner, Oct 2026: "show in the trendline how [teams] are trending in
   the offseason and as the regular season goes on", our own stats, not a copy of the reference charts).

   Each game is a BAR from what we expected (owner's pick, mockup A): up/green = beat it, down/red = fell short, with the
   opponent logo + W/L under it and one team-colour 5-game form line. The default stat is the GAME POWER RATING — the margin
   adjusted for opponent and venue, on the homepage Power Rating's points scale: game rating = margin + opponent's rating
   ± home edge (3.7). Expected = the team's daily Power Rating on that date (2026-27) or the season average. 2026-27 also
   shows a PRESEASON panel (daily Power Rating from scripts/data/rank_history_2027.json + scrimmages as hollow bars) left
   of an "Opening night" divider, so the chart runs from the offseason into the season.

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
  // BARS VS EXPECTATION (owner picked mockup A, Oct 2026 — the dot-scatter read too much like barttorvik): each game is a bar
  // from what we expected, up/green when the team beat it, down/red when it fell short; opponent logo + W/L under each
  // bar; one team-colour 5-game line. Expected = the team's daily Power Rating on the game date (2026-27, from the rank
  // snapshots) for Game Power Rating, else the season average of the stat. 2026-27 adds a PRESEASON panel left of an
  // "Opening night" divider: the daily Power Rating line and the scrimmages (hollow bars vs that day's rating).
  function logoOf(t) { try { var c = g.tdcTeamColor && g.tdcTeamColor(t); return c && c.logo; } catch (e) { return null; } }
  function draw(host, st, data, opt) {
    var S = STATS[opt.stat] || STATS.perf, inv = opt.stat === 'pa', all = data.games.filter(function (p) { return S.f(p) != null; });
    var a = Math.max(1, Math.min(all.length, opt.start || 1)), b = Math.max(a, Math.min(all.length, opt.end || all.length));
    var G = all.slice(a - 1, b), D = data.days, SC = data.scrims.filter(function (p) { return S.f(p) != null; });
    var pre = opt.season === 2027 && (D.length || SC.length);
    if (!G.length && !pre) return '<div class="tt-empty">No games found for this season.</div>';
    var dayRating = function (date) { var r = null; D.forEach(function (d) { if (d.date <= date) r = d.rating; }); return r != null ? r : (D[0] ? D[0].rating : null); };
    var gv = G.map(S.f), mean = gv.length ? gv.reduce(function (x, y) { return x + y; }, 0) / gv.length : 0;
    var expOf = function (p) { return opt.stat === 'perf' && D.length ? dayRating(p.date) : mean; };
    var dev = G.map(function (p) { var d = S.f(p) - expOf(p); return inv ? -d : d; });   // + = better than expected (fewer points allowed counts as better)
    var W = Math.max(320, Math.min(host.clientWidth || 900, 1100)), Hh = Math.round(Math.min(380, Math.max(260, W * 0.36))), pt = 14, pb = 58, pr = 10, pl = 38;
    var preW = pre ? (G.length ? Math.max(120, Math.min(260, W * 0.22)) : W - pl - pr - 4) : 0, x0 = pl + preW + (pre ? 18 : 0), cw = G.length ? (W - x0 - pr) / G.length : 0;
    var m = Math.max(8, Math.max.apply(null, dev.map(Math.abs).concat([1])) * 1.12), Y = function (d) { return pt + (Hh - pt - pb) * (0.5 - d / (2 * m)); }, X = function (i) { return x0 + cw * (i + 0.5); };
    var s = '<svg class="tt-svg" viewBox="0 0 ' + W + ' ' + Hh + '" width="100%" role="img" aria-label="' + esc(S.lab) + ' vs expectation">';
    if (G.length) {
      var step = m > 30 ? 20 : m > 14 ? 10 : 5;
      for (var t = -Math.floor(m / step) * step; t <= m; t += step) s += '<line x1="' + x0 + '" x2="' + (W - pr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="tt-grid' + (t === 0 ? ' z' : '') + '"/>' +
        '<text x="' + (x0 - 6) + '" y="' + (Y(t) + 4) + '" class="tt-ax" text-anchor="end">' + (t > 0 ? '+' : '') + t + '</text>';
      s += '<text x="' + (x0 + 4) + '" y="' + (Y(0) - 6) + '" class="tt-ax">' + (opt.stat === 'perf' && D.length ? 'expected (daily Power Rating)' : 'expected (season avg ' + (S.sign ? sg(mean) : mean.toFixed(1)) + ')') + '</text>';
      var bw = Math.max(3, cw * 0.62);
      G.forEach(function (p, i) { var d = dev[i], y0 = Y(0), y1 = Y(d), lg = logoOf(p.opp);
        var tip = esc(md(p.date) + ' · ' + (p.venue === 'A' ? '@ ' : p.venue === 'N' ? 'vs ' : 'vs ') + shortNm(p.opp) + (p.venue === 'N' ? ' (neutral)' : '') + ' · ' + (p.win ? 'W ' : 'L ') + p.pf + '–' + p.pa + ' · ' + S.lab + ' ' + (S.sign ? sg(S.f(p)) : S.f(p)) + ' · ' + sg(d) + ' vs expected');
        s += '<rect class="tt-bar ' + (d >= 0 ? 'up' : 'dn') + '" x="' + (X(i) - bw / 2) + '" y="' + Math.min(y0, y1) + '" width="' + bw + '" height="' + Math.max(1, Math.abs(y1 - y0)) + '" rx="2" data-tip="' + tip + '" data-href="game.html?id=' + p.id + '"/>';
        s += '<text x="' + X(i) + '" y="' + (Hh - pb + 14) + '" text-anchor="middle" class="tt-wl ' + (p.win ? 'w' : 'l') + '">' + (p.win ? 'W' : 'L') + '</text>';
        var ls = Math.min(cw * 0.8, 24); if (lg && cw >= 9) s += '<image href="' + lg + '" x="' + (X(i) - ls / 2) + '" y="' + (Hh - pb + 20) + '" width="' + ls + '" height="' + ls + '"/>'; });
      var r5 = dev.map(function (x, i) { var w = dev.slice(Math.max(0, i - 4), i + 1); return w.reduce(function (u, v) { return u + v; }, 0) / w.length; });
      if (G.length >= 2) s += '<path d="' + smooth(r5.map(function (x, i) { return [X(i), Y(x)]; })) + '" class="tt-form" style="stroke:' + (opt.color || 'var(--text)') + '"/>';
    }
    // preseason panel: daily Power Rating (own scale) + scrimmages as hollow bars vs that day's rating
    if (pre) {
      var px0 = pl, px1 = pl + preW, rs = D.map(function (d) { return d.rating; }), rlo = Math.min.apply(null, rs.concat([99])), rhi = Math.max.apply(null, rs.concat([-99]));
      if (!D.length) { rlo = 0; rhi = 1; } var rp = Math.max(2, (rhi - rlo) * 0.5); rlo -= rp; rhi += rp;
      var dts = D.map(function (d) { return d.date; }).concat(SC.map(function (p) { return p.date; })).sort(), dt0 = +new Date(dts[0] + 'T12:00:00'), dt1 = +new Date(dts[dts.length - 1] + 'T12:00:00'); if (dt1 - dt0 < 864e5 * 4) { dt0 -= 864e5 * 2; dt1 += 864e5 * 2; }
      var PX = function (d) { return px0 + 8 + (preW - 16) * ((+new Date(d + 'T12:00:00') - dt0) / Math.max(1, dt1 - dt0)); }, PY = function (v) { return pt + 34 + (Hh - pt - pb - 34) * (1 - (v - rlo) / Math.max(1e-6, rhi - rlo)); };
      s += '<rect x="' + px0 + '" y="' + pt + '" width="' + preW + '" height="' + (Hh - pt - pb + 2) + '" rx="8" class="tt-pre"/><text x="' + (px0 + 8) + '" y="' + (pt + 13) + '" class="tt-ax b">PRESEASON · daily Power Rating</text>';
      if (D.length >= 2) s += '<path d="' + smooth(D.map(function (d) { return [PX(d.date), PY(d.rating)]; })) + '" class="tt-days" style="stroke:' + (opt.color || 'var(--accent)') + '"/>';
      // the dashed "expected" line; its note sits in the panel's header row (owner: it was covered by the scrimmage bar)
      else if (D.length === 1) s += '<line x1="' + (px0 + 8) + '" x2="' + (px1 - 8) + '" y1="' + PY(D[0].rating) + '" y2="' + PY(D[0].rating) + '" class="tt-open"/>';
      s += '<text x="' + (px0 + 8) + '" y="' + (pt + 28) + '" class="tt-ax">' + (D.length < 2 ? 'dashed = expected (Power Rating) · the line grows one point a day' : 'bars = scrimmage vs that day’s rating') + '</text>';
      if (D.length) { var dl = D[D.length - 1]; s += '<circle cx="' + PX(dl.date) + '" cy="' + PY(dl.rating) + '" r="4.5" style="fill:' + (opt.color || 'var(--accent)') + '"/><text x="' + Math.min(px1 - 6, PX(dl.date) + 7) + '" y="' + (PY(dl.rating) - 8) + '" class="tt-ax b" text-anchor="' + (PX(dl.date) > px1 - 60 ? 'end' : 'start') + '">' + sg(dl.rating) + ' · #' + dl.rank + '</text>'; }
      // scrimmage bars on their own scale: the biggest one reaches ~40% of the panel height from that day's rating
      var scMax = Math.max(10, Math.max.apply(null, SC.map(function (p) { var e = dayRating(p.date); return e == null ? 0 : Math.abs(S.f(p) - e); }).concat([0]))), scK = (Hh - pt - pb - 34) * 0.36 / scMax;
      SC.forEach(function (p) { if (opt.stat !== 'perf') return; var e = dayRating(p.date); if (e == null) return; var d = S.f(p) - e, y0 = PY(e), y1 = y0 - d * scK;
        s += '<rect class="tt-bar sc ' + (d >= 0 ? 'up' : 'dn') + '" x="' + (PX(p.date) - 5) + '" y="' + Math.min(y0, y1) + '" width="10" height="' + Math.max(1, Math.abs(y1 - y0)) + '" rx="2" data-tip="' + esc(md(p.date) + ' scrimmage · ' + (p.venue === 'A' ? '@ ' : 'vs ') + shortNm(p.opp) + ' · ' + (p.win ? 'W ' : 'L ') + p.pf + '–' + p.pa + ' · ' + sg(S.f(p)) + ' (' + sg(d) + ' vs that day’s rating)') + '" data-href="scrimmage.html?id=' + encodeURIComponent(p.id) + '"/>';
        var lg2 = logoOf(p.opp), bx = PX(p.date); s += '<text x="' + bx + '" y="' + (Math.min(y0, y1) - 5) + '" text-anchor="middle" class="tt-wl ' + (p.win ? 'w' : 'l') + '">' + (p.win ? 'W ' : 'L ') + p.pf + '–' + p.pa + '</text>';
        if (lg2) s += '<image href="' + lg2 + '" x="' + (bx - 11) + '" y="' + (Hh - pb + 20) + '" width="22" height="22" opacity=".9"/>'; });   // under the panel, like the game logos
      if (G.length) s += '<line x1="' + (px1 + 9) + '" x2="' + (px1 + 9) + '" y1="' + pt + '" y2="' + (Hh - pb + 2) + '" class="tt-open"/><text x="' + (px1 + 13) + '" y="' + (pt + 10) + '" class="tt-ax b">Opening night →</text>';
      else s += '<text x="' + (px1 + 12) + '" y="' + ((Hh - pb) / 2) + '" class="tt-ax">Games appear here from opening night →</text>';
    }
    s += '</svg>';
    var beat = dev.filter(function (d) { return d > 0; }).length, r5n = dev.length ? dev.slice(-5).reduce(function (u, v) { return u + v; }, 0) / Math.min(5, dev.length) : null;
    var best = G.length ? Math.max.apply(null, gv) : null, worst = G.length ? Math.min.apply(null, gv) : null;
    var foot = '<div class="tt-foot">' + (all.length < 2 ? '' : '<label>Games <input type="number" class="tt-a" min="1" max="' + all.length + '" value="' + a + '"> to <input type="number" class="tt-b" min="1" max="' + all.length + '" value="' + b + '"> of ' + all.length + '</label>') +
      (G.length ? '<span>Beat expectation in <b>' + beat + ' of ' + G.length + '</b></span><span>' + (inv ? 'Fewest' : 'Best') + ' <b>' + (S.sign ? sg(inv ? worst : best) : (inv ? worst : best)) + '</b></span><span>' + (inv ? 'Most' : 'Worst') + ' <b>' + (S.sign ? sg(inv ? best : worst) : (inv ? best : worst)) + '</b></span>' +
        '<span>Last ' + Math.min(5, G.length) + ' <b style="color:' + (r5n >= 0 ? 'var(--tt-up)' : 'var(--tt-dn)') + '">' + sg(r5n) + '</b> vs expected</span>' : '') +
      (D.length ? '<span>Preseason Power Rating <b>' + sg(D[0].rating) + '</b>' + (D.length > 1 ? ' → <b>' + sg(D[D.length - 1].rating) + '</b>' : '') + ' (#' + D[D.length - 1].rank + ')</span>' : '') + '</div>';
    return s + foot;
  }
  function legend(opt) {
    return '<div class="tt-lg"><span><i class="k b up"></i>beat expectation</span><span><i class="k b dn"></i>fell short</span><span><i class="k ln" style="background:' + (opt.color || 'var(--text)') + '"></i>5-game form</span>' +
      (opt.season === 2027 ? '<span><i class="k b hol"></i>scrimmage</span>' : '') + '<span>Click a bar for the box score</span></div>';
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
    st.textContent = ':root{--tt-up:#1F8A4C;--tt-dn:#C44536;--tt-w:rgba(46,160,90,.45);--tt-l:rgba(215,70,60,.38);}' +
      ':root[data-theme="dark"]{--tt-up:#5ee89a;--tt-dn:#ff7b6b;--tt-w:rgba(94,232,154,.4);--tt-l:rgba(255,123,107,.36);}' +
      '.tt-wrap{position:relative;}.tt-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 0 8px;font-size:12px;font-weight:700;color:var(--text2);}' +
      '.tt-ctl select{margin-left:6px;font:600 12px Inter,system-ui,sans-serif;padding:4px 6px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--text);}' +
      '.tt-note{font-weight:500;color:var(--text3);font-size:11px;}.tt-svg{display:block;}' +
      '.tt-grid{stroke:var(--border);stroke-width:1;}.tt-grid.v{stroke-dasharray:2 4;}.tt-grid.z{stroke:var(--text3);}' +
      '.tt-ax{font:600 11px Inter,system-ui,sans-serif;fill:var(--text3);}' +
      '.tt-mean{stroke:#d24a3b;stroke-width:1.4;stroke-dasharray:2 3;}.tt-reg{stroke:var(--text3);stroke-width:2;opacity:.7;}' +
      '.tt-cum{fill:none;stroke:var(--text);stroke-width:3.2;stroke-linecap:round;}.tt-roll{fill:none;stroke:var(--text);stroke-width:3;stroke-dasharray:3 4;stroke-linecap:round;opacity:.85;}' +
      '.tt-days{fill:none;stroke-width:3;}' +
      '.tt-bar{cursor:pointer;}.tt-bar.up{fill:var(--tt-up);opacity:.82;}.tt-bar.dn{fill:var(--tt-dn);opacity:.78;}.tt-bar:hover{opacity:1;}' +
      '.tt-bar.sc{fill:none!important;stroke-width:2;opacity:1;}.tt-bar.sc.up{stroke:var(--tt-up);}.tt-bar.sc.dn{stroke:var(--tt-dn);}' +
      '.tt-form{fill:none;stroke-width:3.5;stroke-linecap:round;}.tt-wl{font:800 9.5px Inter,system-ui,sans-serif;}.tt-wl.w{fill:var(--tt-up);}.tt-wl.l{fill:var(--tt-dn);}' +
      '.tt-pre{fill:var(--bg2);stroke:var(--border);}.tt-open{stroke:var(--text3);stroke-width:1.5;stroke-dasharray:4 4;}.tt-ax.b{font-weight:800;fill:var(--text2);letter-spacing:.04em;}' +
      '.tt-lg .k.b{width:10px;height:10px;border-radius:2px;}.tt-lg .k.b.up{background:var(--tt-up);}.tt-lg .k.b.dn{background:var(--tt-dn);}.tt-lg .k.b.hol{border:2px solid var(--text3);width:7px;height:7px;}' +
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
