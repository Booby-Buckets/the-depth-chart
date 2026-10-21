/* tdc-recap.js — the game page's "Why it went the way it went": our own read of a final game, from ESPN's
 * play-by-play run through the Skill Fingerprint credit model (tdc-credit.js) and our win-probability model
 * (tdc-plays.js). Three answers, nobody else's numbers:
 *   1. where the edge came from — the two teams skill by skill (points added vs an average possession)
 *   2. above and below their usual — each player's night against what his season fingerprint says he adds over
 *      the same number of possessions
 *   3. the swing — the stretch (6 minutes or less) that moved the winner's win chance most, and who drove it
 *   TDC_RECAP.mount(host, gameId, {season})       (season = the game's season_year)
 *   TDC_RECAP.build(summary, docs)  -> the recap object (also used by the Social Studio post)
 */
(function (g) {
  var ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sgn = function (v, d) { v = +v; return (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d); };
  var clk = function (s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
  var SK = {}; (window.TDC_CREDIT ? TDC_CREDIT.SKILLS : []).forEach(function (s) { SK[s[0]] = s; });
  var PLAIN = { rim: 'finishing at the rim', put: 'putbacks', mid: 'mid-range shooting', three: 'three-point shooting', ft: 'free-throw shooting',
    self: 'shot creation', pass: 'passing', drawn: 'drawing fouls', tov: 'taking care of the ball', oreb: 'offensive rebounding',
    dreb: 'defensive rebounding', stl: 'steals', blk: 'shot blocking', foul: 'avoiding fouls', team: 'team defense' };

  function build(s, docs) {
    var fp = docs.fp, C = TDC_CREDIT.game(s, { B: fp.B, league: fp.league });
    if (!C) return null;
    var comp = s.header.competitions[0], cs = comp.competitors;
    var info = {}; cs.forEach(function (c) { info[String(c.id)] = { name: (c.team || {}).shortDisplayName || (c.team || {}).location || (c.team || {}).displayName, full: (c.team || {}).displayName, score: +c.score || 0, ha: c.homeAway }; });
    var W = C.teams.slice().sort(function (a, b) { return info[b].score - info[a].score; }), win = W[0], los = W[1];
    // 1. skills: each team's offense skills against the other's, and the same for defense
    var val = function (t, k) { var sd = C.side[t]; return SK[k] && TDC_CREDIT.OFF[k] ? (sd.off[k] || 0) : (sd.def[k] || 0); };
    var skills = TDC_CREDIT.SKILLS.map(function (sk) { var a = val(win, sk[0]), b = val(los, sk[0]); return { k: sk[0], label: sk[1], group: sk[2], w: a, l: b, edge: a - b }; })
      .sort(function (a, b) { return Math.abs(b.edge) - Math.abs(a.edge); });
    // 2. players against their usual (the season fingerprint: total per 100 x tonight's possessions)
    var prev = docs.prev || fp;
    var pl = Object.keys(C.players).map(function (pid) {
      var q = C.players[pid], r = prev.players[pid] || fp.players[pid], usual = r ? r.tot * q.poss / 100 : null;
      return { pid: pid, name: C.names[pid], t: q.t, min: q.min, tot: q.tot, usual: usual, vs: usual == null ? null : q.tot - usual, sk: q.sk };
    }).filter(function (x) { return x.min > 0; });
    // 3. the swing: the winner's biggest win-probability gain inside six minutes of game time
    var swing = null;
    if (window.TDC_PLAYS) {
      var R = TDC_PLAYS.parseGame(s, {}).rows, wp = R.map(function (r) { return r.team === win ? r.wp : 1 - r.wp; });
      var best = 0, bi = -1, bj = -1;
      for (var i = 1; i < R.length; i++) for (var j = i; j < R.length && R[i].secs - R[j].secs <= 360; j++) {
        var gain = wp[j] - wp[i - 1]; if (gain > best) { best = gain; bi = i; bj = j; }
      }
      if (bi > 0 && best >= 0.15) {
        var seqs = {}; for (var k = bi; k <= bj; k++) seqs[R[k].seq] = 1;
        var wh = info[win].ha === 'home', a0 = R[bi - 1], a1 = R[bj];
        var ws = function (r) { return wh ? r.hs : r.as; }, ls = function (r) { return wh ? r.as : r.hs; };
        var cr = {}; TDC_CREDIT.tally(TDC_CREDIT.parse(s).plays, C.teams, fp.league).rows.forEach(function (r) {
          if (!seqs[r[6]] || !r[1] || r[2][0] === '_') return;
          var v = r[3] + r[4] * fp.B, side = r[5] ? (r[0] === win ? los : win) : r[0];
          if (side === win) cr[r[1]] = (cr[r[1]] || 0) + v;
        });
        var who = Object.keys(cr).sort(function (a, b) { return cr[b] - cr[a]; }).slice(0, 2).filter(function (p) { return cr[p] > 0.5; });
        swing = { run: [ws(a1) - ws(a0), ls(a1) - ls(a0)], from: wp[bi - 1], to: wp[bj], per0: R[bi].per, per1: R[bj].per, t0: R[bi].secs, t1: R[bj].secs,
          who: who.map(function (p) { return { name: C.names[p], v: cr[p] }; }) };
      }
    }
    return { C: C, info: info, win: win, los: los, skills: skills, players: pl, swing: swing };
  }
  var art = function (n) { return /^(8|11|18)(\D|$)/.test(String(n)) || /^8/.test(String(n)) ? 'an' : 'a'; };
  var perLbl = function (p) { return p === 1 ? '1st half' : p === 2 ? '2nd half' : 'overtime'; };
  var periodClock = function (per, secsLeftGame) { var left = per <= 2 ? secsLeftGame - (2 - per) * 1200 : secsLeftGame; return clk(left); };
  function lead(R) {
    var W = R.info[R.win].name, Lz = R.info[R.los].name, top = R.skills.filter(function (x) { return x.edge > 0; }).slice(0, 2);
    var s = '<b>' + esc(W) + '</b> won it on ' + top.map(function (x) { return PLAIN[x.k] + ' (' + sgn(x.edge) + ')'; }).join(' and ') + '.';
    var lost = R.skills.filter(function (x) { return x.edge < -1.5; })[0];
    if (lost) s += ' ' + esc(Lz) + ' had the better of ' + PLAIN[lost.k] + ' (' + sgn(-lost.edge) + ').';
    var b = R.players.filter(function (x) { return x.vs != null; }).sort(function (a, b) { return b.vs - a.vs; })[0];
    if (b && b.vs >= 3) s += ' <b>' + esc(b.name) + '</b> added ' + sgn(b.vs) + ' over his usual.';
    if (R.swing) s += ' The swing: ' + art(R.swing.run[0]) + ' ' + R.swing.run[0] + '-' + R.swing.run[1] + ' run took ' + esc(W) + ' from ' + Math.round(100 * R.swing.from) + '% to ' + Math.round(100 * R.swing.to) + '%.';
    return s;
  }
  function html(R) {
    var W = R.info[R.win], Lz = R.info[R.los];
    var edges = R.skills.slice(0, 7).map(function (x) {
      return '<tr><td class="l">' + esc(x.label) + '</td><td class="l dim rc-x">' + esc(x.group) + '</td><td>' + sgn(x.w) + '</td><td>' + sgn(x.l) + '</td><td class="' + (x.edge >= 3 ? 'c4' : x.edge >= 1 ? 'c3' : x.edge <= -3 ? 'c0' : x.edge <= -1 ? 'c1' : '') + '"><b>' + sgn(x.edge) + '</b></td></tr>';
    }).join('');
    var ps = R.players.filter(function (x) { return x.vs != null && x.min >= 8; }).sort(function (a, b) { return b.vs - a.vs; });
    var show = ps.slice(0, 5).concat(ps.length > 8 ? ps.slice(-3) : []);
    var prow = function (x) {
      var best = Object.keys(x.sk).sort(function (a, b) { return Math.abs(x.sk[b]) - Math.abs(x.sk[a]); })[0];
      return '<tr><td class="l"><b>' + esc(x.name) + '</b></td><td class="l dim">' + esc(R.info[x.t].name) + '</td><td>' + Math.round(x.min) + '</td><td>' + sgn(x.tot) + '</td><td class="dim">' + sgn(x.usual) + '</td>' +
        '<td class="' + (x.vs >= 4 ? 'c4' : x.vs >= 1.5 ? 'c3' : x.vs <= -4 ? 'c0' : x.vs <= -1.5 ? 'c1' : '') + '"><b>' + sgn(x.vs) + '</b></td><td class="l dim">' + (best && SK[best] ? SK[best][1] + ' ' + sgn(x.sk[best]) : '') + '</td></tr>';
    };
    var sw = R.swing ? '<div class="rc-swing"><span class="rc-k">The swing</span> ' + esc(W.name) + ' went on ' + art(R.swing.run[0]) + ' <b>' + R.swing.run[0] + '-' + R.swing.run[1] + ' run</b> from ' +
      (R.swing.per0 === R.swing.per1 ? periodClock(R.swing.per0, R.swing.t0) + ' to ' + periodClock(R.swing.per0, R.swing.t1) + ' of the ' + perLbl(R.swing.per0)
        : periodClock(R.swing.per0, R.swing.t0) + ' of the ' + perLbl(R.swing.per0) + ' to ' + periodClock(R.swing.per1, R.swing.t1) + (R.swing.per1 > 2 ? ' of overtime' : ' of the ' + perLbl(R.swing.per1))) + ', moving its win chance from <b>' + Math.round(100 * R.swing.from) + '%</b> to <b>' + Math.round(100 * R.swing.to) + '%</b>' +
      (R.swing.who.length ? '. Most of the credit: ' + R.swing.who.map(function (w) { return esc(w.name) + ' (' + sgn(w.v) + ')'; }).join(', ') : '') + '.</div>' : '';
    return '<div class="rc"><div class="rc-h">Why it went the way it went</div><p class="gm-read">' + lead(R) + '</p>' + sw +
      '<div class="rc-grid"><div><div class="rc-sub">Where the edge came from</div><div class="sheet-wrap" style="max-height:none"><table class="sheet dense"><thead><tr><th class="l">Skill</th><th class="l rc-x">Group</th><th>' + esc(W.name) + '</th><th>' + esc(Lz.name) + '</th><th title="Points added by the winner minus the loser">Edge</th></tr></thead><tbody>' + edges + '</tbody></table></div></div>' +
      '<div><div class="rc-sub">Above and below their usual</div><div class="sheet-wrap" style="max-height:none"><table class="sheet dense"><thead><tr><th class="l">Player</th><th class="l">Team</th><th class="rc-x">Min</th><th title="Points he added tonight vs an average possession">Added</th><th title="What his season fingerprint says he adds in this many possessions">Usual</th><th>vs usual</th><th class="l rc-x">Biggest skill</th></tr></thead><tbody>' + show.map(prow).join('') + '</tbody></table></div></div></div></div>';
  }
  var CSS = '.rc{margin:22px 0 8px}.rc-h{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:20px;margin-bottom:4px}' +
    '.rc-sub{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin:14px 0 6px}' +
    '.rc-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:18px}@media(max-width:900px){.rc-grid{grid-template-columns:minmax(0,1fr)}}' +
    '.rc-swing{font-size:13px;color:var(--text2);line-height:1.5;margin:8px 0 0;padding:8px 12px;border-left:3px solid var(--accent,#A8843C);background:var(--bg2)}.rc-swing b{color:var(--text)}' +
    '@media(max-width:700px){.rc .rc-x{display:none}}' +
    '.rc-k{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent,#A8843C);margin-right:6px}';
  function docsFor(season) {
    var y = Math.min(+season || 2026, 2026), L = window.TDCFingerprint;
    if (!L) return Promise.resolve(null);
    return Promise.all([L.load(y), L.load(+season >= 2027 ? 2026 : y)]).then(function (x) { return x[0] ? { fp: x[0], prev: x[1] || x[0] } : null; });
  }
  function mount(host, gid, opt) {
    opt = opt || {};
    if (!document.getElementById('rc-css')) { var st = document.createElement('style'); st.id = 'rc-css'; st.textContent = CSS; document.head.appendChild(st); }
    return Promise.all([fetch(ESPN + encodeURIComponent(gid)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }), docsFor(opt.season)])
      .then(function (x) {
        var s = x[0], docs = x[1];
        if (!s || !(s.plays || []).length || !docs) { host.innerHTML = ''; return null; }
        var R = build(s, docs); if (!R) { host.innerHTML = ''; return null; }
        host.innerHTML = html(R);
        return R;
      }).catch(function (e) { console.warn('recap', e); host.innerHTML = ''; return null; });
  }
  g.TDC_RECAP = { mount: mount, build: build, lead: lead, docsFor: docsFor, ESPN: ESPN };
})(window);
