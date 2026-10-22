/* tdc-gametabs.js — the game recap layout shared by game.html and scrimmage.html (Oct 2026, owner: "a lot of text and
 * messy … we need more labels or pages in the page"). Two pieces:
 *
 *   TDCGameTabs.strip(cells)            the flat stat ribbon under the score band (last season's recap top);
 *                                       cells = [{v, k, s, tip}]  → HTML
 *   TDCGameTabs.mount(host, tabs, opt)  chip tabs (team page style) + one panel per tab;
 *                                       tabs = [{id, label, html, onShow(panel)}] — a tab with no html and no
 *                                       onShow is skipped. onShow runs the first time its panel is visible, so
 *                                       charts that measure their width (tdc-gameflow) draw at the right size.
 *                                       The open tab rides in the URL hash (#box) so a link opens that tab.
 *                                       Returns {show(id), panel(id), drop(id)}.
 */
(function () {
  var CSS =
    '.gm-strip{display:grid;grid-template-columns:repeat(var(--gm-n,5),minmax(0,1fr));border:1px solid var(--border);background:var(--bg);margin:12px 0 4px;}' +
    '.gm-strip .t{padding:14px 18px 13px;border-right:1px solid var(--border);min-width:0;}' +
    '.gm-strip .t:last-child{border-right:none;}' +
    '.gm-strip .v{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:24px;letter-spacing:-.01em;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;}' +
    '.gm-strip .k{font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-top:6px;white-space:nowrap;}' +
    '.gm-strip .s{font-size:11px;color:var(--text3);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.gm-strip [title]{cursor:help;}' +
    '.gm-strip.few{display:inline-grid;grid-template-columns:repeat(var(--gm-n,1),minmax(190px,auto));}' +
    '@media(max-width:760px){.gm-strip{grid-template-columns:repeat(3,minmax(0,1fr));}.gm-strip .t{border-bottom:1px solid var(--border);padding:9px 10px;}.gm-strip .v{font-size:18px;}.gm-strip .s{display:none;}}' +
    '.gt-bar{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 4px;padding-bottom:14px;border-bottom:1px solid var(--border);}' +
    '.gt-tab{font-family:Inter,system-ui,sans-serif;background:var(--bg);border:1px solid var(--border2);border-radius:999px;color:var(--text2);padding:6px 13px;font-size:12px;font-weight:600;cursor:pointer;transition:border-color .12s,color .12s,background .12s;}' +
    '.gt-tab:hover{border-color:var(--text3);color:var(--text);}' +
    '.gt-tab.on{background:var(--text);color:var(--bg);border-color:var(--text);}' +
    '.gt-tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}' +
    '.gt-panel{display:none;}.gt-panel.on{display:block;}' +
    '.gt-panel>:first-child{margin-top:14px!important;}' +
    /* a labelled section inside a panel: small caps label + one-line hint, no paragraphs */
    '.gt-h{display:flex;align-items:baseline;gap:12px;margin:26px 0 10px;padding-bottom:7px;border-bottom:1px solid var(--border2);}' +
    '.gt-h h2{font-family:"Playfair Display",serif;font-size:19px;font-weight:800;margin:0;}' +
    '.gt-h .hint{margin-left:auto;font-size:11.5px;color:var(--text3);text-align:right;}' +
    '.gt-h img{width:22px;height:22px;object-fit:contain;align-self:center;}' +
    /* label : value rows (replaces the explanatory paragraphs) */
    '.gt-kv{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;border:1px solid var(--border);background:var(--bg);margin:12px 0 4px;}' +
    '.gt-kv>div{padding:9px 14px;border-bottom:1px solid var(--border);font-size:13px;line-height:1.45;}' +
    '.gt-kv>div:nth-last-child(-n+2){border-bottom:none;}' +
    '.gt-kv .k{font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);padding-top:12px;background:var(--bg2);}' +
    '.gt-kv .v{color:var(--text2);} .gt-kv .v b{color:var(--text);}' +
    '.gt-lead{width:100%!important;table-layout:fixed;} .gt-lead th:first-child{width:110px;} .gt-lead td a{color:var(--text);text-decoration:none;} .gt-lead td a:hover{color:var(--accent);}' +
    '.gt-list{margin:10px 0 0 18px;font-size:12.5px;color:var(--text2);line-height:1.7;} .gt-list b{color:var(--text);}' +
    '@media(max-width:620px){.gt-bar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;}.gt-bar::-webkit-scrollbar{display:none;}.gt-tab{flex:0 0 auto;}.gt-kv{grid-template-columns:1fr;}.gt-kv .k{padding-bottom:0;border-bottom:none;}}';

  function css() {
    if (document.getElementById('gt-css')) return;
    var s = document.createElement('style'); s.id = 'gt-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function strip(cells) {
    css();
    cells = (cells || []).filter(Boolean);
    return '<div class="gm-strip' + (cells.length < 3 ? ' few' : '') + '" style="--gm-n:' + cells.length + '">' + cells.map(function (c) {
      return '<div class="t"' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '><div class="v">' + c.v + '</div><div class="k">' + c.k +
        '</div><div class="s">' + (c.s || '&nbsp;') + '</div></div>';
    }).join('') + '</div>';
  }

  // label : value rows — [[label, valueHtml], …]; empty values are dropped
  function kv(rows) {
    css();
    rows = (rows || []).filter(function (r) { return r && r[1]; });
    if (!rows.length) return '';
    return '<div class="gt-kv">' + rows.map(function (r) { return '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div>'; }).join('') + '</div>';
  }
  function head(title, hint, logo) {
    return '<div class="gt-h">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '') + '<h2>' + title + '</h2>' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
  }

  // TEAM LEADERS — sides = [{name, players:[{name, href, pts, reb, ast, min}]}] (away first). Points / rebounds /
  // assists leader per team; two tied → both names, three+ → "3 tied".
  function leaders(sides) {
    css();
    sides = (sides || []).filter(function (s) { return s && (s.players || []).length; });
    if (!sides.length) return '';
    var cats = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists']];
    var nm = function (p) { return p.href ? '<a href="' + esc(p.href) + '">' + esc(p.name) + '</a>' : esc(p.name); };
    var cell = function (ps, k) {
      var pl = ps.filter(function (p) { return p[k] != null && (p.min == null || p.min > 0); });
      var top = Math.max.apply(null, pl.map(function (p) { return +p[k] || 0; }).concat([0]));
      if (!top) return '<td class="l dim">—</td>';
      var who = pl.filter(function (p) { return (+p[k] || 0) === top; });
      return '<td class="l">' + (who.length > 2 ? who.length + ' tied' : who.map(nm).join(', ')) + ' <b>' + top + '</b></td>';
    };
    return head('Team leaders') + '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense gt-lead"><thead><tr><th class="l"></th>' +
      sides.map(function (s) { return '<th class="l">' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      cats.map(function (c) { return '<tr><td class="l dim">' + c[1] + '</td>' + sides.map(function (s) { return cell(s.players, c[0]); }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }

  // KEY MOMENTS from the play-by-play (tdc-gameflow parse + crunch): largest leads, the best run (with when it
  // happened), time leading, lead changes and ties. nm(team key) → display name.
  function moments(G, R, nm) {
    if (!G || !R || !R.flow || R.flow.length < 2) return '';
    var H = G.home, A = G.away, C = R.C || {}, F = R.flow;
    nm = nm || function (t) { return (G.T[t] && G.T[t].name) || t; };
    var clock = function (e) {   // elapsed seconds → "11:57 1st half"
      var per, left;
      if (e < 1200) { per = '1st half'; left = 1200 - e; } else if (e < 2400) { per = '2nd half'; left = 2400 - e; }
      else { var o = Math.floor((e - 2400) / 300); per = (o ? (o + 1) : '') + 'OT'; left = 300 - (e - 2400 - o * 300); }
      left = Math.max(0, Math.round(left));
      return { per: per, t: Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2) };
    };
    var mmss = function (s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); };
    // best run, with its start and end
    var best = null, cur = null;
    for (var i = 1; i < F.length; i++) {
      var d = F[i][1] - F[i - 1][1]; if (!d) continue;
      var tm = d > 0 ? H : A;
      if (cur && cur.t === tm) { cur.p += Math.abs(d); cur.e = F[i][0]; }
      else { cur = { t: tm, p: Math.abs(d), s: F[i - 1][0], e: F[i][0] }; }
      if (!best || cur.p > best.p) best = { t: cur.t, p: cur.p, s: cur.s, e: cur.e };
    }
    // lead changes + ties
    var sign = 0, changes = 0, ties = 0;
    F.forEach(function (f, j) { var s = f[1] > 0 ? 1 : f[1] < 0 ? -1 : 0;
      if (s && sign && s !== sign) changes++;
      if (!s && sign && j > 0) ties++;
      if (s) sign = s; });
    var lead = function (t) { var v = (C[t] || {}).lead || 0; return v > 0 ? '<b>' + esc(nm(t)) + ' by ' + v + '</b>' : ''; };
    var leads = [lead(A), lead(H)].filter(Boolean);
    var run = '';
    if (best && best.p >= 4) { var a = clock(best.s), b = clock(best.e);
      run = '<b>' + best.p + '–0 ' + esc(nm(best.t)) + '</b> · ' + a.t + (a.per !== b.per ? ' ' + a.per : '') + ' to ' + b.t + ' of the ' + b.per; }
    var led = [[A, (C[A] || {}).led || 0], [H, (C[H] || {}).led || 0]];
    return head('Key moments', 'from the play-by-play') + kv([
      ['Largest lead', leads.join(' · ')],
      ['Best run', run],
      ['Time leading', led.map(function (x) { return esc(nm(x[0])) + ' ' + mmss(x[1]); }).join(' · ')],
      ['Lead changes', changes + (changes === 1 ? ' lead change' : ' lead changes') + ' · ' + ties + (ties === 1 ? ' tie' : ' ties')],
    ]);
  }

  function mount(host, tabs, opt) {
    css(); opt = opt || {};
    tabs = (tabs || []).filter(function (t) { return t && (t.html || t.onShow); });
    var shown = {};
    host.innerHTML = '<div class="gt-bar" role="tablist">' + tabs.map(function (t) {
      return '<button class="gt-tab" role="tab" data-t="' + t.id + '" aria-controls="gt-' + t.id + '">' + t.label + '</button>';
    }).join('') + '</div>' + tabs.map(function (t) {
      return '<div class="gt-panel" role="tabpanel" id="gt-' + t.id + '" data-t="' + t.id + '">' + (t.html || '') + '</div>';
    }).join('');
    var byId = {}; tabs.forEach(function (t) { byId[t.id] = t; });
    function panel(id) { return host.querySelector('.gt-panel[data-t="' + id + '"]'); }
    function show(id, fromHash) {
      if (!byId[id]) id = tabs.length ? tabs[0].id : null;
      if (!id) return;
      host.querySelectorAll('.gt-tab').forEach(function (b) { var on = b.getAttribute('data-t') === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      host.querySelectorAll('.gt-panel').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-t') === id); });
      if (!shown[id] && byId[id].onShow) { shown[id] = 1; try { byId[id].onShow(panel(id)); } catch (e) { console.error(e); } }
      if (opt.onChange) try { opt.onChange(id); } catch (e) {}
      if (!fromHash) { try { history.replaceState(null, '', location.pathname + location.search + (id === tabs[0].id ? '' : '#' + id)); } catch (e) {} }
    }
    function drop(id) {
      var b = host.querySelector('.gt-tab[data-t="' + id + '"]'), p = panel(id);
      var wasOn = b && b.classList.contains('on');
      if (b) b.remove(); if (p) p.remove();
      tabs = tabs.filter(function (t) { return t.id !== id; }); delete byId[id];
      if (wasOn) show(tabs.length ? tabs[0].id : null);
    }
    host.querySelectorAll('.gt-tab').forEach(function (b) { b.onclick = function () { show(b.getAttribute('data-t')); }; });
    // arrow keys move between tabs
    host.querySelector('.gt-bar').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var bs = [].slice.call(host.querySelectorAll('.gt-tab')), i = bs.indexOf(document.activeElement);
      if (i < 0) return; var n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
      n.focus(); n.click(); e.preventDefault();
    });
    show((location.hash || '').slice(1) || opt.start || (tabs[0] && tabs[0].id), true);
    return { show: show, panel: panel, drop: drop };
  }

  window.TDCGameTabs = { strip: strip, kv: kv, head: head, leaders: leaders, moments: moments, mount: mount, css: css };
})();
