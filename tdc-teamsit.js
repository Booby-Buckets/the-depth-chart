/* tdc-teamsit.js — team situational identity for the Coach's Tier.
   TDC_TEAMSIT.section(row) → Promise<html> with a team's CLUTCH identity (offense/
   defense eFG clutch-vs-rest, net, who closes) + ADJUSTMENT profile (halftime O/D
   swings, run response, poise under deficit, shot-mix). Pooled across every season
   with game-clock shot data. Merged in from the retired team-clutch.html +
   adjustments.html — same engines, one shared fetch. Drops into a host div like
   TDC_SITUATIONAL / TDC_LINEUPS. Injects its own scoped CSS once. */
window.TDC_TEAMSIT = (function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co',
      KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye',
      H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  var R = function (v) { var n = +v; return isNaN(n) ? 0 : n; };
  var esc = function (t) { return ('' + (t == null ? '' : t)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var efg = function (sh) { if (!sh.length) return null; var mw = 0; sh.forEach(function (s) { if (s.made) mw += (s.sv === 3 ? 1.5 : 1); }); return mw / sh.length * 100; };
  var tprate = function (a) { if (!a.length) return null; return a.filter(function (s) { return s.sv === 3; }).length / a.length * 100; };
  var isClutch = function (s) { return s.period != null && s.period >= 2 && s.sec_left != null && s.sec_left <= 300 && s.home_score != null && s.away_score != null && Math.abs(R(s.home_score) - R(s.away_score)) <= 5; };
  var is3 = function (s) { return s.sv === 3; }, isRim = function (s) { return /layup|dunk|tip/.test((s.stype || '').toLowerCase()); };
  var rate = function (a, fn) { return a.length ? a.filter(fn).length / a.length * 100 : 0; };

  async function fetchAll(path) {
    var out = [], from = 0, PG = 1000;
    for (var i = 0; i < 14; i++) {
      var r; try { r = await fetch(SB + path, { headers: Object.assign({}, H, { 'Range-Unit': 'items', 'Range': from + '-' + (from + PG - 1) }) }); } catch (e) { break; }
      if (!r.ok) break; var b = await r.json(); out = out.concat(b); if (b.length < PG) break; from += PG;
    }
    return out;
  }
  async function resolveTid(row) {
    var enc = encodeURIComponent(row.full), tid = null;
    try { var g = await fetch(SB + '/rest/v1/games?home=eq.' + enc + '&select=home_id&limit=1', { headers: H }).then(function (r) { return r.ok ? r.json() : []; });
      if (g && g.length) tid = g[0].home_id;
      else { g = await fetch(SB + '/rest/v1/games?away=eq.' + enc + '&select=away_id&limit=1', { headers: H }).then(function (r) { return r.ok ? r.json() : []; }); if (g && g.length) tid = g[0].away_id; }
    } catch (e) {}
    return tid;
  }

  function ensureCss() {
    if (document.getElementById('tsit-css')) return;
    var s = document.createElement('style'); s.id = 'tsit-css';
    s.textContent =
      ".tsit-badge{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:3px 10px;border-radius:20px;margin-right:8px;}"
      + ".tsit-badge.g{color:var(--green,#1a8c3a);background:color-mix(in srgb,var(--green,#1a8c3a) 15%,transparent);}"
      + ".tsit-badge.r{color:var(--red,#cc2200);background:color-mix(in srgb,var(--red,#cc2200) 15%,transparent);}"
      + ".tsit-badge.a{color:var(--amber,#b5872a);background:color-mix(in srgb,var(--amber,#b5872a) 16%,transparent);}"
      + ".tsit-badge.n{color:var(--text3);background:var(--bg3);}"
      + ".tsit-cmp{border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:12px;}"
      + ".tsit-cmp .h,.tsit-cmp .rr{display:grid;grid-template-columns:1fr 66px 96px;gap:8px;padding:9px 14px;align-items:center;}"
      + ".tsit-cmp .h{background:var(--bg3);font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);}"
      + ".tsit-cmp .h .a{text-align:right;} .tsit-cmp .h .a.hl{color:var(--text);}"
      + ".tsit-cmp .rr{border-top:1px solid var(--border);font-size:12.5px;}"
      + ".tsit-cmp .ml{font-weight:700;} .tsit-cmp .ml small{display:block;font-size:10px;color:var(--text3);font-weight:500;}"
      + ".tsit-cmp .v{text-align:right;font-family:'Playfair Display',serif;font-weight:800;font-size:17px;font-variant-numeric:tabular-nums;}"
      + ".tsit-cmp .v.dim{color:var(--text3);font-size:15px;} .tsit-cmp .v.up{color:var(--green,#1a8c3a);} .tsit-cmp .v.dn{color:var(--red,#cc2200);}"
      + ".tsit-clr{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border);}"
      + ".tsit-clr:first-of-type{border-top:none;} .tsit-clr .rk{font-family:'Playfair Display',serif;font-weight:800;color:var(--text3);width:16px;text-align:center;}"
      + ".tsit-clr .nm{flex:1;min-width:0;font-weight:700;font-size:13px;} .tsit-clr .nm small{color:var(--text3);font-weight:500;font-size:10.5px;margin-left:5px;}"
      + ".tsit-clr .bar{width:64px;height:6px;border-radius:3px;background:var(--bg3);overflow:hidden;flex-shrink:0;} .tsit-clr .bar i{display:block;height:100%;background:var(--tc,var(--accent));}"
      + ".tsit-clr .pct{font-weight:800;min-width:36px;text-align:right;}"
      + ".tsit-scores{display:grid;grid-template-columns:1fr 1fr;gap:12px;}"
      + "@media(max-width:560px){.tsit-scores{grid-template-columns:1fr;}}"
      + ".tsit-card{border:1px solid var(--border);border-radius:13px;background:var(--bg2);padding:14px 16px;}"
      + ".tsit-card .sl{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);}"
      + ".tsit-card .sbig{font-family:'Playfair Display',serif;font-weight:800;font-size:28px;line-height:1;} .tsit-card .slab{font-size:11px;font-weight:800;margin-left:8px;}"
      + ".tsit-card.g .sbig,.tsit-card.g .slab{color:var(--green,#1a8c3a);} .tsit-card.r .sbig,.tsit-card.r .slab{color:var(--red,#cc2200);} .tsit-card.a .sbig,.tsit-card.a .slab{color:var(--amber,#b5872a);}"
      + ".tsit-card .sd{font-size:11px;color:var(--text3);margin-top:7px;line-height:1.45;}"
      + ".tsit-card .sp{display:flex;gap:18px;margin-top:11px;padding-top:11px;border-top:1px solid var(--border);font-size:10.5px;color:var(--text3);font-weight:700;}"
      + ".tsit-card .sp b{display:block;font-family:'Playfair Display',serif;font-size:16px;color:var(--text);font-weight:800;}"
      + ".tsit-mix{border:1px solid var(--border);border-radius:12px;background:var(--bg2);padding:2px 16px;margin-top:4px;}"
      + ".tsit-mix .mr{display:grid;grid-template-columns:1fr 54px 54px 54px;gap:10px;padding:8px 0;border-top:1px solid var(--border);align-items:center;font-size:12.5px;}"
      + ".tsit-mix .mr:first-child{border-top:none;color:var(--text3);font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;}"
      + ".tsit-mix .mv{font-variant-numeric:tabular-nums;text-align:right;} .tsit-mix .md{text-align:right;font-weight:800;}"
      + ".tsit-mix .md.up{color:var(--green,#1a8c3a);} .tsit-mix .md.dn{color:var(--red,#cc2200);} .tsit-mix .md.fl{color:var(--text3);}";
    document.head.appendChild(s);
  }

  // ── CLUTCH identity (pooled all seasons) ──
  function renderClutch(off, def, NAME) {
    var oCl = off.filter(isClutch), oRe = off.filter(function (s) { return !isClutch(s); });
    var dCl = def.filter(isClutch), dRe = def.filter(function (s) { return !isClutch(s); });
    if (oCl.length < 8) return '';
    var efgOCl = efg(oCl), efgORe = efg(oRe), efgDCl = efg(dCl), efgDRe = efg(dRe);
    var netCl = (efgOCl != null && efgDCl != null) ? efgOCl - efgDCl : null;
    var netRe = (efgORe != null && efgDRe != null) ? efgORe - efgDRe : null;
    var swing = (netCl != null && netRe != null) ? netCl - netRe : null;
    var role = { lab: 'Steady down the stretch', cls: 'n' };
    if (swing != null) role = swing >= 5 ? { lab: 'Ice in their veins', cls: 'g' } : swing <= -5 ? { lab: 'Late wobble', cls: 'r' } : { lab: 'Steady down the stretch', cls: 'n' };
    var oTxt = (efgOCl != null && efgORe != null) ? (efgOCl >= efgORe + 3 ? "their offense <b>sharpens</b> (eFG " + Math.round(efgOCl) + " vs " + Math.round(efgORe) + ")" : efgOCl <= efgORe - 3 ? "their offense <b>tightens up</b> (eFG " + Math.round(efgOCl) + " vs " + Math.round(efgORe) + ")" : "their offense holds (eFG " + Math.round(efgOCl) + ")") : '';
    var dTxt = (efgDCl != null && efgDRe != null) ? (efgDCl <= efgDRe - 3 ? "the defense <b>clamps down</b> (opp eFG " + Math.round(efgDCl) + " vs " + Math.round(efgDRe) + ")" : efgDCl >= efgDRe + 3 ? "the defense <b>springs leaks</b> (opp eFG " + Math.round(efgDCl) + " vs " + Math.round(efgDRe) + ")" : "the defense holds (opp eFG " + Math.round(efgDCl) + ")") : '';
    var rd = "In the clutch, " + ([oTxt, dTxt].filter(Boolean).join(', and ') || 'the sample is thin on one side') + ".";
    var cell = function (v, cls) { return "<div class='v " + (cls || '') + "'>" + (v == null ? '—' : Math.round(v)) + "</div>"; };
    var cmp = "<div class='tsit-cmp'><div class='h'><span>Metric</span><span class='a hl'>Clutch</span><span class='a'>Rest of game</span></div>"
      + "<div class='rr'><div class='ml'>Offense<small>team eFG%</small></div>" + cell(efgOCl) + cell(efgORe, 'dim') + "</div>"
      + "<div class='rr'><div class='ml'>Defense<small>opp eFG% · lower better</small></div>" + cell(efgDCl) + cell(efgDRe, 'dim') + "</div>"
      + "<div class='rr'><div class='ml'>Net<small>offense − defense</small></div><div class='v " + (netCl != null ? (netCl >= 0 ? 'up' : 'dn') : '') + "'>" + (netCl == null ? '—' : (netCl > 0 ? '+' : '') + Math.round(netCl)) + "</div><div class='v dim'>" + (netRe == null ? '—' : (netRe > 0 ? '+' : '') + Math.round(netRe)) + "</div></div>"
      + "<div class='rr'><div class='ml'>Three-point rate<small>% of clutch shots</small></div><div class='v' style='font-size:15px'>" + (tprate(oCl) == null ? '—' : Math.round(tprate(oCl)) + '%') + "</div><div class='v dim' style='font-size:14px'>" + (tprate(oRe) == null ? '—' : Math.round(tprate(oRe)) + '%') + "</div></div>"
      + "<div class='rr'><div class='ml'>Shot volume<small>team FGA</small></div><div class='v' style='font-size:15px'>" + oCl.length + "</div><div class='v dim' style='font-size:14px'>" + oRe.length + "</div></div></div>";
    var closers = '';
    if (oCl.length >= 6) {
      var by = {}; oCl.forEach(function (s) { var k = s.espn_id == null ? '?' : s.espn_id; (by[k] = by[k] || { id: k, att: 0, mk: 0 }); by[k].att++; if (s.made) by[k].mk++; });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.att - a.att; }).slice(0, 5), maxAtt = list[0].att;
      closers = "<div style='font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin:14px 0 6px'>Who closes · " + oCl.length + " clutch FGA</div>"
        + list.map(function (c, i) { var share = c.att / oCl.length * 100, fg = c.att ? Math.round(c.mk / c.att * 100) : 0, w = maxAtt ? c.att / maxAtt * 100 : 0, nm = NAME[c.id] || 'Unknown';
          return "<div class='tsit-clr'><div class='rk'>" + (i + 1) + "</div><div class='nm'>" + esc(nm) + "<small>" + c.att + " FGA · " + fg + "% FG</small></div><div class='bar'><i style='width:" + w.toFixed(0) + "%'></i></div><div class='pct'>" + Math.round(share) + "%</div></div>";
        }).join('');
    }
    return "<div class='sec-h' style='margin-top:22px'>Clutch identity <span class='hint'>last 5:00, within 5 · pooled all seasons · " + oCl.length + " clutch shots</span></div>"
      + "<div class='card'><div style='font-size:13px;line-height:1.6;color:var(--text2)'><span class='tsit-badge " + role.cls + "'>" + role.lab + "</span>" + rd + "</div>" + cmp + closers + "</div>";
  }

  // ── ADJUSTMENT profile (pooled all seasons) ──
  function renderAdjust(off, def, row) {
    var base = efg(off);
    var oh1 = off.filter(function (s) { return s.period === 1; }), oh2 = off.filter(function (s) { return s.period >= 2; });
    var oe1 = efg(oh1), oe2 = efg(oh2), htOff = (oe1 != null && oe2 != null) ? oe2 - oe1 : null;
    var dh1 = def.filter(function (s) { return s.period === 1; }), dh2 = def.filter(function (s) { return s.period >= 2; });
    var de1 = efg(dh1), de2 = efg(dh2), htDef = (de1 != null && de2 != null) ? de2 - de1 : null;
    var byGame = {}; off.forEach(function (s) { if (s._m == null) return; (byGame[s.game_id] = byGame[s.game_id] || []).push(s); });
    var afterRun = [];
    Object.keys(byGame).forEach(function (k) { var gs = byGame[k]; gs.sort(function (a, b) { return a._t - b._t; });
      for (var i = 1; i < gs.length; i++) { var s = gs[i], prior = gs.slice(0, i).filter(function (x) { return x._t >= s._t - 150; }); if (!prior.length) continue;
        var peak = Math.max.apply(null, prior.map(function (x) { return x._m; })); if (peak - gs[i - 1]._m >= 6) afterRun.push(s); } });
    var runE = afterRun.length >= 12 ? efg(afterRun) : null, runD = (runE != null && base != null) ? runE - base : null;
    var behind = off.filter(function (s) { return s._m != null && s._m <= -6; });
    var behindE = behind.length >= 15 ? efg(behind) : null, behindD = (behindE != null && base != null) ? behindE - base : null;
    if (oh1.length < 20 && oh2.length < 20) return '';
    var cUp = function (d, hi, lo) { return d == null ? 'n' : d >= hi ? 'g' : d <= lo ? 'r' : 'n'; };
    var htOffCls = cUp(htOff, 3, -3), htOffLab = htOff == null ? '—' : htOff >= 3 ? 'Sharper' : htOff <= -3 ? 'Fades' : 'Steady';
    var htDefCls = htDef == null ? 'n' : htDef <= -3 ? 'g' : htDef >= 3 ? 'r' : 'n', htDefLab = htDef == null ? '—' : htDef <= -3 ? 'Tightens' : htDef >= 3 ? 'Loosens' : 'Steady';
    var runCls = cUp(runD, 2, -3), runLab = runD == null ? 'Thin' : runD >= 2 ? 'Answers' : runD <= -3 ? 'Folds' : 'Holds';
    var behCls = cUp(behindD, 2, -3), behLab = behindD == null ? 'Thin' : behindD >= 2 ? 'Poised' : behindD <= -3 ? 'Presses' : 'Holds';
    var sg = function (d) { return d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(1); };
    var card = function (cls, lab, val, valLab, desc, aL, aV, bL, bV) {
      return "<div class='tsit-card " + cls + "'><div class='sl'>" + lab + "</div><div><span class='sbig'>" + val + "</span><span class='slab'>" + valLab + "</span></div><div class='sd'>" + desc + "</div>"
        + "<div class='sp'><div><span>" + aL + "</span><b>" + aV + "</b></div><div><span>" + bL + "</span><b>" + bV + "</b></div></div></div>";
    };
    var scores = "<div class='tsit-scores'>"
      + card(htOffCls, 'Halftime — Offense', sg(htOff), htOffLab, '2nd-half team eFG% vs 1st', '1st half', oe1 == null ? '—' : oe1.toFixed(1), '2nd half', oe2 == null ? '—' : oe2.toFixed(1))
      + card(htDefCls, 'Halftime — Defense', sg(htDef), htDefLab, 'Opponent 2nd-half eFG% vs 1st', 'Opp 1st', de1 == null ? '—' : de1.toFixed(1), 'Opp 2nd', de2 == null ? '—' : de2.toFixed(1))
      + card(runCls, 'Run Response', sg(runD), runLab, 'eFG% right after the opponent runs, vs baseline', 'After run', runE == null ? '—' : runE.toFixed(1), 'Base · n', (base == null ? '—' : base.toFixed(1)) + ' · ' + afterRun.length)
      + card(behCls, 'Poise Under Deficit', sg(behindD), behLab, 'eFG% while trailing 6+, vs baseline', 'Trailing 6+', behindE == null ? '—' : behindE.toFixed(1), 'Base · n', (base == null ? '—' : base.toFixed(1)) + ' · ' + behind.length)
      + "</div>";
    var adjOff = htOff != null && htOff >= 3, adjDef = htDef != null && htDef <= -3, frontRun = htOff != null && htOff <= -3;
    var role = (adjOff && adjDef) ? { lab: 'Adjusts on both ends', cls: 'g' } : (adjOff || adjDef) ? { lab: 'Halftime adjuster', cls: 'g' } : frontRun ? { lab: 'Front-runner', cls: 'a' } : { lab: 'Rides the tide', cls: 'n' };
    var parts = [];
    if (htOff != null) parts.push(htOff >= 3 ? "its offense comes out of the break <b>sharper</b> (eFG +" + htOff.toFixed(1) + ")" : htOff <= -3 ? "its offense is <b>best early</b> and cools after the half (eFG " + htOff.toFixed(1) + ")" : "its offense holds its level across halves");
    if (htDef != null) parts.push(htDef <= -3 ? "the defense <b>tightens</b> after the break (opp eFG " + htDef.toFixed(1) + ")" : htDef >= 3 ? "the defense <b>slips</b> late (opp eFG +" + htDef.toFixed(1) + ")" : "the defense holds steady");
    if (runD != null) parts.push(runD >= 2 ? "it <b>answers</b> opponent runs" : runD <= -3 ? "it tends to <b>fold</b> when the game turns" : "it steadies after runs");
    var read = "<div class='card' style='margin-top:12px'><div style='font-size:13px;line-height:1.6;color:var(--text2)'><span class='tsit-badge " + (role.cls === 'a' ? 'a' : role.cls) + "'>" + role.lab + "</span>" + esc(row.full) + " — " + parts.join(', ') + ".</div></div>";
    var mixRow = function (lbl, v1, v2) { var d = v2 - v1, cls = Math.abs(d) < 1.5 ? 'fl' : (d > 0 ? 'up' : 'dn');
      return "<div class='mr'><div>" + lbl + "</div><div class='mv'>" + v1.toFixed(0) + "%</div><div class='mv'>" + v2.toFixed(0) + "%</div><div class='md " + cls + "'>" + (d > 0 ? '+' : '') + d.toFixed(0) + "</div></div>"; };
    var mix = "<div class='sec-h'>What changes after halftime <span class='hint'>shot diet · 1st → 2nd half</span></div><div class='tsit-mix'>"
      + "<div class='mr'><div>Shot type</div><div class='mv'>1st</div><div class='mv'>2nd</div><div class='md'>shift</div></div>"
      + mixRow('Three-point rate', rate(oh1, is3), rate(oh2, is3))
      + mixRow('Rim rate', rate(oh1, isRim), rate(oh2, isRim)) + "</div>";
    return "<div class='sec-h' style='margin-top:22px'>Adjustment profile <span class='hint'>how they respond when the game turns · pooled all seasons</span></div>"
      + scores + read + mix;
  }

  async function section(row) {
    if (!row || !row.full) return '';
    var tid = await resolveTid(row); if (tid == null) return '';
    var off = await fetchAll('/rest/v1/shots?team_id=eq.' + tid + '&sec_left=not.is.null&select=game_id,espn_id,made,sv,stype,period,sec_left,home_score,away_score,season_year&order=season_year');
    if (off.length < 60) return '';
    var gids = Object.keys(off.reduce(function (a, s) { if (s.game_id != null) a[s.game_id] = 1; return a; }, {}));
    var def = [], side = {}, i, chunk;
    for (i = 0; i < gids.length; i += 80) { chunk = gids.slice(i, i + 80);
      def = def.concat(await fetchAll('/rest/v1/shots?game_id=in.(' + chunk.join(',') + ')&team_id=neq.' + tid + '&sec_left=not.is.null&select=game_id,period,sec_left,made,sv,home_score,away_score,season_year'));
    }
    for (i = 0; i < gids.length; i += 80) { chunk = gids.slice(i, i + 80);
      try { var gs = await fetch(SB + '/rest/v1/games?id=in.(' + chunk.join(',') + ')&select=id,home_id,away_id', { headers: H }).then(function (r) { return r.ok ? r.json() : []; });
        gs.forEach(function (g) { side[g.id] = (g.home_id === tid ? 1 : -1); }); } catch (e) {}
    }
    off.forEach(function (s) { if (side[s.game_id] != null && s.home_score != null) { s._t = (s.period - 1) * 1200 + (1200 - R(s.sec_left)); s._m = side[s.game_id] * (R(s.home_score) - R(s.away_score)); } });
    var clutchOff = off.filter(isClutch), ids = Object.keys(clutchOff.reduce(function (a, s) { if (s.espn_id != null) a[s.espn_id] = 1; return a; }, {})), NAME = {};
    await Promise.all(ids.slice(0, 30).map(function (id) {
      return fetch(SB + '/rest/v1/box_scores?espn_id=eq.' + id + '&select=player&order=season_year.desc&limit=1', { headers: H }).then(function (r) { return r.ok ? r.json() : []; }).then(function (r) { if (r && r[0]) NAME[id] = r[0].player; }).catch(function () {});
    }));
    ensureCss();
    var html = renderClutch(off, def, NAME) + renderAdjust(off, def, row);
    return html || '';
  }

  return { section: section };
})();
