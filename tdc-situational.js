/* tdc-situational.js — reusable "how they actually show up" block for a team's 2025-26
 * results. Call TDC_SITUATIONAL.section(row, season) → Promise<html>; drop the html into
 * any page (like TDC_LINEUPS.section). row needs .full and .team.
 *
 * Splits every result by venue, opponent quality (Power Rating), pressure (close games),
 * schedule (conf / last-10), plus a first-half/second-half shooting read and the
 * signature win / worst loss — then a synthesized scouting read. Self-contained: own
 * data fetches, own scoped CSS (everything under .tsit). No page dependencies beyond
 * window.tdcShortSchool (optional) for short names.
 */
window.TDC_SITUATIONAL = (function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1';
  var H = { apikey: 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye',
            Authorization: 'Bearer sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye' };
  var _srs = null, _srsRank = null;   // cached opponent-quality map (per season)
  var _srsSeason = null;

  function esc(s){ return ('' + (s == null ? '' : s)).replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  function sn(t){ return window.tdcShortSchool ? window.tdcShortSchool(t) : t; }

  function ensureCss(){
    if (document.getElementById('tsit-css')) return;
    var s = document.createElement('style'); s.id = 'tsit-css';
    s.textContent =
      '.tsit .splits{display:grid;grid-template-columns:1fr 1fr;gap:10px;}'
      + '@media(max-width:600px){.tsit .splits{grid-template-columns:1fr;}}'
      + '.tsit .split{border:1px solid var(--border);border-radius:12px;background:var(--bg2);padding:14px 16px;}'
      + '.tsit .split .sl{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}'
      + '.tsit .srow{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:7px 0;border-top:1px solid var(--border);}'
      + '.tsit .srow:first-of-type{border-top:none;}'
      + '.tsit .srow .cx{font-size:12.5px;font-weight:600;color:var(--text2);}'
      + '.tsit .srow .rec{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;text-align:right;min-width:44px;}'
      + '.tsit .srow .mg{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;text-align:right;min-width:52px;}'
      + '.tsit .mg.pos{color:var(--green,#1a8c3a);} .tsit .mg.neg{color:var(--red,#cc2200);} .tsit .mg.dim{color:var(--text3);}'
      + '.tsit .hilite{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;}'
      + '@media(max-width:600px){.tsit .hilite{grid-template-columns:1fr;}}'
      + '.tsit .hl{border:1px solid var(--border);border-radius:12px;background:var(--bg2);padding:13px 16px;}'
      + '.tsit .hl .ht{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;}'
      + '.tsit .hl.win .ht{color:var(--green,#1a8c3a);} .tsit .hl.loss .ht{color:var(--red,#cc2200);}'
      + '.tsit .hl .hn{font-weight:800;font-size:14px;} .tsit .hl .hd{font-size:12px;color:var(--text3);margin-top:2px;}'
      + '.tsit .tread{font-size:13.5px;color:var(--text2);line-height:1.7;background:var(--bg2);border-left:3px solid var(--tc,#888);padding:14px 16px;border-radius:0 8px 8px 0;margin-top:16px;}'
      + '.tsit .tread b{color:var(--text);}';
    document.head.appendChild(s);
  }

  function rec(gs){ var w = gs.filter(function(g){ return g.win; }).length;
    return { w: w, l: gs.length - w, n: gs.length, mg: gs.length ? gs.reduce(function(s,g){ return s + g.margin; }, 0) / gs.length : 0 }; }
  function mgCls(m){ return m >= 0.5 ? 'pos' : m <= -0.5 ? 'neg' : 'dim'; }
  function srowH(cx, gs){ if (!gs.length) return ''; var r = rec(gs);
    return '<div class="srow"><div class="cx">' + esc(cx) + '</div><div class="rec">' + r.w + '–' + r.l
      + '</div><div class="mg ' + mgCls(r.mg) + '">' + (r.mg >= 0 ? '+' : '') + r.mg.toFixed(1) + '</div></div>'; }

  function halfEfg(shots, h){ var s = shots.filter(function(x){ return (x.period === 1 ? 1 : x.period === 2 ? 2 : 3) === h; });
    if (s.length < 15) return null;
    var fga = s.length, m2 = s.filter(function(x){ return x.made && x.sv === 2; }).length, m3 = s.filter(function(x){ return x.made && x.sv === 3; }).length;
    return { fga: fga, efg: (m2 + m3 + 0.5 * m3) / fga }; }

  function j(url){ return fetch(SB + url, { headers: H }).then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; }); }

  function loadSRS(season){
    if (_srs && _srsSeason === season) return Promise.resolve();
    return j('/team_seasons?season_year=eq.' + season + '&srs=not.is.null&select=team,srs&limit=1000').then(function(ts){
      _srs = {}; (ts || []).forEach(function(t){ _srs[t.team] = +t.srs; });
      _srsRank = {}; Object.keys(_srs).sort(function(a,b){ return _srs[b] - _srs[a]; }).forEach(function(t,i){ _srsRank[t] = i + 1; });
      _srsSeason = season;
    });
  }
  function teamId(row){
    return j('/team_seasons?select=team,team_id&team=ilike.' + encodeURIComponent(sn(row.team)) + '*&limit=25').then(function(rows){
      var tn = sn(row.team).toLowerCase().trim();
      for (var k = 1; k <= 3; k++) for (var i = 0; i < rows.length; i++){ var w = rows[i].team.split(' ');
        if (w.length > k && w.slice(0, w.length - k).join(' ').toLowerCase() === tn) return rows[i].team_id; }
      return rows.length ? rows[0].team_id : null;
    });
  }

  function section(row, season){
    season = season || 2026;
    ensureCss();
    var me = row.full;
    return loadSRS(season).then(function(){
      return j('/games?or=(home.eq.' + encodeURIComponent(me) + ',away.eq.' + encodeURIComponent(me) + ')&season_year=eq.' + season
        + '&home_score=not.is.null&select=id,home,away,home_score,away_score,neutral,conf_game,date&order=date.asc&limit=60');
    }).then(function(games){
      if (!games || games.length < 5) return '';
      var G = games.map(function(x){ var home = x.home === me, my = home ? x.home_score : x.away_score, opp = home ? x.away_score : x.home_score, oppName = home ? x.away : x.home;
        return { oppName: oppName, my: my, opp: opp, margin: my - opp, win: my > opp, venue: x.neutral ? 'N' : (home ? 'H' : 'A'),
          close: Math.abs(my - opp) <= 5, conf: !!x.conf_game, oppSRS: (_srs[oppName] != null ? _srs[oppName] : null), oppRank: (_srsRank[oppName] != null ? _srsRank[oppName] : 999), date: x.date }; });
      var overall = rec(G);
      var q1 = G.filter(function(g){ return g.oppRank <= 50; }), q2 = G.filter(function(g){ return g.oppRank > 50 && g.oppRank <= 150; }), q3 = G.filter(function(g){ return g.oppRank > 150; });
      var venueSplit = '<div class="split"><div class="sl">By venue</div>' + srowH('Home', G.filter(function(g){ return g.venue === 'H'; })) + srowH('Neutral', G.filter(function(g){ return g.venue === 'N'; })) + srowH('Road', G.filter(function(g){ return g.venue === 'A'; })) + '</div>';
      var qualSplit = '<div class="split"><div class="sl">By opponent quality (Power Rating)</div>' + srowH('vs Top-50', q1) + srowH('vs 51–150', q2) + srowH('vs 151+', q3) + '</div>';
      var clutchSplit = '<div class="split"><div class="sl">Pressure</div>' + srowH('Close games (≤5)', G.filter(function(g){ return g.close; })) + srowH('Decided by 6+', G.filter(function(g){ return !g.close; })) + '</div>';
      var confSplit = '<div class="split"><div class="sl">Schedule</div>' + srowH('Conference', G.filter(function(g){ return g.conf; })) + srowH('Non-conference', G.filter(function(g){ return !g.conf; })) + srowH('Last 10', G.slice(-10)) + '</div>';
      var wins = G.filter(function(g){ return g.win && g.oppSRS != null; }), losses = G.filter(function(g){ return !g.win && g.oppSRS != null; });
      var sig = wins.sort(function(a,b){ return b.oppSRS - a.oppSRS; })[0], bad = losses.sort(function(a,b){ return a.oppSRS - b.oppSRS; })[0];
      var venL = function(v){ return v === 'H' ? 'vs' : v === 'A' ? 'at' : 'vs'; };
      var hilite = '<div class="hilite">'
        + (sig ? '<div class="hl win"><div class="ht">Signature win</div><div class="hn">' + venL(sig.venue) + ' ' + esc(sn(sig.oppName)) + ' ' + sig.my + '–' + sig.opp + '</div><div class="hd">their best result — a top-' + (sig.oppRank <= 25 ? '25' : sig.oppRank <= 50 ? '50' : '100') + ' opponent</div></div>' : '')
        + (bad ? '<div class="hl loss"><div class="ht">Worst loss</div><div class="hn">' + venL(bad.venue) + ' ' + esc(sn(bad.oppName)) + ' ' + bad.my + '–' + bad.opp + '</div><div class="hd">their softest result — ' + (bad.oppRank <= 100 ? 'a game they could\'ve had' : 'one to forget') + '</div></div>' : '')
        + '</div>';
      var rq1 = rec(q1), road = rec(G.filter(function(g){ return g.venue === 'A'; })), home = rec(G.filter(function(g){ return g.venue === 'H'; })), cl = rec(G.filter(function(g){ return g.close; }));
      var parts = [];
      if (q1.length >= 3) parts.push(rq1.w >= rq1.l ? '<b>battle-tested</b> — ' + rq1.w + '–' + rq1.l + ' against top-50 competition' : '<b>front-runners</b> — just ' + rq1.w + '–' + rq1.l + ' vs the top 50, resume built lower on the schedule');
      if (road.n >= 3 && home.n >= 3){ var gap = home.mg - road.mg; if (gap >= 8) parts.push('a very different team on the road (' + (road.mg >= 0 ? '+' : '') + road.mg.toFixed(0) + ' vs ' + (home.mg >= 0 ? '+' : '') + home.mg.toFixed(0) + ' at home) — <b>get them out of their gym</b>'); else if (gap <= 4) parts.push('travel-proof — nearly as strong away as at home'); }
      if (cl.n >= 3) parts.push(cl.w >= cl.l ? 'and ' + cl.w + '–' + cl.l + ' in one-possession games (' + (cl.w > cl.l ? 'clutch — a late lead is not safe' : 'even') + ')' : 'and <b>shaky in the clutch</b> (' + cl.w + '–' + cl.l + ' in close ones — hang around and the pressure is on them)');
      var read = parts.length ? '<div class="tread">' + esc(sn(me)) + ' is ' + parts.join(', ') + '.</div>' : '';

      var body = '<div class="sec-h" style="margin-top:26px">Situational — which version shows up <span class="hint">2025-26 · ' + overall.w + '–' + overall.l + ', ' + (overall.mg >= 0 ? '+' : '') + overall.mg.toFixed(1) + ' avg margin</span></div>'
        + '<div class="splits">' + venueSplit + qualSplit + clutchSplit + confSplit + '</div>' + hilite + read;

      // half-by-half shooting (offense + defense allowed)
      return teamId(row).then(function(tid){
        if (tid == null) return '<div class="tsit">' + body + '</div>';
        var ids = games.map(function(g){ return g.id; }).filter(function(x){ return x != null; });
        return Promise.all([
          j('/shots?team_id=eq.' + tid + '&season_year=eq.' + season + '&select=period,made,sv&limit=1000'),
          ids.length ? j('/shots?game_id=in.(' + ids.join(',') + ')&team_id=neq.' + tid + '&select=period,made,sv&limit=1000') : Promise.resolve([])
        ]).then(function(res){
          var off = res[0] || [], def = res[1] || [];
          var o1 = halfEfg(off, 1), o2 = halfEfg(off, 2), d1 = halfEfg(def, 1), d2 = halfEfg(def, 2);
          if (!o1 || !o2) return '<div class="tsit">' + body + '</div>';
          var p = function(x){ return (x * 100).toFixed(1); }, dcls = function(d){ return d >= 1 ? 'pos' : d <= -1 ? 'neg' : 'dim'; };
          var rowH = function(lab, a, b, flip){ if (!a || !b) return ''; var d = (b.efg - a.efg) * 100, good = flip ? -d : d;
            return '<div class="srow"><div class="cx">' + lab + '</div><div class="rec" style="min-width:88px">' + p(a.efg) + '% → ' + p(b.efg) + '%</div><div class="mg ' + dcls(good) + '">' + (d >= 0 ? '+' : '') + d.toFixed(1) + '</div></div>'; };
          var oD = (o2.efg - o1.efg) * 100, dD = (d1 && d2) ? (d2.efg - d1.efg) * 100 : null, hp = [];
          hp.push(Math.abs(oD) < 2.5 ? 'shoots about the same before and after the break' : oD >= 2.5 ? 'a <b>second-half team</b> — shooting jumps ' + p(o1.efg) + '%→' + p(o2.efg) + '% eFG after halftime' : '<b>starts hot and cools off</b> — ' + p(o1.efg) + '%→' + p(o2.efg) + '% eFG after the break');
          if (dD != null) hp.push(Math.abs(dD) < 2.5 ? 'and defend both halves evenly' : dD <= -2.5 ? 'and their defense tightens late (allowing ' + p(d1.efg) + '%→' + p(d2.efg) + '%)' : 'and their defense slips after halftime (allowing ' + p(d1.efg) + '%→' + p(d2.efg) + '%)');
          var half = '<div class="sec-h" style="margin-top:22px">First half vs second half <span class="hint">shooting eFG% by half</span></div>'
            + '<div class="split" style="max-width:540px">' + rowH('Offense', o1, o2, false) + ((d1 && d2) ? rowH('Defense allowed', d1, d2, true) : '') + '</div>'
            + '<div class="tread">' + esc(sn(me)) + ' ' + hp.join(', ') + '.</div>';
          return '<div class="tsit">' + body + half + '</div>';
        });
      });
    }).catch(function(){ return ''; });
  }

  return { section: section };
})();
