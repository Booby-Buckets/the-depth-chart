/* tdc-onofflab.js — the On/Off Lab (onoff-lab.html, Oct 2026, owner: "filterable … best lineup best player etc …
   more up and down, player cards"). Pick a team, a question and up to four players; filter by opponent strength,
   venue, game state, half and games; read a plain-English answer, then a vertical stat sheet or a ranked list.

   Data: scripts/data/onoff_lab/<season>/index.json + <team>.json (build_wowy.py write_lab): every five-man lineup's
   box split by game and game state, so every answer is summed in the browser.
     games[i] = [date, opponent, 'H'|'A'|'N', conference game 0/1, opponent rank by season net rating]
     rows[j]  = [lineup (indexes into ids), game index, state, seconds, own box, opponent box]
     state    = half (0 first / 1 second + OT) + 2·close-and-late + 4·(trailing 0 / tied 1 / leading 2)
   Photos only for the owner (window.tdcShowPhotos); everyone else sees initials in the team colour.

   TDC_ONOFFLAB.mount(host, opts) puts a Lab anywhere (the team page On/Off + Lineups tabs, Oct 30 2026):
     team: lab slug ('duke-blue-devils') or full ESPN name · season · lockTeam (no team picker) · url (keep the view
     in the address bar, the Lab page only) · modes: subset of question keys · mode: starting question · seasons */
(function () {
  var SEASONS = [[2026, '2025-26'], [2025, '2024-25'], [2024, '2023-24']];
  var MODES = [['combos', 'WOWY combos', 'Every on/off mix'], ['together', 'Together or apart', 'All on vs none on'], ['each', 'One at a time', 'With him vs without'],
    ['without', 'Without them', 'Bench them all'], ['lineups', 'Best lineups', 'Top 2–5 man units'], ['players', 'Best players', 'Whole roster, ranked']];
  var FILTERS = [
    ['opp', 'Opponent', [['all', 'All'], ['t50', 'Top 50'], ['t100', 'Top 100'], ['rest', 'Outside 100']]],
    ['ven', 'Venue', [['all', 'All'], ['H', 'Home'], ['A', 'Away'], ['N', 'Neutral']]],
    ['st', 'Game state', [['all', 'All'], ['close', 'Close & late'], ['trail', 'Trailing'], ['tied', 'Tied'], ['lead', 'Leading']]],
    ['half', 'Half', [['all', 'Both'], ['1', '1st'], ['2', '2nd + OT']]],
    ['games', 'Games', [['all', 'Season'], ['l10', 'Last 10'], ['l5', 'Last 5'], ['conf', 'Conference'], ['non', 'Non-conference']]]
  ];
  var IDX = {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
  var slugOf = function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };

  // the Lab's look (was inline in onoff-lab.html) — injected once, so any page can mount a Lab
  var CSS = [
    ":root{--ol-pos:#1f8a45;--ol-neg:#c0392b;--ol-gold:#d9a91a;}",
    ".ol-step{margin:0 0 20px;}",
    ".ol-lbl{font:800 10.5px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);margin:0 0 8px;display:flex;justify-content:space-between;align-items:center;gap:8px;}",
    ".ol-lbl span{font-weight:600;letter-spacing:0;text-transform:none;}",
    ".ol-lbl button{background:none;border:0;color:var(--accent);font:700 12px Inter,system-ui,sans-serif;cursor:pointer;padding:0;}",
    ".ol-row{display:flex;gap:8px;flex-wrap:wrap;}",
    ".ol-q{display:grid;grid-template-columns:repeat(var(--olq,5),1fr);gap:8px;}",
    ".ol-q button{border:1px solid var(--border2);background:var(--bg);border-radius:10px;padding:10px 12px;text-align:left;cursor:pointer;font:700 13px Inter,system-ui,sans-serif;color:var(--text);}",
    ".ol-q button small{display:block;font-weight:500;font-size:11.5px;color:var(--text3);margin-top:3px;}",
    ".ol-q button.on{background:var(--text);color:var(--bg);border-color:var(--text);}.ol-q button.on small{color:var(--bg);opacity:.7;}",
    ".ol-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;}",
    ".ol-pc{position:relative;display:flex;flex-direction:column;align-items:center;border:1px solid var(--border);background:var(--bg);border-radius:12px;padding:12px 6px 10px;cursor:pointer;font-family:inherit;color:var(--text);}",
    ".ol-pc:hover{border-color:var(--border2);}",
    ".ol-pc.on{border:2px solid var(--ol-gold);padding:11px 5px 9px;background:color-mix(in srgb,var(--ol-gold) 9%,var(--bg));}",
    ".ol-pc .tag{position:absolute;top:6px;right:6px;background:var(--ol-gold);color:#1b1a17;font:800 10px Inter,system-ui,sans-serif;border-radius:4px;padding:1px 5px;}",
    ".ol-pc .fn{font-size:11px;color:var(--text3);line-height:1.2;}.ol-pc .ln{font-size:13px;font-weight:800;line-height:1.2;}",
    ".ol-pc .mn{font-size:10.5px;color:var(--text3);margin-top:3px;}",
    ".ol-av{position:relative;width:54px;height:54px;margin:0 0 7px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font:800 16px Inter,system-ui,sans-serif;overflow:hidden;flex:none;}",
    ".ol-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}",
    ".ol-av.off{filter:grayscale(1);opacity:.45;}",
    ".ol-fl{display:flex;flex-direction:column;gap:6px;}",
    ".ol-fr{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
    ".ol-fr b{font:800 10px Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);width:92px;}",
    ".ol-fr .ui-seg button{font-size:10.5px;padding:5px 10px;}",
    ".ol-out{background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin:24px 0 0;}",
    ".ol-out{max-width:1060px;}.ol-out.fit{width:fit-content;min-width:min(100%,560px);}.ol-out.fit .ol-say,.ol-out.fit .ol-key{width:0;min-width:100%;box-sizing:border-box;}.ol-cmp .oo-pro col.n{width:14.5%;}",
    ".ol-strip{background:#1b1a17;color:#fff;padding:12px 16px;font:800 12px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
    ".ol-strip span{font-weight:600;letter-spacing:0;text-transform:none;opacity:.7;}",
    ".ol-say{padding:16px 20px;font-size:16px;line-height:1.55;color:var(--text2);border-bottom:1px solid var(--border);}",
    ".ol-say b{color:var(--text);}.ol-say a{color:var(--text);text-decoration:none;}.ol-say a:hover{text-decoration:underline;}",
    ".ol-thin{display:block;margin-top:6px;font-size:12.5px;color:var(--accent);font-weight:600;}",
    ".ol-out .pos{color:var(--ol-pos)!important;}.ol-out .neg{color:var(--ol-neg)!important;}",
    ".ol-say .faces{display:inline-flex;vertical-align:middle;margin-right:10px;}.ol-say .faces .ol-av{width:30px;height:30px;font-size:10px;margin:0 -6px 0 0;border:2px solid var(--bg);}",
    ".faces{display:inline-flex;}",
    ".ol-cmp{padding:16px 20px 6px;}",
    ".ol-cmp .oo-wide .ui-tiles{grid-template-columns:repeat(4,1fr);}",
    ".ol-rank.oo-pro{table-layout:auto;width:auto;}.ol-rank.oo-pro td,.ol-rank.oo-pro th{padding-left:10px;padding-right:10px;}.ol-rank.oo-pro th.pc,.ol-rank.oo-pro td.pc{padding-left:2px;padding-right:14px;}",
    ".ol-rank td.k{padding-right:28px !important;}",
    ".ol-rank td.k>*{vertical-align:middle;}.ol-rank td.k>.ol-av,.ol-rank td.k>.faces{margin-right:8px;}.ol-rank td.k a{color:var(--text);font-weight:700;text-decoration:none;}.ol-rank td.k a:hover{text-decoration:underline;}",
    ".ol-rank td.k{white-space:normal;}.ol-rank .nms{line-height:1.35;font-size:13px;white-space:nowrap;}",
    ".ol-rank .rk{display:inline-block;width:20px;color:var(--text3);font-weight:700;font-size:12px;}",
    ".ol-av.sm{width:26px;height:26px;margin:0;font-size:9.5px;}.ol-rank .faces .ol-av.sm{margin-right:-6px;border:2px solid var(--bg);}.ol-rank .faces{margin-right:8px;}",
    ".ol-key{font-size:12px;color:var(--text3);margin:0;padding:10px 20px 14px;}",
    ".ol-pick{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:12px 20px;border-bottom:1px solid var(--border);}",
    ".ol-pick button{border:1px solid var(--border2);background:var(--bg);border-radius:999px;padding:5px 11px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;color:var(--text2);}",
    ".ol-pick button.on{background:var(--text);color:var(--bg);border-color:var(--text);}",
    ".ol-note{margin-left:auto;font-size:12px;color:var(--text3);}",
    ".ol-foot{font-size:12.5px;color:var(--text3);line-height:1.6;margin:14px 2px 0;}",
    ".ol-snote{align-self:center;font-size:12.5px;color:var(--text3);}.ol-snote b{color:var(--text2);}",
    ".ol-tri{display:flex;width:100%;margin-top:8px;border:1px solid var(--border2);border-radius:7px;overflow:hidden;}",
    ".ol-tri span{flex:1;font:800 9.5px Inter,system-ui,sans-serif;letter-spacing:.04em;padding:4px 0;color:var(--text3);text-transform:uppercase;}",
    ".ol-tri span+span{border-left:1px solid var(--border2);}",
    ".ol-tri span.on.c{background:var(--ol-gold);color:#1b1a17;}.ol-tri span.on.y{background:var(--ol-pos);color:#fff;}.ol-tri span.on.n{background:var(--text2);color:var(--bg);}",
    ".ol-pc.fon{border:2px solid var(--ol-pos);padding:11px 5px 9px;}.ol-pc.foff{border:2px dashed var(--border2);padding:11px 5px 9px;}.ol-pc.foff .ol-av{filter:grayscale(1);opacity:.4;}",
    ".ol-pc .tag.y{background:var(--ol-pos);color:#fff;}.ol-pc .tag.n{background:var(--text2);color:var(--bg);}",
    ".ol-hold{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:10px 20px;border-bottom:1px solid var(--border);font-size:12.5px;color:var(--text3);}",
    ".ol-hold span{display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--text2);}.ol-hold .ol-av{width:24px;height:24px;margin:0;font-size:9px;}.ol-hold em{font-style:normal;font-weight:800;font-size:11px;}",
    ".ol-hold em.y{color:var(--ol-pos);}.ol-hold em.n{color:var(--text3);}.ol-hold span.n .ol-av{filter:grayscale(1);opacity:.45;}",
    ".ol-cbw{overflow-x:auto;}",
    ".ol-cb{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}",
    ".ol-cb th{font:800 10px Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);padding:10px 8px;text-align:center;border-bottom:1px solid var(--border);white-space:nowrap;line-height:1.3;}",
    ".ol-cb td{padding:9px 8px;text-align:center;border-bottom:1px solid var(--border);white-space:nowrap;vertical-align:middle;}",
    ".ol-cb .sep{border-left:1px solid var(--border);}",
    ".ol-cb td b{display:block;font-size:14px;font-weight:700;color:var(--text);}.ol-cb td i{display:block;font-style:normal;font-size:11.5px;font-weight:700;color:var(--text3);margin-top:1px;}",
    ".ol-cb td i.up{color:var(--ol-pos);}.ol-cb td i.dn{color:var(--ol-neg);}",
    ".ol-cb td.net b{font-size:22px;font-weight:800;}.ol-cb td.net b.up{color:var(--ol-pos);}.ol-cb td.net b.dn{color:var(--ol-neg);}",
    ".ol-cb td.mn{color:var(--text2);font-weight:700;}.ol-cb td.mn small{display:block;font-size:10.5px;color:var(--text3);font-weight:600;}",
    ".ol-cb th.lu,.ol-cb td.lu{text-align:left;padding-left:16px;}",
    ".ol-lu{display:inline-flex;gap:10px;}",
    ".ol-cf{display:inline-flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--text2);width:58px;}",
    ".ol-cf .ol-av{width:42px;height:42px;margin:0;font-size:13px;box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--ol-pos);}",
    ".ol-cf.off .ol-av b{visibility:hidden;}.ol-hold span.n .ol-av b{visibility:visible;}",
    ".ol-cf.off{color:var(--text3);}.ol-cf.off .ol-av{filter:grayscale(1);opacity:.35;box-shadow:none;}",
    ".ol-cf.off .ol-av::after{content:'OFF';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 11px Inter,system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.35);}",
    ".ol-cf small{max-width:58px;overflow:hidden;text-overflow:ellipsis;}",
    ".ol-cb tr.base td{background:var(--bg2);}.ol-cb tr.base td.lu{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);}",
    ".ol-cb tr.thin td{opacity:.5;}",
    "@media(max-width:820px){",
    ".ol-out.fit{width:auto;}.ol-out.fit .ol-cmp{overflow-x:auto;}.ol-q{grid-template-columns:repeat(2,1fr);}.ol-fr b{width:100%;}.ol-cmp{padding:12px 10px 4px;}.ol-cmp .oo-wide .ui-tiles{grid-template-columns:repeat(2,1fr);}.ol-rank.oo-pro col.n{width:13%;}.ol-rank .faces{display:none;}",
    ".ol-cmp .oo-pro{font-size:12px;}.ol-cmp .oo-pro col.n{width:15%;}.ol-cmp .oo-pro col.c{width:30px;}.ol-cmp .oo-pro td{padding:6px 3px;}.ol-cmp .oo-pro th{padding:6px 3px 8px;font-size:9px;letter-spacing:.04em;}.ol-cmp .oo-pc{min-width:24px;padding:2px 3px;font-size:10.5px;}}"
  ].join('');

  function css() {
    if (document.getElementById('tdc-onofflab-css')) return;
    var st = document.createElement('style'); st.id = 'tdc-onofflab-css';
    st.textContent = CSS; document.head.appendChild(st);
  }

  function make(root, O) {
  O = O || {};
  var S = { season: O.season || 2026, team: O.team || null, mode: O.mode || 'combos', pick: [], fix: {}, unit: O.unit || 3, sel: 0, f: { opp: 'all', ven: 'all', st: 'all', half: 'all', games: 'all' } };
  var D = null, $ = function (id) { return root.querySelector('[data-ol="' + id + '"]'); };
  var MODES_ON = O.modes ? MODES.filter(function (m) { return O.modes.indexOf(m[0]) >= 0; }) : MODES;
  var SEAS_ON = O.seasons ? SEASONS.filter(function (x) { return O.seasons.indexOf(x[0]) >= 0; }) : SEASONS;

  // ── sums ──
  function blank() { var b = {}; D.fields.forEach(function (f) { b[f] = 0; }); return b; }
  function add(a, arr) { D.fields.forEach(function (f, i) { a[f] += arr[i]; }); }
  function poss(b) { return Math.max(0, b.fga - b.orb + b.tov + 0.44 * b.fta); }
  function rate(o, d, s) {
    var po = poss(o), pd = poss(d), pc = function (n, x) { return x > 0 ? 100 * n / x : null; };
    var r = { min: s / 60, poss: (po + pd) / 2, o: pc(o.pts, po), d: pc(d.pts, pd), net: po && pd ? 100 * o.pts / po - 100 * d.pts / pd : null,
      efg: pc(o.fgm + 0.5 * o.tpm, o.fga), tov: pc(o.tov, po), orb: pc(o.orb, o.orb + d.drb), oefg: pc(d.fgm + 0.5 * d.tpm, d.fga), pm: o.pts - d.pts,
      // the rest of the player On/Off profile's box rows, so the Lab can reuse its sheet
      ts: pc(o.pts, 2 * (o.fga + 0.44 * o.fta)), fg: pc(o.fgm, o.fga), tp: pc(o.tpm, o.tpa), ftp: pc(o.ftm, o.fta), tpar: pc(o.tpa, o.fga), ftr: pc(o.fta, o.fga),
      ots: pc(d.pts, 2 * (d.fga + 0.44 * d.fta)), ofg: pc(d.fgm, d.fga), otp: pc(d.tpm, d.tpa), otpar: pc(d.tpa, d.fga), oftr: pc(d.fta, d.fga),
      otov: pc(d.tov, pd), drb: pc(o.drb, o.drb + d.orb), pace: s > 0 ? (po + pd) / 2 / (s / 60) * 40 : null };
    // shot quality + possession types (2025-26 on; build_onoff_shots.mjs), the same keys as wowy_<season>.json
    [[o, ''], [d, 'o']].forEach(function (x) {
      var b = x[0], p = x[1];
      if (!(b.sa >= 1 && b.ep >= 1)) return;
      r[p + 'lq'] = pc(b.xp, 2 * b.sa); r[p + 'sm'] = pc(b.sp - b.xp, b.sa); r[p + 'gsr'] = pc(b.gs, b.sa); r[p + 'bsr'] = pc(b.bs, b.sa);
      r[p + 'trr'] = pc(b.trp, b.ep); r[p + 'trppp'] = pc(b.trs, b.trp); r[p + 'hcppp'] = pc(b.hcs, b.hcp); r[p + 'scp'] = pc(b.scs, b.ep);
    });
    return r;
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
  // last name, with a first initial when two teammates share it (Cameron & Cayden Boozer)
  var lastU = function (i) { var n = nameOf(i), l = last(n), k = l.toLowerCase();
    var dup = D.ids.some(function (x, j) { return j !== i && last(nameOf(j)).toLowerCase() === k; });
    return dup ? first(n)[0] + '. ' + l : l; };
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
    var T = esc(TEAM()), names = function (L, j) { return L.map(function (i) { return esc(lastU(i)); }).join(j || ', '); };
    var cmp = function (on, off, heads) { after = function () { return TDC_ONOFF.compare($('olCmp'), { season: S.season, team: D.team, on: on, off: off, heads: heads }); }; return '<div id="olCmp" class="ol-cmp"></div>'; };
    TDC_ONOFF.ranker(S.season).then(function (Rk) {
      if (my !== TOK) return;
      var ch = function (side, k, v) { return Rk ? Rk.chip(side, k, v) : ''; };
      if (S.mode === 'combos') out = combos(P, team);
      else if (S.mode === 'together') {
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
            return '<tr><td class="k"><span class="rk">' + (k + 1) + '</span><span class="faces">' + x.k.map(function (i) { return av(i, 'sm'); }).join('') + '</span>' + '<span class="nms">' + x.k.map(function (i) { return link(i, esc(lastU(i))); }).join(' · ') + '</span></td>' +
              '<td>' + Math.round(x.r.min) + '</td><td>' + f1(x.r.o) + '</td><td class="pc">' + ch('on', 'o', x.r.o) + '</td><td>' + f1(x.r.d) + '</td><td class="pc">' + ch('on', 'd', x.r.d) + '</td>' +
              '<td class="' + (x.r.net >= 0 ? 'up' : 'dn') + '">' + sg(x.r.net) + '</td><td class="pc">' + ch('on', 'net', x.r.net) + '</td></tr>'; })) + '</div>'
            : '<div class="ol-say">No ' + n + '-man units with enough possessions' + (P.length ? ' that include everyone picked' : '') + '.</div>');
      }
      var fl = FILTERS.filter(function (F) { return S.f[F[0]] !== 'all'; }).map(function (F) { return F[2].find(function (o) { return o[0] === S.f[F[0]]; })[1]; });
      var m = MODES.find(function (z) { return z[0] === S.mode; });
      $('olOut').className = 'ol-out' + (S.mode === 'players' || S.mode === 'lineups' ? ' fit' : '');
      $('olOut').innerHTML = '<div class="ol-strip">' + m[1] + ' · ' + T + ' ' + SEASONS.find(function (x) { return x[0] === S.season; })[1] +
        '<span>' + (fl.length ? fl.join(' · ') + ' · ' : '') + nG + ' games · ' + Math.round(team.poss) + ' possessions</span></div>' + out +
        (S.mode === 'combos' ? '' : '<p class="ol-key">Each Rank chip places the number among D-I players’ on/off splits with ' + (Rk ? Rk.MIN : 500) + '+ possessions this season: green is good for the team, red is bad.</p>');
      $('olOut').querySelectorAll('[data-ct]').forEach(function (b) { b.onclick = function () { S.ctab = b.dataset.ct; draw(); }; });
      $('olOut').querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { S.unit = +b.dataset.u; sync(); draw(); }; });
      $('olOut').querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { S.sel = +b.dataset.s; draw(); }; });
      if (after) after();
    });
  }

  // ── WOWY combos (databallr-style): every on/off mix of the Combo players, with the On / Off players held ──
  // value + change vs all of the team's minutes under the same filters (green = better for the team)
  var CTABS = [
    ['over', 'Overview', [['ts', 'Off TS%', 1], ['tov', 'Off TOV%', -1], ['orb', 'Off ORB%', 1], ['ots', 'Def TS%', -1, 1], ['otov', 'Def TOV%', 1], ['drb', 'Def DRB%', 1]]],
    ['off', 'Offense', [['efg', 'eFG%', 1], ['ts', 'TS%', 1], ['tp', '3P%', 1], ['tpar', '3PA rate', 0], ['ftr', 'FT rate', 1], ['tov', 'TOV%', -1], ['orb', 'ORB%', 1], ['lq', 'Look Q', 1], ['sm', 'Shot-Mk', 1]]],
    ['def', 'Defense', [['oefg', 'Opp eFG%', -1], ['ots', 'Opp TS%', -1], ['otp', 'Opp 3P%', -1], ['otpar', 'Opp 3PA rate', 0], ['oftr', 'Opp FT rate', -1], ['otov', 'Forced TOV%', 1], ['drb', 'DRB%', 1], ['olq', 'Opp Look Q', -1], ['osm', 'Opp Shot-Mk', -1]]]];
  function combos(P, team) {
    var T = esc(TEAM()), idx = function (r) { return Object.keys(S.fix).filter(function (id) { return S.fix[id] === r; }).map(function (id) { return D.ids.indexOf(id); }).filter(function (i) { return i >= 0; }); };
    var Fon = idx('on'), Foff = idx('off');
    if (!P.length) return '<div class="ol-say">Set up to four players to <b>Combo</b>: each one becomes a column, and every on/off mix of them becomes a row. Set others to <b>On</b> or <b>Off</b> to hold them that way in every row.</div>';
    var held = function (u) { return Fon.every(function (i) { return has(u, i); }) && !Foff.some(function (i) { return has(u, i); }); };
    var R = [];
    for (var m = 0; m < (1 << P.length); m++) (function (m) {
      var r = sum(function (u) { if (!held(u)) return false; for (var j = 0; j < P.length; j++) if (!!((m >> j) & 1) !== has(u, P[j])) return false; return true; });
      if (r.poss >= 1) R.push({ m: m, r: r });
    })(m);
    R.sort(function (a, b) { return b.r.min - a.r.min; });
    var tab = CTABS.find(function (t) { return t[0] === (S.ctab || 'over'); }) || CTABS[0];
    var d = function (v, b, dir, dec) { if (v == null || b == null || !isFinite(v) || !isFinite(b)) return '<i>&nbsp;</i>'; var x = v - b;
      return '<i class="' + (!dir || Math.abs(x) < 0.05 ? '' : x * dir > 0 ? 'up' : 'dn') + '">' + sg(x, dec) + '</i>'; };
    var cell = function (r, k, dir, cls) { var v = r[k]; return '<td' + (cls ? ' class="' + cls + '"' : '') + '><b>' + f1(v) + '</b>' + (r === team ? '<i>&nbsp;</i>' : d(v, team[k], dir)) + '</td>'; };
    var head = '<tr><th class="lu">Lineup</th><th>Min</th><th class="sep">Net</th><th>ORtg</th><th>DRtg</th>' +
      tab[2].map(function (c, n) { return '<th class="' + (n === 0 || c[3] ? 'sep' : '') + '">' + c[1].replace(' ', '<br>') + '</th>'; }).join('') + '</tr>';
    var row = function (x, base) {
      var r = x.r, net = r.net;
      var lu = base ? 'All ' + T + ' minutes' : '<span class="ol-lu">' + P.map(function (i, j) { var on = (x.m >> j) & 1;
        return '<span class="ol-cf' + (on ? '' : ' off') + '">' + av(i, 'sm') + '<small>' + esc(last(nameOf(i))) + '</small></span>'; }).join('') + '</span>';
      return '<tr class="' + (base ? 'base' : r.poss < 25 ? 'thin' : '') + '"><td class="lu">' + lu + '</td><td class="mn">' + Math.round(r.min) + '<small>' + Math.round(r.poss) + ' poss</small></td>' +
        '<td class="net sep"><b class="' + (net == null ? '' : net >= 0 ? 'up' : 'dn') + '">' + sg(net) + '</b>' + (base ? '<i>&nbsp;</i>' : d(net, team.net, 1)) + '</td>' +
        cell(r, 'o', 1) + cell(r, 'd', -1) +
        tab[2].map(function (c, n) { return cell(r, c[0], c[2], n === 0 || c[3] ? 'sep' : ''); }).join('') + '</tr>';
    };
    var hold = Fon.concat(Foff).length ? '<div class="ol-hold">Held in every row:' + Fon.map(function (i) { return '<span class="y">' + av(i, 'sm') + esc(nameOf(i)) + ' <em class="y">ON</em></span>'; }).join('') +
      Foff.map(function (i) { return '<span class="n">' + av(i, 'sm') + esc(nameOf(i)) + ' <em class="n">OFF</em></span>'; }).join('') + '</div>' : '';
    return '<div class="ol-pick">' + CTABS.map(function (t) { return '<button class="' + (t === tab ? 'on' : '') + '" data-ct="' + t[0] + '">' + t[1] + '</button>'; }).join('') +
      '<span class="ol-note">' + R.length + ' of ' + (1 << P.length) + ' mixes played · change vs all ' + T + ' minutes</span></div>' + hold +
      (R.length ? '<div class="ol-cbw"><table class="ol-cb"><thead>' + head + '</thead><tbody>' + row({ r: team }, true) + R.map(function (x) { return row(x); }).join('') + '</tbody></table></div>'
        : '<div class="ol-say">None of these mixes happened under these filters.</div>') +
      '<p class="ol-key" style="padding-top:12px">Faded rows: under 25 possessions, read them as a hint.</p>';
  }

  // ── controls ──
  var TOT = { poss: 1 };
  function cards() {
    LIVE = D.rows; TOT = sum(function () { return true; });
    var mins = D.ids.map(function (x, i) { return sum(function (u) { return has(u, i); }).min; });
    filterRows();
    var CB = S.mode === 'combos', fixN = function (r) { return Object.keys(S.fix).filter(function (id) { return S.fix[id] === r; }).length; };
    $('olCount').textContent = CB ? S.pick.length + ' combo · ' + fixN('on') + ' on · ' + fixN('off') + ' off' + (S.pick.length || fixN('on') || fixN('off') ? ' · ' : '')
      : S.pick.length + ' of 4 picked' + (S.pick.length ? ' · ' : '');
    $('olClear').hidden = !S.pick.length && !(CB && Object.keys(S.fix).length);
    $('olCards').innerHTML = D.ids.map(function (id, i) { return { id: id, i: i, m: mins[i] }; }).filter(function (x) { return x.m >= 5; }).sort(function (a, b) { return b.m - a.m; }).map(function (x) {
      var j = S.pick.indexOf(x.id), n = nameOf(x.i), fx = CB ? S.fix[x.id] : null;
      var cls = j >= 0 ? ' on' : fx === 'on' ? ' fon' : fx === 'off' ? ' foff' : '';
      var tag = j >= 0 ? '<span class="tag">' + (CB ? 'C' : 'P') + (j + 1) + '</span>' : fx === 'on' ? '<span class="tag y">ON</span>' : fx === 'off' ? '<span class="tag n">OFF</span>' : '';
      // WOWY combos: Combo = a table column split into every on/off mix; On / Off = held for every row
      var tri = CB ? '<span class="ol-tri"><span data-r="c" class="c' + (j >= 0 ? ' on' : '') + '">Combo</span><span data-r="on" class="y' + (fx === 'on' ? ' on' : '') + '">On</span><span data-r="off" class="n' + (fx === 'off' ? ' on' : '') + '">Off</span></span>' : '';
      return '<button class="ol-pc' + cls + '" data-id="' + esc(x.id) + '" aria-pressed="' + (j >= 0 || !!fx) + '">' + tag + av(x.i) +
        '<span class="fn">' + esc(first(n)) + '</span><span class="ln">' + esc(last(n)) + '</span><span class="mn">' + Math.round(x.m) + ' min</span>' + tri + '</button>'; }).join('');
    $('olCards').querySelectorAll('.ol-pc').forEach(function (c) { c.onclick = function (e) { var id = c.dataset.id, j = S.pick.indexOf(id);
      var r = CB ? (e.target.closest('[data-r]') || {}).dataset : null; r = r && r.r;
      if (CB && (r === 'on' || r === 'off')) { if (j >= 0) S.pick.splice(j, 1); if (S.fix[id] === r) delete S.fix[id]; else S.fix[id] = r; }
      else if (j >= 0) S.pick.splice(j, 1);
      else { delete S.fix[id]; S.pick.push(id); if (S.pick.length > 4) S.pick.shift(); }
      S.sel = 0; sync(); cards(); draw(); }; });
  }
  function controls() {
    if (!$('olModes')) return controlsF();
    $('olModes').style.setProperty('--olq', MODES_ON.length);
    $('olModes').innerHTML = MODES_ON.map(function (m) { return '<button data-m="' + m[0] + '" class="' + (m[0] === S.mode ? 'on' : '') + '">' + m[1] + '<small>' + m[2] + '</small></button>'; }).join('');
    $('olModes').querySelectorAll('button').forEach(function (b) { b.onclick = function () { S.mode = b.dataset.m; S.sel = 0; sync(); controls(); if (D) cards(); draw(); }; });
    controlsF();
  }
  function controlsF() {
    $('olFilters').innerHTML = FILTERS.map(function (F) { return '<div class="ol-fr"><b>' + F[1] + '</b><span class="ui-seg">' + F[2].map(function (o) {
      return '<button data-f="' + F[0] + '" data-v="' + o[0] + '" class="' + (S.f[F[0]] === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</span></div>'; }).join('');
    $('olFilters').querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { S.f[b.dataset.f] = b.dataset.v; sync(); controls(); draw(); }; });
  }
  // the whole view rides in the URL, so any answer can be shared
  function sync() {
    if (!O.url) return;
    try { var u = new URL(location.href), q = u.searchParams;
      q.set('team', S.team); q.set('season', S.season); q.set('q', S.mode);
      if (S.pick.length) q.set('p', S.pick.join(',')); else q.delete('p');
      if (S.mode === 'lineups') q.set('n', S.unit); else q.delete('n');
      ['on', 'off'].forEach(function (r) { var L = Object.keys(S.fix).filter(function (id) { return S.fix[id] === r; }); if (S.mode === 'combos' && L.length) q.set('f' + r, L.join(',')); else q.delete('f' + r); });
      FILTERS.forEach(function (F) { if (S.f[F[0]] !== 'all') q.set(F[0], S.f[F[0]]); else q.delete(F[0]); });
      history.replaceState(null, '', u); } catch (e) {}
  }
  function loadTeam() {
    if (!S.team) { $('olOut').innerHTML = '<div class="ol-say">No play-by-play lineup data for this team in ' + SEASONS.find(function (x) { return x[0] === S.season; })[1] + '.</div>'; $('olCards').innerHTML = ''; return Promise.resolve(); }
    $('olOut').innerHTML = '<div class="ol-say">Loading ' + esc(S.team) + '…</div>';
    return get('scripts/data/onoff_lab/' + S.season + '/' + S.team + '.json?v=2').then(function (j) {
      if (!j) { $('olOut').innerHTML = '<div class="ol-say">No lineup data for this team and season.</div>'; $('olCards').innerHTML = ''; return; }
      D = j; S.pick = S.pick.filter(function (id) { return D.ids.indexOf(id) >= 0; });
      Object.keys(S.fix).forEach(function (id) { if (D.ids.indexOf(id) < 0 || S.pick.indexOf(id) >= 0) delete S.fix[id]; });
      if (!S.pick.length && S.mode !== 'players' && S.mode !== 'lineups') {   // a starting answer: the two biggest-minute players
        LIVE = D.rows; S.pick = D.ids.map(function (id, i) { return { id: id, m: sum(function (u) { return has(u, i); }).min }; }).sort(function (a, b) { return b.m - a.m; }).slice(0, 2).map(function (x) { return x.id; }); }
      sync(); cards(); draw();
    });
  }
  function teams() {
    return (IDX[S.season] ? Promise.resolve(IDX[S.season]) : get('scripts/data/onoff_lab/' + S.season + '/index.json?v=1').then(function (j) { return (IDX[S.season] = j || []); })).then(function (L) {
      var short = function (t) { try { return (window.tdcShortSchool && tdcShortSchool(t[1])) || t[1]; } catch (e) { return t[1]; } };
      L = L.slice().sort(function (a, b) { return short(a).localeCompare(short(b)); });
      if (O.lockTeam) {   // the team page: this team only; null = no lineup data for it this season
        var want = slugOf(O.team), hit = L.find(function (t) { return t[0] === want || slugOf(t[1]) === want; });
        S.team = hit ? hit[0] : null; return;
      }
      if (!L.some(function (t) { return t[0] === S.team; })) S.team = (L.find(function (t) { return t[0] === 'kentucky-wildcats'; }) || L[0] || [])[0];
      if ($('olTeam')) $('olTeam').innerHTML = L.map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === S.team ? ' selected' : '') + '>' + esc(short(t)) + '</option>'; }).join('');
    });
  }
  function start() {
    css();
    var n = 0, step = function (lbl, body, extra) { n++; return '<div class="ol-step"><div class="ol-lbl">' + (O.lockTeam ? '' : n + ' · ') + lbl + (extra || '') + '</div>' + body + '</div>'; };
    root.classList.add('ol-lab');
    root.innerHTML =
      (O.lockTeam && SEAS_ON.length < 2 ? '<select data-ol="olSeason" hidden></select>' + (O.note ? '<p class="ol-snote">' + O.note + '</p>' : '') : step(O.lockTeam ? 'Season' : 'Team', '<div class="ol-row">' + (O.lockTeam ? '' : '<select data-ol="olTeam" class="ui-select" aria-label="Team"></select>') +
        '<select data-ol="olSeason" class="ui-select" aria-label="Season"></select>' + (O.note ? '<span class="ol-snote">' + O.note + '</span>' : '') + '</div>')) +
      (MODES_ON.length > 1 ? step('Question', '<div class="ol-q" data-ol="olModes"></div>') : '') +
      step('Players', '<div class="ol-cards" data-ol="olCards"></div>', ' <span><span data-ol="olCount"></span><button data-ol="olClear" type="button" hidden>Clear</button></span>') +
      step('Filters', '<div class="ol-fl" data-ol="olFilters"></div>') +
      '<div class="ol-out" data-ol="olOut"></div>';
    if (O.url) {
      var q = new URLSearchParams(location.search);
      S.team = q.get('team') || S.team; if (q.get('season')) S.season = +q.get('season');
      if (q.get('q') && MODES_ON.some(function (m) { return m[0] === q.get('q'); })) S.mode = q.get('q');
      if (q.get('p')) S.pick = q.get('p').split(',').filter(Boolean).slice(0, 4);
      ['on', 'off'].forEach(function (r) { (q.get('f' + r) || '').split(',').filter(Boolean).forEach(function (id) { S.fix[id] = r; }); });
      if (q.get('n')) S.unit = Math.max(2, Math.min(5, +q.get('n') || 3));
      FILTERS.forEach(function (F) { var v = q.get(F[0]); if (v && F[2].some(function (o) { return o[0] === v; })) S.f[F[0]] = v; });
    }
    if (!MODES_ON.some(function (m) { return m[0] === S.mode; })) S.mode = MODES_ON[0][0];
    if (!SEAS_ON.some(function (x) { return x[0] === S.season; })) S.season = SEAS_ON[0][0];
    $('olSeason').innerHTML = SEAS_ON.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === S.season ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('');
    $('olSeason').onchange = function () { S.season = +this.value; teams().then(loadTeam); };
    if ($('olTeam')) $('olTeam').onchange = function () { S.team = this.value; S.pick = []; S.sel = 0; loadTeam(); };
    $('olClear').onclick = function () { S.pick = []; S.fix = {}; sync(); cards(); draw(); };
    controls(); return teams().then(loadTeam);
  }
  return start();
  }

  window.TDC_ONOFFLAB = {
    init: function () { return make(document.getElementById('olLab'), { url: true }); },
    mount: function (host, opts) { return host ? make(host, opts) : Promise.resolve(); }
  };
})();
