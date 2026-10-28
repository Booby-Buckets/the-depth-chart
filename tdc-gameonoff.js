/* tdc-gameonoff.js — one game's on/off, from the play-by-play (Oct 2026, owner: "build on/off stats into the
   game recaps"). Re-walks the game with tdc-gameflow's crunch() and its per-play hook (G.onPlay: the play, who is
   on the floor, the score before it), crediting every play to the ten players on the floor. Each player then has
   the team's box with him on and (team total minus that) with him off.

   TDC_GAMEONOFF.build(G)          → {teams:{tid:{players:[...], total}}}
   TDC_GAMEONOFF.render(el, G, R)  draws a panel per team (TDCGameTabs.panel) into el

   Per player: minutes, +/-, net / offensive / defensive rating per 100 with him on and off, the swing, and why
   (the four-factor swings: eFG%, turnover %, offensive rebound %, FT rate). One game is a small sample: the
   off-court side of a 35-minute starter is a few possessions, so those rows are faded and never shaded. */
(function () {
  if (window.TDC_GAMEONOFF) return;
  var F = ['pts', 'fga', 'fgm', 'tpa', 'tpm', 'fta', 'ftm', 'orb', 'drb', 'tov', 'secs'];
  var blank = function () { var b = {}; F.forEach(function (f) { b[f] = 0; }); return b; };
  var add = function (a, b, k) { F.forEach(function (f) { a[f] += (b[f] || 0) * (k == null ? 1 : k); }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var poss = function (b) { return Math.max(0, b.fga - b.orb + b.tov + 0.44 * b.fta); };
  var MIN_OFF = 12;   // possessions without him before the off-court side means anything in one game

  function build(G) {
    if (!G || !window.TDC_GAMEFLOW) return null;
    var H = G.home, A = G.away, on = null, lastE = 0;
    var tot = {}; tot[H] = { o: blank(), d: blank() }; tot[A] = { o: blank(), d: blank() };
    var acc = {};   // id → {o, d}: his team's box and the opponent's while he was on
    var credit = function (tid, k, v) {
      var opp = tid === H ? A : H; v = v == null ? 1 : v;
      tot[tid].o[k] += v; tot[opp].d[k] += v;
      if (!on) return;
      Object.keys(on[tid] || {}).forEach(function (id) { (acc[id] = acc[id] || { o: blank(), d: blank() }).o[k] += v; });
      Object.keys(on[opp] || {}).forEach(function (id) { (acc[id] = acc[id] || { o: blank(), d: blank() }).d[k] += v; });
    };
    var g = Object.create(G);
    g.onPlay = function (p, onNow, e, prevH, prevA) {
      on = onNow;
      // the time since the last play belongs to who is on the floor now (subs are applied before the hook)
      var dt = e - lastE; if (dt > 0) credit(H, 'secs', dt);   // one call: H's players get o.secs, A's get d.secs
      lastE = Math.max(lastE, e);
      var dh = (+p.homeScore || 0) - prevH, da = (+p.awayScore || 0) - prevA;
      if (dh > 0) credit(H, 'pts', dh);
      if (da > 0) credit(A, 'pts', da);
      var tid = p.team && p.team.id, tt = (p.type && p.type.text) || '';
      if (tid !== H && tid !== A) return;
      if (p.shootingPlay) {
        if (/FreeThrow/i.test(tt)) { credit(tid, 'fta'); if (p.scoringPlay) credit(tid, 'ftm'); }
        else { var three = p.pointsAttempted === 3 || /three point/i.test(p.text || '');
          credit(tid, 'fga'); if (three) credit(tid, 'tpa');
          if (p.scoringPlay) { credit(tid, 'fgm'); if (three) credit(tid, 'tpm'); } }
      }
      if (tt === 'Offensive Rebound') credit(tid, 'orb');
      else if (tt === 'Defensive Rebound') credit(tid, 'drb');
      else if (/Turnover/i.test(tt)) credit(tid, 'tov');
    };
    TDC_GAMEFLOW.crunch(g);
    // floor time was credited once (as H's offense): give every box both sides of it
    tot[A].o.secs = tot[H].o.secs; tot[A].d.secs = tot[H].o.secs; tot[H].d.secs = tot[H].o.secs;
    Object.keys(acc).forEach(function (id) { var a = acc[id]; a.o.secs = a.d.secs = Math.max(a.o.secs, a.d.secs); });

    var rates = function (o, d) {
      var po = poss(o), pd = poss(d), pc = function (n, den) { return den > 0 ? 100 * n / den : null; };
      return { min: o.secs / 60, pm: o.pts - d.pts, poss: (po + pd) / 2,
        o: pc(o.pts, po), d: pc(d.pts, pd), net: po > 0 && pd > 0 ? 100 * o.pts / po - 100 * d.pts / pd : null,
        efg: pc(o.fgm + 0.5 * o.tpm, o.fga), tov: pc(o.tov, po), orb: pc(o.orb, o.orb + d.drb), ftr: pc(o.fta, o.fga),
        oefg: pc(d.fgm + 0.5 * d.tpm, d.fga), otov: pc(d.tov, pd), drb: pc(o.drb, o.drb + d.orb) };
    };
    var out = { teams: {} };
    [H, A].forEach(function (t) {
      var players = Object.keys(G.P).filter(function (id) { return G.P[id].team === t && acc[id] && acc[id].o.secs >= 60; }).map(function (id) {
        var a = acc[id], fo = blank(), fd = blank();
        add(fo, tot[t].o); add(fo, a.o, -1); add(fd, tot[t].d); add(fd, a.d, -1);
        var on_ = rates(a.o, a.d), off = rates(fo, fd);
        return { id: id, name: G.P[id].name, starter: G.P[id].starter, on: on_, off: off,
          swing: on_.net != null && off.net != null && off.poss >= MIN_OFF ? on_.net - off.net : null };
      });
      players.sort(function (x, y) { return y.on.min - x.on.min; });
      out.teams[t] = { players: players, total: rates(tot[t].o, tot[t].d) };
    });
    return out;
  }

  var sg = function (v, d) { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d); };
  var f1 = function (v) { return v == null ? '—' : v.toFixed(1); };
  // the swing's shading: same 5 steps as the sheets kit
  var heat = function (v) { return v == null ? '' : v >= 20 ? 'c4' : v >= 7 ? 'c3' : v <= -20 ? 'c0' : v <= -7 ? 'c1' : 'c2'; };
  var tone = function (v, dir) { return v == null || Math.abs(v) < 0.5 ? '' : (v * dir > 0 ? 'up' : 'dn'); };

  function css() {
    if (document.getElementById('tdc-gameonoff-css')) return;
    var s = document.createElement('style'); s.id = 'tdc-gameonoff-css';
    s.textContent =
      '.go-best{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:14px 0 18px;border:1px solid var(--border);border-radius:12px;background:var(--bg);overflow:hidden;}' +
      '.go-best>div{padding:14px 18px;border-left:1px solid var(--border);min-width:0;}.go-best>div:first-child{border-left:0;}' +
      '.go-best .k{font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);}' +
      '.go-best .v{font-family:"Playfair Display",Georgia,serif;font-size:28px;font-weight:800;line-height:1.1;margin-top:6px;}' +
      '.go-best .s{font-size:12.5px;color:var(--text2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.go-best .s a{color:var(--text);font-weight:700;text-decoration:none;}.go-best .s a:hover{color:var(--accent);}' +
      '.go-best .s img{width:16px;height:16px;object-fit:contain;vertical-align:-3px;margin-right:5px;}' +
      '.go-tbl{width:100%;}.go-tbl td,.go-tbl th{text-align:right;white-space:nowrap;}.go-tbl td.l,.go-tbl th.l{text-align:left;}' +
      '.go-tbl td.l a{color:var(--text);font-weight:700;text-decoration:none;}.go-tbl td.l a:hover{text-decoration:underline;}' +
      '.go-tbl th.gs,.go-tbl td.gs{border-left:2px solid var(--border2)!important;}' +
      '.go-tbl td.up{color:var(--green,#1f8a45);font-weight:700;}.go-tbl td.dn{color:var(--red,#c0392b);font-weight:700;}' +
      '.go-tbl td.sw{font-weight:800;}' +
      '.go-tbl tr.thin td{opacity:.55;}' +
      '.go-tbl tr.tot td{font-weight:800;border-top:2px solid var(--border2);}' +
      '.go-tbl tr.grp th{font-size:9.5px;letter-spacing:.12em;color:var(--text3);border-bottom:0;padding-bottom:0;}' +
      '@media(max-width:900px){.go-best{grid-template-columns:repeat(2,minmax(0,1fr));}.go-best>div:nth-child(3){border-left:0;}.go-best>div:nth-child(n+3){border-top:1px solid var(--border);}}';
    document.head.appendChild(s);
  }

  function render(el, G, R, opts) {
    css(); opts = opts || {};
    var D = build(G);
    if (!D) { el.innerHTML = '<div class="loading">No play-by-play lineups for this game.</div>'; return; }
    var href = function (id) { return G.href ? G.href(id) : 'player.html?espn=' + id; };
    var link = function (p) { var h = href(p.id); return h ? '<a href="' + esc(h) + '">' + esc(p.name) + '</a>' : esc(p.name); };
    var logo = function (t) { var x = G.T[t]; return x && x.logo ? '<img src="' + esc(x.logo) + '" alt="">' : ''; };
    var nm = function (t) { return esc((G.T[t] && G.T[t].name) || ''); };
    var order = [G.away, G.home];

    // the four standouts: biggest swing each way, best defensive swing, most +/-
    var all = []; order.forEach(function (t) { D.teams[t].players.forEach(function (p) { p.t = t; all.push(p); }); });
    var real = all.filter(function (p) { return p.swing != null && p.on.poss >= 15; });
    var pick = function (arr, f) { return arr.slice().sort(function (a, b) { return f(b) - f(a); })[0]; };
    var best = pick(real, function (p) { return p.swing; }), worst = pick(real, function (p) { return -p.swing; });
    var dfn = pick(real, function (p) { return p.off.d - p.on.d; }), pm = pick(all, function (p) { return p.on.pm; });
    var tile = function (k, p, v) { return p ? '<div><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + logo(p.t) + link(p) + '</div></div>' : ''; };
    var tiles = '<div class="go-best">' +
      tile('Biggest lift', best, best && sg(best.swing)) +
      tile('Best defensive lift', dfn, dfn && sg(dfn.off.d - dfn.on.d)) +
      tile('Best +/-', pm, pm && sg(pm.on.pm, 0)) +
      tile('Biggest drop', worst, worst && sg(worst.swing)) + '</div>';

    var head = '<thead><tr class="grp"><th class="l"></th><th></th><th></th><th class="gs" colspan="3">Per 100 possessions</th><th class="gs" colspan="4">Why · with him minus without</th></tr>' +
      '<tr><th class="l">Player</th><th>Min</th><th title="Score margin while he was on the floor">+/−</th>' +
      '<th class="gs" title="Net rating with him on the floor">With him</th><th title="Net rating with him on the bench">Without</th><th title="With him minus without him">Swing</th>' +
      '<th class="gs" title="Effective FG% swing">eFG%</th><th title="Turnover % swing (lower is better)">TO%</th><th title="Offensive rebound % swing">OREB%</th><th title="Opponent eFG% swing (lower is better)">Opp eFG%</th></tr></thead>';
    var row = function (p) {
      var thin = p.swing == null, small = thin || p.on.poss < 15, d = function (k) { return p.on[k] != null && p.off[k] != null && !thin ? p.on[k] - p.off[k] : null; };
      return '<tr class="' + (small ? 'thin' : '') + '"' + (thin ? ' title="Barely sat: too few possessions without him to compare"' : small ? ' title="Short minutes: too few possessions with him to read much into"' : '') + '>' +
        '<td class="l">' + link(p) + (p.starter ? ' <span class="dim">*</span>' : '') + '</td><td>' + Math.round(p.on.min) + '</td>' +
        '<td class="' + tone(p.on.pm, 1) + '">' + sg(p.on.pm, 0) + '</td>' +
        '<td class="gs">' + sg(p.on.net) + '</td><td>' + (thin ? '—' : sg(p.off.net)) + '</td><td class="sw ' + (small ? '' : heat(p.swing)) + '">' + sg(p.swing) + '</td>' +
        '<td class="gs ' + tone(d('efg'), 1) + '">' + sg(d('efg')) + '</td><td class="' + tone(d('tov'), -1) + '">' + sg(d('tov')) + '</td>' +
        '<td class="' + tone(d('orb'), 1) + '">' + sg(d('orb')) + '</td><td class="' + tone(d('oefg'), -1) + '">' + sg(d('oefg')) + '</td></tr>';
    };
    var team = function (t) {
      var T = D.teams[t], x = T.total;
      var body = '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense go-tbl">' + head + '<tbody>' + T.players.map(row).join('') +
        '<tr class="tot"><td class="l">Team</td><td>' + Math.round(x.min) + '</td><td class="' + tone(x.pm, 1) + '">' + sg(x.pm, 0) + '</td><td class="gs">' + sg(x.net) + '</td><td></td><td></td>' +
        '<td class="gs">' + f1(x.efg) + '</td><td>' + f1(x.tov) + '</td><td>' + f1(x.orb) + '</td><td>' + f1(x.oefg) + '</td></tr></tbody></table></div>';
      var tools = '<span class="gt-tools">' + Math.round(x.poss) + ' possessions · * started</span>';
      return window.TDCGameTabs && TDCGameTabs.panel ? TDCGameTabs.panel(logo(t).replace('<img', '<img style="width:20px;height:20px;object-fit:contain;vertical-align:-5px;margin-right:8px"') + nm(t) + ' on/off', body, tools)
        : '<h3>' + nm(t) + '</h3>' + body;
    };
    el.innerHTML = tiles + order.map(team).join('') +
      '<details class="ui-about"><summary>How this works</summary><p>Rebuilt from the play-by-play substitutions: every play is credited to the ten players on the floor. ' +
      '“With him” is the team’s net rating (points scored minus allowed per 100 possessions) while he played, “Without” while he sat, and Swing is the gap. ' +
      'The four columns on the right show where the swing came from. One game is a small sample: rows for players who barely sat or barely played are faded and left unshaded.</p></details>';
  }

  window.TDC_GAMEONOFF = { build: build, render: render };
})();
