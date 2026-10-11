/* tdc-aftermath.js — possession-level charts from ESPN play-by-play (scripts/build_shot_aftermath.mjs).
 *
 *   TDC_AFTER.chart(title, subtitleHtml, rows, opts)  -> html   one-series horizontal bars (diverging when asked)
 *   TDC_AFTER.stats(counts, leaguePPP)                 -> derived per-zone numbers (see shot-aftermath.html)
 *   TDC_AFTER.renderTeam(host, {teamId, season, name}) -> team page: how possessions start, when they shoot,
 *                                                          what each shot earns — offense and defense vs D-I
 *   TDC_AFTER.renderPlayer(host, {espn, season, name}) -> player page: his first-chance shots and what follows
 *
 * Data: scripts/data/shot_aftermath/{<y>,poss_<y>,players_<y>,index}.json. Every number is real points from
 * the play log; nothing is modelled. Bars: gold = scoring / a cost to you, blue = a benefit (validated palette).
 */
(function () {
  var BASE = 'scripts/data/shot_aftermath/', V = '?v=2';
  var ZN = { rim: 'Rim', short: 'Short mid', long: 'Long mid', three: 'Three', mid: 'Mid (no dist.)' }, ZALL = ['rim', 'short', 'long', 'three', 'mid'];
  var ST = { fg: 'After a made FG', ft: 'After made FTs', dr: 'After a def. rebound', to: 'After a turnover' }, STK = ['dr', 'to', 'fg', 'ft'];
  var TM = { tr: '0–10 s', early: '11–20 s', half: '21–30 s', late: '31+ s' }, TMK = ['tr', 'early', 'half', 'late'];
  var CACHE = {};
  function get(f) { return CACHE[f] || (CACHE[f] = fetch(BASE + f + V).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f3(v) { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3); }
  function p3(v) { return (v == null || !isFinite(v)) ? '—' : v.toFixed(3); }
  function pc(v) { return (v == null || !isFinite(v)) ? '—' : (100 * v).toFixed(1) + '%'; }
  function nf(v) { return (+v || 0).toLocaleString(); }
  function sl(y) { return (y - 1) + '–' + String(y).slice(2); }

  function css() {
    if (document.getElementById('aft-css')) return;
    var s = document.createElement('style'); s.id = 'aft-css';
    s.textContent =
      '.aft{--aft-pos:#B07D17;--aft-neg:#2F7FC1;}[data-theme="dark"] .aft{--aft-pos:#B8862A;--aft-neg:#3A8BCB;}' +
      '.aft-charts{display:grid;grid-template-columns:1fr 1fr;gap:26px 44px;}@media(max-width:860px){.aft-charts{grid-template-columns:1fr;}}' +
      '.aft-ch h3{font-size:17px;font-weight:800;margin:0 0 3px;color:var(--text);}.aft-ch .cs{font-size:12.5px;color:var(--text3);margin-bottom:10px;}' +
      '.aft-br{display:grid;grid-template-columns:var(--aft-lw,78px) 1fr;align-items:center;height:38px;}' +
      '.aft-br .lb{font-size:12.5px;font-weight:700;color:var(--text2);text-align:right;padding-right:10px;line-height:1.15;}' +
      '.aft-br .tr{position:relative;height:100%;}' +
      '.aft-br .bar{position:absolute;top:10px;height:18px;border-radius:0 4px 4px 0;}.aft-br .bar.n{border-radius:4px 0 0 4px;}' +
      '.aft-br .val{position:absolute;top:9px;line-height:20px;font-size:13.5px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap;background:var(--bg);padding:0 3px;border-radius:3px;z-index:1;}' +
      '.aft-br .ref{position:absolute;top:5px;height:28px;width:2px;background:var(--text);border-radius:1px;opacity:.75;}' +
      '.aft-br.thin .bar{opacity:.45;}' +
      '.aft-bars{position:relative;}.aft-zero{position:absolute;top:0;bottom:0;width:1px;background:var(--text3);}' +
      '.aft-axl,.aft-zl{position:relative;height:17px;margin-left:var(--aft-lw,78px);font-size:11px;color:var(--text3);}.aft-zl{font-size:11.5px;margin-bottom:3px;}' +
      '.aft-axl span,.aft-zl span{position:absolute;white-space:nowrap;}' +
      '.aft-key{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text2);margin:0 0 12px;}.aft-key i{display:inline-block;width:2px;height:13px;background:var(--text);vertical-align:-2px;margin-right:6px;opacity:.75;}' +
      '.aft-note{display:none;}' +   // owner rule (Sept 2026): no explanatory footnotes under charts (tdc-skin.css)
      '.aft-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;}' +
      '.aft-top select{font:600 12.5px Inter,system-ui,sans-serif;padding:5px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--bg2);color:var(--text);}' +
      '.aft-sub{font-size:13px;color:var(--text2);}.aft-sub b{color:var(--text);}' +
      '.aft-empty{padding:22px;text-align:center;color:var(--text3);font-size:13px;}' +
      '.aft-tip{position:fixed;z-index:9999;pointer-events:none;background:var(--bg);border:1px solid var(--border2);border-radius:8px;padding:8px 10px;font-size:12.5px;line-height:1.45;color:var(--text2);box-shadow:0 6px 18px rgba(0,0,0,.18);max-width:270px;display:none;}.aft-tip b{color:var(--text);}' +
      '.aft-tbl{margin-top:14px;}';
    document.head.appendChild(s);
    var tip = document.createElement('div'); tip.className = 'aft-tip'; tip.id = 'aftTip'; document.body.appendChild(tip);
    document.addEventListener('mousemove', function (e) {
      var t = e.target.closest && e.target.closest('[data-aft-tip]');
      if (!t || !t.getAttribute('data-aft-tip')) { tip.style.display = 'none'; return; }
      tip.innerHTML = t.getAttribute('data-aft-tip'); tip.style.display = 'block';
      tip.style.left = Math.min(innerWidth - tip.offsetWidth - 10, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    });
  }

  // one-series horizontal bars; opts: {diverge, base, fmt, axfmt, zeroLabel, color(v), lw}
  function chart(title, subtitle, rows, o) {
    o = o || {};
    var vals = []; rows.forEach(function (r) { [r.v, r.ref].forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); }); });
    var base = o.base || 0, lo, hi;
    if (o.diverge) { var m = 0; vals.forEach(function (v) { m = Math.max(m, Math.abs(v - base)); }); m = (m * 1.25) || 0.05; lo = base - m; hi = base + m; }
    else { lo = 0; hi = (Math.max.apply(null, vals.concat([base])) * 1.3) || 1; }
    var X = function (v) { return 100 * (v - lo) / (hi - lo); }, zx = X(base), fmt = o.fmt || f3, lw = o.lw || 78;
    var body = rows.map(function (r) {
      if (r.v == null || !isFinite(r.v)) return '<div class="aft-br"><div class="lb">' + esc(r.label) + '</div><div class="tr"><span class="val" style="left:' + (zx + 1) + '%">—</span></div></div>';
      var x = X(r.v), neg = r.v < base, l = Math.min(x, zx), w = Math.abs(x - zx);
      var col = o.color ? o.color(r.v) : (neg ? 'var(--aft-neg)' : 'var(--aft-pos)');
      var lab = neg ? (x < 20 ? 'left:' + (zx + 1) + '%' : 'right:' + (100 - x + 1) + '%') : 'left:' + (x + 1) + '%';
      var ref = (r.ref != null && isFinite(r.ref)) ? '<i class="ref" style="left:calc(' + X(r.ref) + '% - 1px)"></i>' : '';
      return '<div class="aft-br' + (r.thin ? ' thin' : '') + '"><div class="lb">' + esc(r.label) + '</div><div class="tr" data-aft-tip="' + esc(r.tip || '') + '">' +
        '<i class="bar' + (neg ? ' n' : '') + '" style="left:' + l + '%;width:' + Math.max(w, 0.4) + '%;background:' + col + '"></i>' + ref +
        '<span class="val" style="' + lab + '">' + fmt(r.v) + '</span></div></div>';
    }).join('');
    var ax = [lo, base, hi].filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) {
      var xp = X(v), tf = xp <= 1 ? 'translateX(0)' : xp >= 99 ? 'translateX(-100%)' : 'translateX(-50%)';
      return '<span style="left:' + xp + '%;transform:' + tf + '">' + (o.axfmt ? o.axfmt(v) : fmt(v)) + '</span>';
    }).join('');
    return '<div class="aft-ch" style="--aft-lw:' + lw + 'px"><h3>' + esc(title) + '</h3><div class="cs">' + subtitle + '</div>' +
      '<div class="aft-zl"><span style="left:' + zx + '%;transform:translateX(-50%)">' + esc(o.zeroLabel || 'Zero points') + '</span></div>' +
      '<div class="aft-bars"><div class="aft-zero" style="left:calc(' + lw + 'px + (100% - ' + lw + 'px) * ' + (zx / 100) + ')"></div>' + body + '</div><div class="aft-axl">' + ax + '</div></div>';
  }
  function table(head, rows) {
    return '<div class="sheet-wrap aft-tbl" style="max-height:none;"><table class="sheet dense"><thead><tr>' + head.map(function (h, i) { return '<th class="' + (i ? '' : 'l') + '">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td class="' + (i ? '' : 'l') + '">' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }

  function stats(c, lg) {
    var att = c[0], made = c[1], mPts = c[2], miss = c[3], mOR = c[4], mDR = c[5], sc = c[6], oMP = c[7], oMN = c[8], oDP = c[9], oDN = c[10];
    if (!att) return null;
    var mk = made / att, ms = miss / att, pM = oMN ? oMP / oMN : null, pD = oDN ? oDP / oDN : null, drf = miss ? mDR / miss : 0, orf = miss ? mOR / miss : 0;
    var madePA = mPts / att, scPM = miss ? sc / miss : 0, scPA = sc / att, own = madePA + scPA;
    var missCost = (pD != null) ? drf * (pD - lg) : 0, mkCost = (pM != null) ? (pM - lg) : 0, cost = mk * mkCost + ms * missCost;
    return { att: att, made: made, miss: miss, mOR: mOR, mDR: mDR, mk: mk, ms: ms, orf: orf, drf: drf, pM: pM, pD: pD, oMN: oMN, oDN: oDN,
      madePA: madePA, scPM: scPM, scPA: scPA, own: own, cost: cost, net: own - cost, missCost: missCost, netMiss: scPM - missCost, other: miss ? 1 - orf - drf : 0 };
  }
  function zeros() { var z = {}; ZALL.forEach(function (k) { z[k] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }); return z; }
  function addInto(z, src) { for (var k in src) if (z[k]) src[k].forEach(function (v, i) { z[k][i] += v; }); }
  function zonesShown(all) { var tot = 0; ZALL.forEach(function (z) { tot += all[z][0]; }); return ZALL.filter(function (z) { return z === 'mid' ? all[z][0] >= 0.02 * tot : all[z][0] > 0; }); }
  var KEY = '<div class="aft-key"><span><i></i>D-I average</span></div>';

  function seasonSel(id, seasons, cur) {
    return '<select id="' + id + '" aria-label="Season">' + seasons.map(function (y) { return '<option value="' + y + '"' + (y === cur ? ' selected' : '') + '>' + sl(y) + '</option>'; }).join('') + '</select>';
  }
  function seasonsList() { return get('index.json').then(function (ix) { return (ix && ix.seasons ? ix.seasons.map(function (s) { return s.season; }) : [2026]).sort(function (a, b) { return b - a; }); }); }

  // ── TEAM ────────────────────────────────────────────────────────────────
  function renderTeam(host, o) {
    if (!host) return; css(); o = o || {};
    host.classList.add('aft');
    host.innerHTML = '<div class="aft-empty">Loading every possession…</div>';
    seasonsList().then(function (seasons) {
      var y = o.season && seasons.indexOf(o.season) >= 0 ? o.season : seasons[0];
      return Promise.all([get('poss_' + y + '.json'), get(y + '.json'), get('sit_' + y + '.json')]).then(function (r) { drawTeam(host, o, y, seasons, r[0], r[1], r[2]); });
    });
  }
  function ppp(a) { return a && a[0] ? a[1] / a[0] : null; }
  function drawTeam(host, o, y, seasons, P, S, SIT) {
    var tid = String(o.teamId || '');
    var T = P && P.teams && P.teams[tid];
    var top = '<div class="aft-top"><div class="aft-sub">' + esc(o.name || 'This team') + ' · <b>' + sl(y) + '</b>' + (T ? ' · ' + nf(sumN(T.off.st)) + ' offensive possessions' : '') + '</div>' + seasonSel('aftTeamSeason', seasons, y) + '</div>';
    if (!T || !S) { host.innerHTML = top + '<div class="aft-empty">No play-by-play for this team in ' + sl(y) + '.</div>'; wire(); return; }
    var lg = P.league_ppp, L = P.league, nG = sumN(L.st);
    // 1 · how possessions start
    var rowsSt = function (side) {
      return STK.map(function (k) {
        var a = T[side].st[k], v = ppp(a), ref = ppp(L.st[k]), n = a ? a[0] : 0, share = n / Math.max(1, sumN(T[side].st));
        return { label: ST[k].replace('After a ', '').replace('After ', ''), v: v, ref: ref, thin: n < 40,
          tip: '<b>' + ST[k] + '</b><br>' + nf(n) + ' possessions (' + pc(share) + ' of them) · <b>' + p3(v) + '</b> PPP<br>D-I: ' + p3(ref) + ' · league ' + p3(lg) };
      });
    };
    var cOpt = { diverge: true, base: lg, fmt: p3, axfmt: p3, zeroLabel: 'League ' + p3(lg), lw: 92 };
    var h = '<div class="dA-sec" style="margin:4px 0 6px"><span>How possessions start</span><span class="dA-cap">points per possession by what gave them the ball</span></div>' + KEY +
      '<div class="aft-charts">' +
      chart('Offense', 'Points per possession · more is better', rowsSt('off'), Object.assign({}, cOpt, { color: function (v) { return v > lg ? 'var(--aft-pos)' : 'var(--aft-neg)'; } })) +
      chart('Defense', 'Opponent points per possession · less is better', rowsSt('def'), Object.assign({}, cOpt, { color: function (v) { return v > lg ? 'var(--aft-pos)' : 'var(--aft-neg)'; } })) +
      '</div>';
    h += table(['Possession starts', 'Offense share', 'Offense PPP', 'Defense share', 'Opp. PPP', 'D-I share', 'D-I PPP'],
      STK.map(function (k) { return [ST[k], pc(n(T.off.st[k]) / Math.max(1, sumN(T.off.st))), '<b>' + p3(ppp(T.off.st[k])) + '</b>', pc(n(T.def.st[k]) / Math.max(1, sumN(T.def.st))), '<b>' + p3(ppp(T.def.st[k])) + '</b>', pc(n(L.st[k]) / Math.max(1, nG)), p3(ppp(L.st[k]))]; }));
    // 2 · when they shoot
    var nT = sumN(L.tm);
    var rowsShare = function (side) { var tot = sumN(T[side].tm); return TMK.map(function (k) { var a = T[side].tm[k], v = n(a) / Math.max(1, tot), ref = n(L.tm[k]) / Math.max(1, nT);
      return { label: TM[k], v: v, ref: ref, tip: '<b>' + TM[k] + ' into the possession</b><br>' + nf(n(a)) + ' possessions · ' + pc(v) + ' of them · D-I ' + pc(ref) }; }); };
    var rowsTm = function (side) { return TMK.map(function (k) { var a = T[side].tm[k], v = ppp(a), ref = ppp(L.tm[k]);
      return { label: TM[k], v: v, ref: ref, thin: n(a) < 40, tip: '<b>First shot / FT trip / turnover ' + TM[k] + ' in</b><br>' + nf(n(a)) + ' possessions · <b>' + p3(v) + '</b> PPP · D-I ' + p3(ref) }; }); };
    var col = function (v) { return v > lg ? 'var(--aft-pos)' : 'var(--aft-neg)'; };
    h += '<div class="dA-sec" style="margin:26px 0 6px"><span>When they shoot</span><span class="dA-cap">seconds from getting the ball to the first shot, free-throw trip or turnover</span></div>' + KEY +
      '<div class="aft-charts">' +
      chart('Offense: how fast', 'Share of possessions', rowsShare('off'), { fmt: pc, axfmt: pc, zeroLabel: '0%', color: function () { return 'var(--aft-pos)'; } }) +
      chart('Offense: what it scores', 'Points per possession · more is better', rowsTm('off'), Object.assign({}, cOpt, { lw: 78, color: col })) +
      chart('Defense: how fast opponents go', 'Share of opponent possessions', rowsShare('def'), { fmt: pc, axfmt: pc, zeroLabel: '0%', color: function () { return 'var(--aft-neg)'; } }) +
      chart('Defense: what opponents score', 'Opponent points per possession · less is better', rowsTm('def'), Object.assign({}, cOpt, { lw: 78, color: col })) +
      '</div><div class="aft-note">0–10 seconds is transition; 21–30 is a set half-court possession; 31+ is the end of the shot clock. Timing is from the play-by-play clock (rebound, turnover or made basket to the first action), so it is approximate.</div>';
    // 3 · what each shot earns (the Shot Aftermath for this team, vs D-I)
    var cur = zeros(), all = zeros();
    for (var t in S.data) for (var g in S.data[t]) { addInto(all, S.data[t][g]); if (t === tid) addInto(cur, S.data[t][g]); }
    var Z = zonesShown(all), st = {}, ref = {};
    Z.forEach(function (z) { st[z] = stats(cur[z], lg); ref[z] = stats(all[z], lg); });
    var R = function (k, tf) { return Z.map(function (z) { var s = st[z], r = ref[z]; return { label: ZN[z], v: s ? s[k] : null, ref: r ? r[k] : null, thin: s && s.att < 60,
      tip: s ? '<b>' + ZN[z] + '</b> · ' + nf(s.att) + ' first-chance attempts<br>' + tf(s) + '<br>D-I: ' + (k === 'cost' ? f3(r[k]) : p3(r[k])) : '' }; }); };
    h += '<div class="dA-sec" style="margin:26px 0 6px"><span>What each shot earns</span><span class="dA-cap">per first-chance attempt · <a href="shot-aftermath.html" style="color:inherit">full Shot Aftermath</a></span></div>' + KEY +
      '<div class="aft-charts">' +
      chart('Own scoring', 'Made FGs + second chances · more is better', R('own', function (s) { return 'FG ' + pc(s.mk) + ' · made ' + p3(s.madePA) + ' + second chances ' + p3(s.scPA); }), { fmt: p3 }) +
      chart('Scoring minus cost', 'Own scoring − the opponent’s next possession above average', R('net', function (s) { return p3(s.own) + ' − (' + f3(s.cost) + ') = <b>' + p3(s.net) + '</b>'; }), { fmt: p3 }) +
      '</div>';
    h += table(['Shot', 'Attempts', 'FG%', 'Offense gets the miss back', 'Second-chance pts / miss', 'Opp. PPP after the make', 'Opp. PPP after the def. rebound', 'Net / attempt'],
      Z.filter(function (z) { return st[z]; }).map(function (z) { var s = st[z]; return [ZN[z], nf(s.att), pc(s.mk), pc(s.orf), p3(s.scPM), p3(s.pM), p3(s.pD), '<b>' + p3(s.net) + '</b>']; }));
    h += situationsHtml(SIT, tid, lg);
    h += '<div class="aft-note">From ESPN play-by-play of every D-I vs D-I game; possessions are rebuilt from the play log. Faded bars are small samples. League average: ' + p3(lg) + ' points per possession.</div>';
    host.innerHTML = top + h; wire();
    function wire() { var s = document.getElementById('aftTeamSeason'); if (s) s.onchange = function () { renderTeam(host, Object.assign({}, o, { season: +s.value })); }; }
  }
  // ── game situations: timeouts, half starts, late & close, margin, runs, fouls & bonus ──
  var SK = ['ato', 'tvto', 'start1', 'start2', 'close', 'lead10', 'trail10', 'afterrun'];
  var SL = { ato: 'Own timeout', tvto: 'Media timeout', start1: 'Game start', start2: '2nd-half start', close: 'Late & close', lead10: 'Up 10+', trail10: 'Down 10+', afterrun: 'After an 8-0' };
  var SD = { ato: 'first possession out of their own timeout', tvto: 'first possession out of a media timeout', start1: 'first 4:00 of the game', start2: 'first 4:00 of the second half',
    close: 'last 4:00 of the second half or OT, within 5', lead10: 'leading by 10 or more', trail10: 'trailing by 10 or more', afterrun: 'right after the opponent scored 8+ straight' };
  var BK = ['nobonus', 'bonus1', 'bonus2'], BL = { nobonus: 'No bonus', bonus1: 'One-and-one', bonus2: 'Double bonus' };
  function situationsHtml(SIT, tid, lg) {
    var T = SIT && SIT.teams && SIT.teams[tid]; if (!T) return '';
    var L = SIT.league, col = function (v) { return v > lg ? 'var(--aft-pos)' : 'var(--aft-neg)'; };
    var opt = { diverge: true, base: lg, fmt: p3, axfmt: p3, zeroLabel: 'League ' + p3(lg), lw: 104, color: col };
    var rows = function (side, keys, lab, desc) { return keys.map(function (k) { var a = T[side][k], v = ppp(a), ref = ppp(L.sit[k]);
      return { label: (side === 'def' && k === 'ato') ? 'Their timeout' : lab[k], v: a && a[0] >= 8 ? v : null, ref: ref, thin: n(a) < 30,
        tip: '<b>' + (desc ? desc[k] : lab[k]) + '</b><br>' + nf(n(a)) + ' possessions · <b>' + p3(v) + '</b> PPP · D-I ' + p3(ref) }; }); };
    var h = '<div class="dA-sec" style="margin:26px 0 6px"><span>Game situations</span><span class="dA-cap">points per possession by the moment it started in</span></div>' + KEY +
      '<div class="aft-charts">' +
      chart('Offense', 'Points per possession · more is better', rows('off', SK, SL, SD), opt) +
      chart('Defense', 'Opponent points per possession · less is better', rows('def', SK, SL, SD), opt) + '</div>';
    var g = Math.max(1, T.g), run = T.run8 / g, runA = T.run8a / g;
    h += '<div class="dA-sec" style="margin:26px 0 6px"><span>Runs, fouls &amp; the bonus</span><span class="dA-cap">per game · the bonus is the 7th team foul of a half</span></div>' + KEY +
      '<div class="aft-charts">' +
      chart('8-0 runs', 'Runs of 8+ unanswered points per game', [
        { label: 'They go on', v: run, ref: L.run8, tip: '<b>' + nf(T.run8) + '</b> runs of 8-0 or better in ' + nf(T.g) + ' games · D-I ' + L.run8.toFixed(2) + ' per game' },
        { label: 'They allow', v: runA, ref: L.run8, tip: '<b>' + nf(T.run8a) + '</b> opponent 8-0 runs in ' + nf(T.g) + ' games · D-I ' + L.run8.toFixed(2) + ' per game' }],
        { fmt: function (v) { return v.toFixed(2); }, axfmt: function (v) { return v.toFixed(1); }, zeroLabel: '0', lw: 92, color: function () { return 'var(--aft-pos)'; } }) +
      chart('Fouls', 'Team fouls per game, and minutes left in the half when they put the opponent in the bonus', [
        { label: 'Fouls / game', v: T.fouls / g, ref: L.fouls, tip: '<b>' + (T.fouls / g).toFixed(1) + '</b> team fouls per game · D-I ' + L.fouls.toFixed(1) },
        { label: 'Bonus at', v: T.bonusAt != null ? T.bonusAt / 60 : null, ref: L.bonusAt != null ? L.bonusAt / 60 : null,
          tip: 'Opponent reached the bonus in <b>' + nf(T.bonusN) + '</b> of ' + nf(T.g * 2) + ' halves, on average with <b>' + (T.bonusAt != null ? mmss(T.bonusAt) : '—') + '</b> left · D-I ' + (L.bonusAt != null ? mmss(L.bonusAt) : '—') }],
        { fmt: function (v) { return v.toFixed(1); }, axfmt: function (v) { return v.toFixed(0); }, zeroLabel: '0', lw: 92, color: function () { return 'var(--aft-pos)'; } }) +
      chart('Offense in the bonus', 'Points per possession by the opponent’s team fouls', rows('off', BK, BL), opt) +
      chart('Defense in the bonus', 'Opponent points per possession by their team fouls', rows('def', BK, BL), opt) + '</div>';
    h += table(['Situation', 'Off. possessions', 'Off. PPP', 'Def. possessions', 'Opp. PPP', 'D-I PPP'],
      SK.concat(BK).map(function (k) { var lab = k === 'ato' ? 'Own timeout (off.) / their timeout (def.)' : (SL[k] || BL[k]); return [lab, nf(n(T.off[k])), '<b>' + p3(ppp(T.off[k])) + '</b>', nf(n(T.def[k])), '<b>' + p3(ppp(T.def[k])) + '</b>', p3(ppp(L.sit[k]))]; }));
    h += '<div class="aft-note">A possession counts as "out of a timeout" when the timeout came after the ball changed hands and before the first shot, free-throw trip or turnover. Late &amp; close is the last 4:00 of the second half or overtime with the margin at 5 or less. The bonus counts team fouls in the half (overtime carries the second half). Situations overlap: a late, close possession out of a timeout counts in all three.</div>';
    return h;
  }
  function mmss(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function n(a) { return a ? a[0] : 0; }
  function sumN(o) { var s = 0; for (var k in o) s += o[k][0]; return s; }

  // ── PLAYER ──────────────────────────────────────────────────────────────
  function renderPlayer(host, o) {
    if (!host) return; css(); o = o || {};
    host.classList.add('aft');
    host.innerHTML = '<div class="aft-empty">Loading his shots…</div>';
    seasonsList().then(function (seasons) {
      var y = o.season && seasons.indexOf(o.season) >= 0 ? o.season : seasons[0];
      return Promise.all([get('players_' + y + '.json'), get(y + '.json')]).then(function (r) {
        var D = r[0], e = String(o.espn || '');
        if ((!D || !D.data[e]) && !o.season && seasons.length > 1) {   // no line this season (a freshman before his first game): his latest
          var tryNext = function (i) { if (i >= seasons.length) return drawPlayer(host, o, y, seasons, D, r[1]);
            get('players_' + seasons[i] + '.json').then(function (d2) { if (d2 && d2.data[e]) { get(seasons[i] + '.json').then(function (s2) { drawPlayer(host, o, seasons[i], seasons, d2, s2); }); } else tryNext(i + 1); }); };
          return tryNext(1);
        }
        drawPlayer(host, o, y, seasons, D, r[1]);
      });
    });
  }
  function drawPlayer(host, o, y, seasons, D, S) {
    var e = String(o.espn || ''), mine = D && D.data[e], g = D && D.pos[e];
    var gl = { G: 'guards', F: 'forwards', C: 'centers' }[g] || 'D-I players';
    var top = '<div class="aft-top"><div class="aft-sub"><b>' + sl(y) + '</b>' + (mine ? ' · vs D-I ' + gl : '') + '</div>' + seasonSel('aftPlSeason', seasons, y) + '</div>';
    var wire = function () { var s = document.getElementById('aftPlSeason'); if (s) s.onchange = function () { renderPlayer(host, Object.assign({}, o, { season: +s.value })); }; };
    if (!mine || !S) { host.innerHTML = top + '<div class="aft-empty">No first-chance shots for him in ' + sl(y) + '.</div>'; wire(); return; }
    var lg = S.league_ppp, cur = zeros(), base = zeros();
    addInto(cur, mine);
    for (var t in S.data) for (var gg in S.data[t]) if (!g || gg === g) addInto(base, S.data[t][gg]);
    var Z = zonesShown(base).filter(function (z) { return cur[z][0] > 0; }), st = {}, ref = {};
    Z.forEach(function (z) { st[z] = stats(cur[z], lg); ref[z] = stats(base[z], lg); });
    var tot = 0; Z.forEach(function (z) { tot += st[z].att; });
    var R = function (k, tf, f, minMiss) { f = f || p3; return Z.map(function (z) { var s = st[z], r = ref[z]; return { label: ZN[z], v: (minMiss && s.miss < minMiss) ? null : s[k], ref: r ? r[k] : null, thin: s.att < 25,
      tip: '<b>' + ZN[z] + '</b> · ' + nf(s.att) + ' attempts (' + pc(s.att / tot) + ' of his)<br>' + tf(s) + '<br>D-I ' + gl + ': ' + f(r[k]) }; }); };
    var h = KEY + '<div class="aft-charts">' +
      chart('Points per attempt', 'His makes + the second chances his misses produced · more is better', R('own', function (s) { return 'FG ' + pc(s.mk) + ' · made ' + p3(s.madePA) + ' + second chances ' + p3(s.scPA); }), { fmt: p3 }) +
      chart('After his misses', 'Second-chance points per miss − the opponent’s edge off the rebound', R('netMiss', function (s) { return pc(s.orf) + ' of his misses came back to his team (' + p3(s.scPM) + ' per miss) · opponents then scored ' + p3(s.pD) + ' PPP off the rest'; }, f3, 10), { fmt: f3 }) +
      '</div>';
    h += table(['Shot', 'Attempts', 'Share', 'FG%', 'D-I ' + gl, 'Points / attempt', 'D-I ' + gl, 'His team gets the miss back', 'Opp. PPP after his miss'],
      Z.map(function (z) { var s = st[z], r = ref[z]; return [ZN[z], nf(s.att), pc(s.att / tot), '<b>' + pc(s.mk) + '</b>', pc(r.mk), '<b>' + p3(s.own) + '</b>', p3(r.own), (s.miss >= 10 ? pc(s.orf) : '<span class="small">' + pc(s.orf) + '</span>'), (s.miss >= 10 ? p3(s.pD) : '<span class="small">' + p3(s.pD) + '</span>')]; }));
    h += '<div class="aft-note">Zones with fewer than 10 misses are left off the miss chart and greyed in the table. First-chance attempts only (before his team’s first offensive rebound of the possession), from ESPN play-by-play. Points per attempt counts his made baskets plus everything his team scored after rebounding his misses. League average: ' + p3(lg) + ' points per possession.</div>';
    host.innerHTML = top + h; wire();
  }

  window.TDC_AFTER = { chart: chart, stats: stats, table: table, css: css, renderTeam: renderTeam, renderPlayer: renderPlayer, ZN: ZN };
})();
