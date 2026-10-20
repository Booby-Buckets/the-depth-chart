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
  // the team colour as a line/fill that stays visible: dark navies/blacks are lifted on the dark theme
  function readable(c) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return c || 'var(--accent)';
    var r = parseInt(m[1].slice(0, 2), 16), gg = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16), l = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && g.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark && l < 0.35) { var f = 0.5; r += (255 - r) * f; gg += (255 - gg) * f; b += (255 - b) * f; }
    return 'rgb(' + Math.round(r) + ',' + Math.round(gg) + ',' + Math.round(b) + ')';
  }
  function logoOf(t) { try { var c = g.tdcTeamColor && g.tdcTeamColor(t); return c && c.logo; } catch (e) { return null; } }
  function draw(host, st, data, opt) {
    opt._expLab = null;
    var S = STATS[opt.stat] || STATS.perf, inv = opt.stat === 'pa', all = data.games.filter(function (p) { return S.f(p) != null; });
    var a = Math.max(1, Math.min(all.length, opt.start || 1)), b = Math.max(a, Math.min(all.length, opt.end || all.length));
    var G = all.slice(a - 1, b), D = data.days, SC = data.scrims.filter(function (p) { return S.f(p) != null; });
    var pre = opt.season === 2027 && (D.length || SC.length);
    opt._games = G.length > 0 || opt.season !== 2027;
    if (!G.length && !pre) return '<div class="tt-empty">No games found for this season.</div>';
    var dayRating = function (date) { var r = null; D.forEach(function (d) { if (d.date <= date) r = d.rating; }); return r != null ? r : (D[0] ? D[0].rating : null); };
    var gv = G.map(S.f), mean = gv.length ? gv.reduce(function (x, y) { return x + y; }, 0) / gv.length : 0;
    var expOf = function (p) { return opt.stat === 'perf' && D.length ? dayRating(p.date) : mean; };
    var dev = G.map(function (p) { var d = S.f(p) - expOf(p); return inv ? -d : d; });   // + = better than expected (fewer points allowed counts as better)
    var W = Math.max(320, Math.min(host.clientWidth || 900, 1100)), Hh = Math.round(Math.min(380, Math.max(260, W * 0.36))), pt = 14, pb = G.length ? 58 : 6, pr = 10, pl = G.length ? 38 : 4;
    var preW = pre ? (G.length ? Math.max(120, Math.min(260, W * 0.22)) : W - pl - pr - 4) : 0, x0 = pl + preW + (pre ? 18 : 0), cw = G.length ? (W - x0 - pr) / G.length : 0;
    var m = Math.max(8, Math.max.apply(null, dev.map(Math.abs).concat([1])) * 1.12), Y = function (d) { return pt + (Hh - pt - pb) * (0.5 - d / (2 * m)); }, X = function (i) { return x0 + cw * (i + 0.5); };
    var s = '<svg class="tt-svg" viewBox="0 0 ' + W + ' ' + Hh + '" width="100%" role="img" aria-label="' + esc(S.lab) + ' vs expectation">';
    if (G.length) {
      var step = m > 30 ? 20 : m > 14 ? 10 : 5;
      for (var t = -Math.floor(m / step) * step; t <= m; t += step) s += '<line x1="' + x0 + '" x2="' + (W - pr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="tt-grid' + (t === 0 ? ' z' : '') + '"/>' +
        '<text x="' + (x0 - 6) + '" y="' + (Y(t) + 4) + '" class="tt-ax" text-anchor="end">' + (t > 0 ? '+' : '') + t + '</text>';
      // the 0 line's meaning lives in the legend (owner, Oct 2026: the label sat on top of the first bars)
      opt._expLab = (opt.stat === 'perf' && D.length ? 'expected (daily Power Rating)' : 'expected (season avg ' + (S.sign ? sg(mean) : mean.toFixed(1)) + ')');
      var bw = Math.max(3, cw * 0.62);
      G.forEach(function (p, i) { var d = dev[i], y0 = Y(0), y1 = Y(d), lg = logoOf(p.opp);
        var tip = esc(md(p.date) + ' · ' + (p.venue === 'A' ? '@ ' : p.venue === 'N' ? 'vs ' : 'vs ') + shortNm(p.opp) + (p.venue === 'N' ? ' (neutral)' : '') + ' · ' + (p.win ? 'W ' : 'L ') + p.pf + '–' + p.pa + ' · ' + S.lab + ' ' + (S.sign ? sg(S.f(p)) : S.f(p)) + ' · ' + sg(d) + ' vs expected');
        s += '<rect class="tt-bar ' + (d >= 0 ? 'up' : 'dn') + '" x="' + (X(i) - bw / 2) + '" y="' + Math.min(y0, y1) + '" width="' + bw + '" height="' + Math.max(1, Math.abs(y1 - y0)) + '" rx="2" data-tip="' + tip + '" data-href="game.html?id=' + p.id + '"/>';
        s += '<text x="' + X(i) + '" y="' + (Hh - pb + 14) + '" text-anchor="middle" class="tt-wl ' + (p.win ? 'w' : 'l') + '">' + (p.win ? 'W' : 'L') + '</text>';
        var ls = Math.min(cw * 0.8, 24); if (lg && cw >= 9) s += '<image href="' + lg + '" x="' + (X(i) - ls / 2) + '" y="' + (Hh - pb + 20) + '" width="' + ls + '" height="' + ls + '"/>'; });
      var r5 = dev.map(function (x, i) { var w = dev.slice(Math.max(0, i - 4), i + 1); return w.reduce(function (u, v) { return u + v; }, 0) / w.length; });
      if (G.length >= 2) s += '<path d="' + smooth(r5.map(function (x, i) { return [X(i), Y(x)]; })) + '" class="tt-form" style="stroke:' + (opt.color || 'var(--text)') + '"/>';
    }
    // PRESEASON panel (redesigned Oct 18 2026 — owner: "does not look good"): two strips on ONE date axis. Top: the daily
    // Power Rating line with its values and rank. Bottom: each scrimmage as a bar from a zero line = how it went vs that
    // day's rating, score + opponent logo inside the panel. Separate y scales (a rating moves tenths, a scrimmage ±10).
    if (pre) {
      var px0 = pl, px1 = pl + preW, pb0 = Hh - pb + 2, col = readable(opt.color), sc0 = opt.stat === 'perf' ? SC : [];
      s += '<rect x="' + px0 + '" y="' + pt + '" width="' + preW + '" height="' + (pb0 - pt) + '" rx="8" class="tt-pre"/><text x="' + (px0 + 10) + '" y="' + (pt + 16) + '" class="tt-ax b">PRESEASON · daily Power Rating</text>';
      if (D.length >= 2) { var d0r = D[0], d1r = D[D.length - 1], dr = d0r.rank - d1r.rank;
        s += '<text x="' + (px1 - 10) + '" y="' + (pt + 16) + '" text-anchor="end" class="tt-ax b">#' + d0r.rank + ' → #' + d1r.rank + (dr ? ' <tspan class="' + (dr > 0 ? 'tt-upt' : 'tt-dnt') + '">' + (dr > 0 ? '▲' : '▼') + Math.abs(dr) + '</tspan>' : '') + '</text>'; }
      // the shared date axis: first snapshot / scrimmage → last, a day of air either side, at least a week wide
      var dts = D.map(function (d) { return d.date; }).concat(sc0.map(function (p) { return p.date; })).sort(), DAY = 864e5, tOf = function (d) { return +new Date(d + 'T12:00:00'); };
      var dt0 = tOf(dts[0]) - DAY, dt1 = tOf(dts[dts.length - 1]) + DAY; if (dt1 - dt0 < 7 * DAY) dt1 = dt0 + 7 * DAY;
      var ix0 = px0 + 44, ix1 = px1 - 14, PX = function (d) { return ix0 + (ix1 - ix0) * ((tOf(d) - dt0) / (dt1 - dt0)); };
      var axY = pb0 - 12, top = pt + 30, hasS = sc0.length > 0, rB = hasS ? top + (axY - 18 - top) * 0.46 : axY - 20;
      // date ticks, spaced so labels never touch
      var nd = Math.round((dt1 - dt0) / DAY), every = Math.max(1, Math.ceil(nd / Math.max(2, Math.floor((ix1 - ix0) / 54))));
      for (var k = 1; k < nd; k += every) { var tx = ix0 + (ix1 - ix0) * (k / nd), dd = new Date(dt0 + k * DAY);
        s += '<line x1="' + tx + '" x2="' + tx + '" y1="' + top + '" y2="' + (axY - 10) + '" class="tt-grid v"/><text x="' + tx + '" y="' + axY + '" text-anchor="middle" class="tt-ax">' + dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</text>'; }
      // top strip: the rating line on its own nice scale
      if (D.length) {
        var rs = D.map(function (d) { return d.rating; }), lo = Math.min.apply(null, rs), hi = Math.max.apply(null, rs), span = Math.max(0.6, (hi - lo) * 1.6), mid = (lo + hi) / 2;
        lo = mid - span / 2; hi = mid + span / 2;
        var stp = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10].find(function (x) { return span / x <= 4; }) || 10, RY = function (v) { return rB - (rB - top - 8) * ((v - lo) / (hi - lo)); };
        for (var tv = Math.ceil(lo / stp) * stp; tv <= hi + 1e-9; tv += stp) s += '<line x1="' + ix0 + '" x2="' + ix1 + '" y1="' + RY(tv) + '" y2="' + RY(tv) + '" class="tt-grid"/><text x="' + (ix0 - 6) + '" y="' + (RY(tv) + 4) + '" text-anchor="end" class="tt-ax">' + sg(tv, stp < 1 ? (stp < 0.5 ? 1 : 1) : 0) + '</text>';
        var P = D.map(function (d) { return [PX(d.date), RY(d.rating)]; });
        if (P.length >= 2) s += '<path d="' + smooth(P) + '" class="tt-days" style="stroke:' + col + '"/>';
        var dp = Math.abs(D[D.length - 1].rating - D[0].rating) < 0.5 ? 2 : 1;   // a small move needs the second decimal to show
        D.forEach(function (d, n) { var last = n === D.length - 1;
          s += '<circle cx="' + P[n][0] + '" cy="' + P[n][1] + '" r="' + (last ? 5 : 3.5) + '" style="fill:' + col + '" class="tt-pt" data-tip="' + esc(md(d.date) + ' · Power Rating ' + sg(d.rating, dp) + ' · #' + d.rank) + '"/>'; });
        var lt = D[D.length - 1], lx = P[P.length - 1][0], right = lx > ix1 - 90;
        s += '<text x="' + (right ? lx - 9 : lx + 9) + '" y="' + (P[P.length - 1][1] - 9) + '" text-anchor="' + (right ? 'end' : 'start') + '" class="tt-ax b" style="font-size:12px">' + sg(lt.rating, dp) + ' · #' + lt.rank + '</text>';
      } else s += '<text x="' + ((ix0 + ix1) / 2) + '" y="' + ((top + rB) / 2) + '" text-anchor="middle" class="tt-ax">Daily ratings start with the first snapshot</text>';
      // bottom strip: scrimmages vs that day's rating
      if (hasS) {
        var sT = rB + 26, sB = axY - 16, base = (sT + sB) / 2, scMax = Math.max(10, Math.max.apply(null, sc0.map(function (p) { var e = dayRating(p.date); return e == null ? 0 : Math.abs(S.f(p) - e); }))) * 1.1, sK = (sB - sT) / 2 / scMax;
        s += '<text x="' + (px0 + 10) + '" y="' + (sT - 8) + '" class="tt-ax b">SCRIMMAGES · vs that day’s rating</text>' +
          '<line x1="' + ix0 + '" x2="' + ix1 + '" y1="' + base + '" y2="' + base + '" class="tt-grid z"/><text x="' + (ix0 - 6) + '" y="' + (base + 4) + '" text-anchor="end" class="tt-ax">0</text>';
        var bw2 = Math.min(18, Math.max(8, (ix1 - ix0) / Math.max(8, nd) * 0.7)), byDate = {};
        sc0.forEach(function (p) { var e = dayRating(p.date); if (e == null) return; var d = S.f(p) - e, n = (byDate[p.date] = (byDate[p.date] || 0) + 1) - 1;
          var bx = PX(p.date) + (n ? (n % 2 ? 1 : -1) * Math.ceil(n / 2) * (bw2 + 4) : 0), y1 = base - d * sK, up = d >= 0, lg2 = logoOf(p.opp);
          s += '<rect class="tt-bar ' + (up ? 'up' : 'dn') + '" x="' + (bx - bw2 / 2) + '" y="' + Math.min(base, y1) + '" width="' + bw2 + '" height="' + Math.max(1.5, Math.abs(y1 - base)) + '" rx="2" data-tip="' + esc(md(p.date) + ' scrimmage · ' + (p.venue === 'A' ? '@ ' : 'vs ') + shortNm(p.opp) + ' · ' + (p.win ? 'W ' : 'L ') + p.pf + '–' + p.pa + ' · game rating ' + sg(S.f(p)) + ' (' + sg(d) + ' vs that day’s rating)') + '" data-href="scrimmage.html?id=' + encodeURIComponent(p.id) + '"/>';
          // score beside the bar (owner, Oct 20: under a tall red bar it sat on the date row)
          s += '<text x="' + (bx + bw2 / 2 + 5) + '" y="' + ((base + y1) / 2 + 4) + '" text-anchor="start" class="tt-wl ' + (p.win ? 'w' : 'l') + '">' + (p.win ? 'W ' : 'L ') + p.pf + '–' + p.pa + '</text>';
          if (lg2) s += '<image href="' + lg2 + '" x="' + (bx - 9) + '" y="' + (up ? base + 4 : base - 22) + '" width="18" height="18"/>'; });
      }
      if (G.length) s += '<line x1="' + (px1 + 9) + '" x2="' + (px1 + 9) + '" y1="' + pt + '" y2="' + (Hh - pb + 2) + '" class="tt-open"/><text x="' + (px1 + 13) + '" y="' + (pt + 10) + '" class="tt-ax b">Opening night →</text>';
    }
    s += '</svg>';
    var beat = dev.filter(function (d) { return d > 0; }).length, r5n = dev.length ? dev.slice(-5).reduce(function (u, v) { return u + v; }, 0) / Math.min(5, dev.length) : null;
    var best = G.length ? Math.max.apply(null, gv) : null, worst = G.length ? Math.min.apply(null, gv) : null;
    var foot = '<div class="tt-foot">' + (all.length < 2 ? '' : '<label>Games <input type="number" class="tt-a" min="1" max="' + all.length + '" value="' + a + '"> to <input type="number" class="tt-b" min="1" max="' + all.length + '" value="' + b + '"> of ' + all.length + '</label>') +
      (G.length ? '<span>Beat expectation in <b>' + beat + ' of ' + G.length + '</b></span><span>' + (inv ? 'Fewest' : 'Best') + ' <b>' + (S.sign ? sg(inv ? worst : best) : (inv ? worst : best)) + '</b></span><span>' + (inv ? 'Most' : 'Worst') + ' <b>' + (S.sign ? sg(inv ? best : worst) : (inv ? best : worst)) + '</b></span>' +
        '<span>Last ' + Math.min(5, G.length) + ' <b style="color:' + (r5n >= 0 ? 'var(--tt-up)' : 'var(--tt-dn)') + '">' + sg(r5n) + '</b> vs expected</span>' : '') +
      '</div>';
    return s + foot;
  }
  function legend(opt) {
    if (!opt._games) return '<div class="tt-lg"><span><i class="k b up"></i>beat that day’s rating</span><span><i class="k b dn"></i>fell short</span></div>';
    return '<div class="tt-lg">' + (opt._expLab ? '<span><i class="k ln zero"></i>0 line = ' + esc(opt._expLab) + '</span>' : '') + '<span><i class="k b up"></i>beat expectation</span><span><i class="k b dn"></i>fell short</span><span><i class="k ln" style="background:' + (opt.color || 'var(--text)') + '"></i>5-game form</span>' +
      '</div>';   // owner, Oct 20: too much text — no how-to lines in the legend
  }
  function render(host, o) {
    if (!host || !o || !o.full) return;
    var cur = 2027, seasons = []; for (var y = cur; y >= 2007; y--) seasons.push(y);
    var opt = { stat: 'perf', season: o.season || null, color: o.color };
    host.innerHTML = '<div class="tt-wrap"><div class="tt-ctl"><label>Trend stat <select class="tt-stat">' + Object.keys(STATS).map(function (k) { return '<option value="' + k + '">' + STATS[k].lab + '</option>'; }).join('') + '</select></label>' +
      '<label>Season <select class="tt-season">' + seasons.map(function (y) { return '<option value="' + y + '">' + (y - 1) + '-' + String(y).slice(2) + '</option>'; }).join('') + '</select></label><span class="tt-note"></span></div><div class="tt-body"><div class="tt-empty">Loading…</div></div><div class="tt-tip"></div></div>';
    var body = host.querySelector('.tt-body'), tip = host.querySelector('.tt-tip'), data = null;
    var paint = function () { if (!data) return; var S = STATS[opt.stat]; host.querySelector('.tt-note').textContent = ''; body.innerHTML = draw(body, opt.stat, data, opt) + legend(opt); };
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
      '.tt-pre{fill:var(--bg2);stroke:var(--border);}.tt-upt{fill:var(--tt-up);}.tt-dnt{fill:var(--tt-dn);}.tt-pt{cursor:default;stroke:var(--bg2);stroke-width:2;}.tt-open{stroke:var(--text3);stroke-width:1.5;stroke-dasharray:4 4;}.tt-ax.b{font-weight:800;fill:var(--text2);letter-spacing:.04em;}' +
      '.tt-lg .k.ln.zero{background:var(--text3);height:2px;}.tt-lg .k.b{width:10px;height:10px;border-radius:2px;}.tt-lg .k.b.up{background:var(--tt-up);}.tt-lg .k.b.dn{background:var(--tt-dn);}.tt-lg .k.b.hol{border:2px solid var(--text3);width:7px;height:7px;}' +
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
