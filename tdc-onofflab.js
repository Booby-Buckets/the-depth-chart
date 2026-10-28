/* tdc-onofflab.js — the On/Off Lab (onoff-lab.html, Oct 2026, owner: "filterable … best lineup best player etc …
   more up and down, player cards"). Pick a team, a question and up to four players; filter by opponent strength,
   venue, game state, half and games; read a plain-English answer, then a vertical stat sheet or a ranked list.

   Data: scripts/data/onoff_lab/<season>/index.json + <team>.json (build_wowy.py write_lab): every five-man lineup's
   box split by game and game state, so every answer is summed in the browser.
     games[i] = [date, opponent, 'H'|'A'|'N', conference game 0/1, opponent rank by season net rating]
     rows[j]  = [lineup (indexes into ids), game index, state, seconds, own box, opponent box]
     state    = half (0 first / 1 second + OT) + 2·close-and-late + 4·(trailing 0 / tied 1 / leading 2)
   Photos only for the owner (window.tdcShowPhotos); everyone else sees initials in the team colour. */
(function () {
  var SEASONS = [[2026, '2025-26'], [2025, '2024-25'], [2024, '2023-24']];
  var MODES = [['together', 'Together or apart', 'All on vs none on'], ['each', 'One at a time', 'With him vs without'],
    ['without', 'Without them', 'Bench them all'], ['lineups', 'Best lineups', 'Top 2–5 man units'], ['players', 'Best players', 'Whole roster, ranked']];
  var FILTERS = [
    ['opp', 'Opponent', [['all', 'All'], ['t50', 'Top 50'], ['t100', 'Top 100'], ['rest', 'Outside 100']]],
    ['ven', 'Venue', [['all', 'All'], ['H', 'Home'], ['A', 'Away'], ['N', 'Neutral']]],
    ['st', 'Game state', [['all', 'All'], ['close', 'Close & late'], ['trail', 'Trailing'], ['tied', 'Tied'], ['lead', 'Leading']]],
    ['half', 'Half', [['all', 'Both'], ['1', '1st'], ['2', '2nd + OT']]],
    ['games', 'Games', [['all', 'Season'], ['l10', 'Last 10'], ['l5', 'Last 5'], ['conf', 'Conference'], ['non', 'Non-conference']]]
  ];
  var S = { season: 2026, team: null, mode: 'together', pick: [], unit: 3, sel: 0, f: { opp: 'all', ven: 'all', st: 'all', half: 'all', games: 'all' } };
  var IDX = {}, D = null, $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };

  // ── sums ──
  function blank() { return { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, orb: 0, drb: 0, tov: 0 }; }
  function add(a, arr) { D.fields.forEach(function (f, i) { a[f] += arr[i]; }); }
  function poss(b) { return Math.max(0, b.fga - b.orb + b.tov + 0.44 * b.fta); }
  function rate(o, d, s) {
    var po = poss(o), pd = poss(d), pc = function (n, x) { return x > 0 ? 100 * n / x : null; };
    return { min: s / 60, poss: (po + pd) / 2, o: pc(o.pts, po), d: pc(d.pts, pd), net: po && pd ? 100 * o.pts / po - 100 * d.pts / pd : null,
      efg: pc(o.fgm + 0.5 * o.tpm, o.fga), tov: pc(o.tov, po), orb: pc(o.orb, o.orb + d.drb), oefg: pc(d.fgm + 0.5 * d.tpm, d.fga), pm: o.pts - d.pts,
      // the rest of the player On/Off profile's box rows, so the Lab can reuse its sheet
      ts: pc(o.pts, 2 * (o.fga + 0.44 * o.fta)), fg: pc(o.fgm, o.fga), tp: pc(o.tpm, o.tpa), ftp: pc(o.ftm, o.fta), tpar: pc(o.tpa, o.fga), ftr: pc(o.fta, o.fga),
      ots: pc(d.pts, 2 * (d.fga + 0.44 * d.fta)), ofg: pc(d.fgm, d.fga), otp: pc(d.tpm, d.tpa), otpar: pc(d.tpa, d.fga), oftr: pc(d.fta, d.fga),
      otov: pc(d.tov, pd), drb: pc(o.drb, o.drb + d.orb), pace: s > 0 ? (po + pd) / 2 / (s / 60) * 40 : null };
  }
  var LIVE = [];   // the rows that pass the filters
  function filterRows() {
    var f = S.f, G = D.games, keep = {};
    var order = G.map(function (g, i) { return i; }).sort(function (a, b) { return String(G[a][0]).localeCompare(String(G[b][0])); });
    var lastN = f.games === 'l10' ? 10 : f.games === 'l5' ? 5 : 0;
    var recent = lastN ? order.slice(-lastN) : null;
    G.forEach(function (g, i) {
      var ok = true, rk = g[4];
      if (f.opp === 't50') ok = rk != null && rk <= 50; else if (f.opp === 't100') ok = rk != null && rk <= 100; else if (f.opp === 'rest') ok = rk == null || rk > 100;
      if (ok && f.ven !== 'all') ok = g[2] === f.ven;
      if (ok && f.games === 'conf') ok = g[3] === 1; else if (ok && f.games === 'non') ok = g[3] !== 1;
      if (ok && recent) ok = recent.indexOf(i) >= 0;
      if (ok) keep[i] = 1;
    });
    LIVE = D.rows.filter(function (r) {
      if (!keep[r[1]]) return false;
      var st = r[2], half = st & 1, close = (st >> 1) & 1, side = st >> 2;
      if (f.half === '1' && half !== 0) return false; if (f.half === '2' && half !== 1) return false;
      if (f.st === 'close' && !close) return false; if (f.st === 'trail' && side !== 0) return false;
      if (f.st === 'tied' && side !== 1) return false; if (f.st === 'lead' && side !== 2) return false;
      return true;
    });
    return Object.keys(keep).length;
  }
  function sum(test) { var o = blank(), d = blank(), s = 0; LIVE.forEach(function (r) { if (!test(r[0])) return; s += r[3]; add(o, r[4]); add(d, r[5]); }); return rate(o, d, s); }
  var has = function (u, i) { return u.indexOf(i) >= 0; };

  // ── format ──
  var sg = function (v, d) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d); };
  var f1 = function (v) { return v == null || !isFinite(v) ? '—' : v.toFixed(1); };
  var pn = function (v) { return v == null || !isFinite(v) ? '' : v >= 0 ? 'pos' : 'neg'; };
  var nameOf = function (i) { return D.names[i] || D.ids[i]; };
  var first = function (n) { return String(n).split(' ')[0]; }, last = function (n) { var w = String(n).split(' '); return w.slice(1).join(' ') || n; };
  var TEAM = function () { try { return (window.tdcShortSchool && tdcShortSchool(D.team)) || D.team; } catch (e) { return D.team; } };
  function tcolor() { try { var c = window.tdcTeamColor && tdcTeamColor(D.team); return (c && c.color) || '#3a4a6a'; } catch (e) { return '#3a4a6a'; } }
  function av(i, cls) {
    var n = nameOf(i), photo = window.tdcShowPhotos && window.tdcShowPhotos();
    var ini = esc((first(n)[0] || '') + (last(n)[0] || ''));
    return '<span class="ol-av ' + (cls || '') + '" style="background:' + tcolor() + '">' +
      (photo ? '<img src="https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/' + esc(D.ids[i]) + '.png" alt="" onerror="this.remove()">' : '') + '<b>' + ini + '</b></span>';
  }
  var link = function (i, txt) { return '<a href="player.html?espn=' + esc(D.ids[i]) + '&tab=onoff">' + (txt || esc(nameOf(i))) + '</a>'; };

  var faces = function (P, cls) { return '<span class="faces">' + P.map(function (i) { return av(i, cls); }).join('') + '</span>'; };
  var thin = function (r, r2) { if (r2 && r2.poss < r.poss) r = r2; return r.poss < 40 ? ' <span class="ol-thin">Small sample: ' + Math.round(r.poss) + ' possessions, read it as a hint.</span>' : ''; };

  // ── the answer: the player On/Off tab's look (With / Rank / Without / Rank / Swing / Rank, D-I percentile chips) ──
  var TOK = 0;
  function rankTable(heads, rows) {   // heads: [label, cls]; rows: html strings
    return '<table class="oo-pro ol-rank"><thead><tr><th class="lead">#</th>' +
      heads.map(function (h) { return '<th class="' + (h[1] === 'c' ? 'pc' : '') + (h[2] ? ' with' : '') + '">' + h[0] + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }
  function draw() {
    var my = ++TOK;
    var nG = filterRows(), team = sum(function () { return true; }), out = '', after = null, P = S.pick.map(function (id) { return D.ids.indexOf(id); }).filter(function (i) { return i >= 0; });
    var T = esc(TEAM()), names = function (L, j) { return L.map(function (i) { return esc(last(nameOf(i))); }).join(j || ', '); };
    var cmp = function (on, off, heads) { after = function () { return TDC_ONOFF.compare($('olCmp'), { season: S.season, team: D.team, on: on, off: off, heads: heads }); }; return '<div id="olCmp" class="ol-cmp"></div>'; };
    TDC_ONOFF.ranker(S.season).then(function (Rk) {
      if (my !== TOK) return;
      var ch = function (side, k, v) { return Rk ? Rk.chip(side, k, v) : ''; };
      if (S.mode === 'together') {
        if (!P.length) out = '<div class="ol-say">Tap up to four player cards.</div>';
        else { var all = sum(function (u) { return P.every(function (i) { return has(u, i); }); }), none = sum(function (u) { return P.every(function (i) { return !has(u, i); }); });
          out = '<div class="ol-say">' + faces(P) + 'With <b>' + names(P) + '</b> all on the floor, ' + T + ' was <b class="' + pn(all.net) + '">' + sg(all.net) + '</b> per 100 possessions. With none of them on, <b class="' + pn(none.net) + '">' + sg(none.net) + '</b>.' + thin(all, none) + '</div>' +
            cmp(all, none, ['All on', 'None on', 'Swing']); }
      } else if (S.mode === 'each' || S.mode === 'players') {
        var list = S.mode === 'players' ? D.ids.map(function (x, i) { return i; }) : P;
        var rs = list.map(function (i) { var on = sum(function (u) { return has(u, i); }), off = sum(function (u) { return !has(u, i); }); return { i: i, on: on, off: off, sw: on.net != null && off.net != null ? on.net - off.net : null }; });
        if (S.mode === 'players') {
          var minOn = Math.max(25, team.poss * 0.12), minOff = Math.max(15, team.poss * 0.06);
          rs = rs.filter(function (x) { return x.sw != null && x.on.poss >= minOn && x.off.poss >= minOff; }).sort(function (a, b) { return b.sw - a.sw; });
          out = '<div class="ol-say">Ranked by <b>swing</b>: ' + T + '’s net rating with each player on the floor minus with him on the bench.</div>' +
            (rs.length ? '<div class="ol-cmp">' + rankTable([['Min', 'n'], ['With him', 'n', 1], ['Rank', 'c'], ['Without', 'n'], ['Rank', 'c'], ['Swing', 'n'], ['Rank', 'c']], rs.map(function (x, k) {
              return '<tr><td class="k"><span class="rk">' + (k + 1) + '</span>' + av(x.i, 'sm') + link(x.i) + '</td><td>' + Math.round(x.on.min) + '</td>' +
                '<td>' + sg(x.on.net) + '</td><td class="pc">' + ch('on', 'net', x.on.net) + '</td><td>' + sg(x.off.net) + '</td><td class="pc">' + ch('off', 'net', x.off.net) + '</td>' +
                '<td class="' + (x.sw >= 0 ? 'up' : 'dn') + '">' + sg(x.sw) + '</td><td class="pc">' + ch('diff', 'net', x.sw) + '</td></tr>'; })) + '</div>'
              : '<div class="ol-say">Not enough minutes under these filters.</div>');
        } else if (!rs.length) out = '<div class="ol-say">Tap the players to look at.</div>';
        else {
          S.sel = Math.min(S.sel, rs.length - 1); var x = rs[S.sel];
          out = '<div class="ol-pick">' + rs.map(function (y, k) { return '<button class="' + (k === S.sel ? 'on' : '') + '" data-s="' + k + '">' + esc(nameOf(y.i)) + '</button>'; }).join('') + '</div>' +
            '<div class="ol-say">' + faces([x.i]) + T + ' was <b class="' + pn(x.on.net) + '">' + sg(x.on.net) + '</b> per 100 with <b>' + link(x.i) + '</b> on the floor and <b class="' + pn(x.off.net) + '">' + sg(x.off.net) + '</b> with him on the bench: a <b>' + sg(x.sw) + '</b> swing.' + thin(x.on, x.off) + '</div>' +
            cmp(x.on, x.off, ['With him', 'Without', 'Swing']);
        }
      } else if (S.mode === 'without') {
        if (!P.length) out = '<div class="ol-say">Tap the players to take off the floor.</div>';
        else { var w = sum(function (u) { return P.every(function (i) { return !has(u, i); }); }), any = sum(function (u) { return P.some(function (i) { return has(u, i); }); });
          out = '<div class="ol-say">' + faces(P, 'off') + 'With <b>' + names(P, ' and ') + '</b> all on the bench, ' + T + ' was <b class="' + pn(w.net) + '">' + sg(w.net) + '</b> per 100 over ' + Math.round(w.min) + ' minutes, against <b class="' + pn(any.net) + '">' + sg(any.net) + '</b> with any of them on.' + thin(w) + '</div>' +
            cmp(w, any, ['All benched', 'Any on', 'Swing']); }
      } else if (S.mode === 'lineups') {
        var U = {}, n = S.unit;
        LIVE.forEach(function (r) { var ids = r[0].slice().sort(function (a, b) { return a - b; }), c = [];
          (function rec(s, a) { if (a.length === n) { c.push(a.slice()); return; } for (var i = s; i < ids.length; i++) { a.push(ids[i]); rec(i + 1, a); a.pop(); } })(0, []);
          c.forEach(function (k) { if (P.length && P.length <= n && !P.every(function (i) { return has(k, i); })) return;   // more picks than seats: rank them all
            var key = k.join(','), x = U[key] || (U[key] = { k: k, o: blank(), d: blank(), s: 0 }); x.s += r[3]; add(x.o, r[4]); add(x.d, r[5]); }); });
        var base = { 2: 150, 3: 100, 4: 70, 5: 50 }[n], share = team.poss / Math.max(1, TOT.poss), minP = Math.max(15, Math.round(base * Math.min(1, share * 1.3)));
        var rows = Object.keys(U).map(function (key) { var x = U[key]; return { k: x.k, r: rate(x.o, x.d, x.s) }; }).filter(function (x) { return x.r.poss >= minP && x.r.net != null; }).sort(function (a, b) { return b.r.net - a.r.net; });
        var top = rows.slice(0, 15);
        out = '<div class="ol-pick">' + [2, 3, 4, 5].map(function (u) { return '<button class="' + (u === n ? 'on' : '') + '" data-u="' + u + '">' + u + '-man</button>'; }).join('') +
          '<span class="ol-note">' + rows.length + ' units with ' + minP + '+ possessions</span></div>' +
          '<div class="ol-say">' + T + '’s best ' + n + '-man units' + (P.length ? ' with <b>' + names(P, ' and ') + '</b>' : '') + ', by net rating.</div>' +
          (top.length ? '<div class="ol-cmp">' + rankTable([['Min', 'n'], ['ORtg', 'n'], ['Rank', 'c'], ['DRtg', 'n'], ['Rank', 'c'], ['NetRtg', 'n', 1], ['Rank', 'c']], top.map(function (x, k) {
            return '<tr><td class="k"><span class="rk">' + (k + 1) + '</span><span class="faces">' + x.k.map(function (i) { return av(i, 'sm'); }).join('') + '</span>' + '<span class="nms">' + x.k.map(function (i) { return link(i, esc(last(nameOf(i)))); }).join(' · ') + '</span></td>' +
              '<td>' + Math.round(x.r.min) + '</td><td>' + f1(x.r.o) + '</td><td class="pc">' + ch('on', 'o', x.r.o) + '</td><td>' + f1(x.r.d) + '</td><td class="pc">' + ch('on', 'd', x.r.d) + '</td>' +
              '<td class="' + (x.r.net >= 0 ? 'up' : 'dn') + '">' + sg(x.r.net) + '</td><td class="pc">' + ch('on', 'net', x.r.net) + '</td></tr>'; })) + '</div>'
            : '<div class="ol-say">No ' + n + '-man units with enough possessions' + (P.length ? ' that include everyone picked' : '') + '.</div>');
      }
      var fl = FILTERS.filter(function (F) { return S.f[F[0]] !== 'all'; }).map(function (F) { return F[2].find(function (o) { return o[0] === S.f[F[0]]; })[1]; });
      var m = MODES.find(function (z) { return z[0] === S.mode; });
      $('olOut').className = 'ol-out' + (S.mode === 'players' || S.mode === 'lineups' ? ' fit' : '');
      $('olOut').innerHTML = '<div class="ol-strip">' + m[1] + ' · ' + T + ' ' + SEASONS.find(function (x) { return x[0] === S.season; })[1] +
        '<span>' + (fl.length ? fl.join(' · ') + ' · ' : '') + nG + ' games · ' + Math.round(team.poss) + ' possessions</span></div>' + out +
        '<p class="ol-key">Each Rank chip places the number among D-I players’ on/off splits with ' + (Rk ? Rk.MIN : 500) + '+ possessions this season: green is good for the team, red is bad.</p>';
      $('olOut').querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { S.unit = +b.dataset.u; sync(); draw(); }; });
      $('olOut').querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { S.sel = +b.dataset.s; draw(); }; });
      if (after) after();
    });
  }

  // ── controls ──
  var TOT = { poss: 1 };
  function cards() {
    LIVE = D.rows; TOT = sum(function () { return true; });
    var mins = D.ids.map(function (x, i) { return sum(function (u) { return has(u, i); }).min; });
    filterRows();
    $('olCount').textContent = S.pick.length + ' of 4 picked' + (S.pick.length ? ' · ' : '');
    $('olClear').hidden = !S.pick.length;
    $('olCards').innerHTML = D.ids.map(function (id, i) { return { id: id, i: i, m: mins[i] }; }).filter(function (x) { return x.m >= 5; }).sort(function (a, b) { return b.m - a.m; }).map(function (x) {
      var j = S.pick.indexOf(x.id), n = nameOf(x.i);
      return '<button class="ol-pc' + (j >= 0 ? ' on' : '') + '" data-id="' + esc(x.id) + '" aria-pressed="' + (j >= 0) + '">' + (j >= 0 ? '<span class="tag">P' + (j + 1) + '</span>' : '') + av(x.i) +
        '<span class="fn">' + esc(first(n)) + '</span><span class="ln">' + esc(last(n)) + '</span><span class="mn">' + Math.round(x.m) + ' min</span></button>'; }).join('');
    $('olCards').querySelectorAll('.ol-pc').forEach(function (c) { c.onclick = function () { var id = c.dataset.id, j = S.pick.indexOf(id);
      if (j >= 0) S.pick.splice(j, 1); else { S.pick.push(id); if (S.pick.length > 4) S.pick.shift(); } S.sel = 0; sync(); cards(); draw(); }; });
  }
  function controls() {
    $('olModes').innerHTML = MODES.map(function (m) { return '<button data-m="' + m[0] + '" class="' + (m[0] === S.mode ? 'on' : '') + '">' + m[1] + '<small>' + m[2] + '</small></button>'; }).join('');
    $('olModes').querySelectorAll('button').forEach(function (b) { b.onclick = function () { S.mode = b.dataset.m; S.sel = 0; sync(); controls(); draw(); }; });
    $('olFilters').innerHTML = FILTERS.map(function (F) { return '<div class="ol-fr"><b>' + F[1] + '</b><span class="ui-seg">' + F[2].map(function (o) {
      return '<button data-f="' + F[0] + '" data-v="' + o[0] + '" class="' + (S.f[F[0]] === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</span></div>'; }).join('');
    $('olFilters').querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { S.f[b.dataset.f] = b.dataset.v; sync(); controls(); draw(); }; });
  }
  // the whole view rides in the URL, so any answer can be shared
  function sync() {
    try { var u = new URL(location.href), q = u.searchParams;
      q.set('team', S.team); q.set('season', S.season); q.set('q', S.mode);
      if (S.pick.length) q.set('p', S.pick.join(',')); else q.delete('p');
      if (S.mode === 'lineups') q.set('n', S.unit); else q.delete('n');
      FILTERS.forEach(function (F) { if (S.f[F[0]] !== 'all') q.set(F[0], S.f[F[0]]); else q.delete(F[0]); });
      history.replaceState(null, '', u); } catch (e) {}
  }
  function loadTeam() {
    $('olOut').innerHTML = '<div class="ol-say">Loading ' + esc(S.team) + '…</div>';
    return get('scripts/data/onoff_lab/' + S.season + '/' + S.team + '.json?v=1').then(function (j) {
      if (!j) { $('olOut').innerHTML = '<div class="ol-say">No lineup data for this team and season.</div>'; $('olCards').innerHTML = ''; return; }
      D = j; S.pick = S.pick.filter(function (id) { return D.ids.indexOf(id) >= 0; });
      if (!S.pick.length && S.mode !== 'players' && S.mode !== 'lineups') {   // a starting answer: the two biggest-minute players
        LIVE = D.rows; S.pick = D.ids.map(function (id, i) { return { id: id, m: sum(function (u) { return has(u, i); }).min }; }).sort(function (a, b) { return b.m - a.m; }).slice(0, 2).map(function (x) { return x.id; }); }
      sync(); cards(); draw();
    });
  }
  function teams() {
    return (IDX[S.season] ? Promise.resolve(IDX[S.season]) : get('scripts/data/onoff_lab/' + S.season + '/index.json?v=1').then(function (j) { return (IDX[S.season] = j || []); })).then(function (L) {
      var short = function (t) { try { return (window.tdcShortSchool && tdcShortSchool(t[1])) || t[1]; } catch (e) { return t[1]; } };
      L = L.slice().sort(function (a, b) { return short(a).localeCompare(short(b)); });
      if (!L.some(function (t) { return t[0] === S.team; })) S.team = (L.find(function (t) { return t[0] === 'kentucky-wildcats'; }) || L[0] || [])[0];
      $('olTeam').innerHTML = L.map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === S.team ? ' selected' : '') + '>' + esc(short(t)) + '</option>'; }).join('');
    });
  }
  function init() {
    var q = new URLSearchParams(location.search);
    S.team = q.get('team') || null; if (q.get('season')) S.season = +q.get('season');
    if (q.get('q') && MODES.some(function (m) { return m[0] === q.get('q'); })) S.mode = q.get('q');
    if (q.get('p')) S.pick = q.get('p').split(',').filter(Boolean).slice(0, 4);
    if (q.get('n')) S.unit = Math.max(2, Math.min(5, +q.get('n') || 3));
    FILTERS.forEach(function (F) { var v = q.get(F[0]); if (v && F[2].some(function (o) { return o[0] === v; })) S.f[F[0]] = v; });
    $('olSeason').innerHTML = SEASONS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === S.season ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('');
    $('olSeason').onchange = function () { S.season = +this.value; teams().then(loadTeam); };
    $('olTeam').onchange = function () { S.team = this.value; S.pick = []; S.sel = 0; loadTeam(); };
    $('olClear').onclick = function () { S.pick = []; sync(); cards(); draw(); };
    controls(); teams().then(loadTeam);
  }
  window.TDC_ONOFFLAB = { init: init };
})();
