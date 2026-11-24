/* tdc-rim.js — DUNKS vs LAYUPS on the player page (Shots → Shot Charts).
 * Data: scripts/data/rim_finishing/p_<espn % 32>.json (scripts/build_rim_finishing.py, ESPN play-by-play, 2022-23 onward).
 * Layups include tip-ins (ESPN only separates them from 2024-25 on); a tip-in dunk is a dunk.
 *   TDC_RIM.render(host, {espn, wrap})   opts.wrap = a hidden wrapper shown once there is data
 */
(function (g) {
  if (g.TDC_RIM) return;
  var DAY = new Date().toISOString().slice(0, 10);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sLbl(y) { y = +y; return (y - 1) + '-' + String(y).slice(2); }
  function pc(m, a) { return a ? (100 * m / a).toFixed(1) + '%' : '—'; }
  function ord(n) { var t = n % 100; return n + (t > 10 && t < 14 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
  function css() {
    if (document.getElementById('rim-css')) return;
    var s = document.createElement('style'); s.id = 'rim-css';
    s.textContent = '.rim{font-family:Inter,system-ui,sans-serif;}' +
      '.rim-chips{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 10px;}.rim-chips button{font:700 11px Inter,system-ui,sans-serif;border:1px solid var(--border2);background:var(--bg);color:var(--text2);border-radius:999px;padding:4px 11px;cursor:pointer;}.rim-chips button.on{background:var(--text);color:var(--bg);border-color:var(--text);}' +
      '.rim-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px;}' +
      '.rim-k{border:1px solid var(--border);border-radius:10px;background:var(--panel,var(--bg));padding:11px 13px;}' +
      '.rim-k span{display:block;font-weight:700;font-size:11.5px;color:var(--text3);}.rim-k b{display:block;font-weight:800;font-size:22px;line-height:1.25;color:var(--text);font-variant-numeric:tabular-nums;}.rim-k em{display:block;font-style:normal;font-weight:600;font-size:11.5px;line-height:1.4;color:var(--text2);}' +
      '.rim-note{font:600 11.5px/1.45 Inter,system-ui,sans-serif;color:var(--text3);margin:8px 0 0;}' +
      '@media(max-width:700px){.rim-cards{grid-template-columns:1fr 1fr;gap:8px;}}';
    document.head.appendChild(s);
  }
  function render(host, opts) {
    if (!host || !opts || !opts.espn) return;
    css(); host.classList.add('rim');
    fetch('scripts/data/rim_finishing/p_' + (+opts.espn % 32) + '.json?d=' + DAY).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var raw = d && d.players[String(opts.espn)];
      if (!raw || !raw.length) return;
      var L = raw.map(function (r) { var o = {}; d.cols.forEach(function (c, i) { o[c] = r[i]; }); o.Lm = o.lm + o.tm; o.La = o.la + o.ta; o.Rm = o.dm + o.Lm; o.Ra = o.da + o.La; return o; })
        .sort(function (a, b) { return b.season - a.season; });
      var wrap = opts.wrap; if (wrap) wrap.style.display = '';   // (the page's panel kit re-parents the host, so the wrapper is passed in)
      draw(host, d, L, L[0]);
    }).catch(function () {});
  }
  function draw(host, d, L, o) {
    var lg = d.lg[o.season], lD = lg.dm / lg.da, lLa = lg.la + lg.ta, lL = (lg.lm + lg.tm) / lLa, lRa = lg.da + lLa;
    var p = function (k) { return o.pct && o.pct[k] != null ? '<em>' + ord(Math.max(1, Math.min(99, o.pct[k]))) + ' percentile</em>' : ''; };
    var k = function (t, v, sub) { return '<div class="rim-k"><span>' + t + '</span><b>' + v + '</b>' + sub + '</div>'; };
    var h = L.length > 1 ? '<div class="rim-chips">' + L.map(function (x) { return '<button type="button" data-s="' + x.season + '" class="' + (x === o ? 'on' : '') + '">' + sLbl(x.season) + '</button>'; }).join('') + '</div>' : '';
    h += '<div class="rim-cards">' +
      k('Dunks', o.dm, '<em>' + (o.dm / o.g).toFixed(1) + ' per game' + (o.rank ? ' · ' + (o.rank > 1 ? ord(o.rank) + ' most' : 'most') + ' in D-I' : '') + '</em>') +
      k('Dunk share of rim shots', pc(o.da, o.Ra), '<em>D-I ' + pc(lg.da, lRa) + '</em>' + p(1)) +
      k('Layup FG%', pc(o.Lm, o.La), '<em>' + o.Lm + ' of ' + o.La + ' · D-I ' + pc(lL, 1) + '</em>' + p(2)) +
      k('Rim FG%', pc(o.Rm, o.Ra), '<em>' + o.Rm + ' of ' + o.Ra + ' · D-I ' + pc(lg.dm + lg.lm + lg.tm, lRa) + '</em>' + p(3)) + '</div>';
    var row = function (x, tot) {
      return '<tr' + (tot ? ' style="font-weight:800"' : '') + '><td class="l">' + (tot ? 'Total' : sLbl(x.season)) + '</td><td class="l">' + esc(x.team) + '</td><td>' + x.g + '</td><td>' + x.dm + '</td><td>' + x.da + '</td><td>' + pc(x.dm, x.da) + '</td><td>' + (x.dm / x.g).toFixed(1) + '</td><td>' + pc(x.dast, x.dm) +
        '</td><td>' + x.Lm + '</td><td>' + x.La + '</td><td>' + pc(x.Lm, x.La) + '</td><td>' + pc(x.last, x.lm) + '</td><td>' + pc(x.da, x.Ra) + '</td><td>' + pc(x.Rm, x.Ra) + '</td></tr>';
    };
    var tot = null;
    if (L.length > 1) { tot = { team: '' }; ['g', 'dm', 'da', 'dast', 'Lm', 'La', 'lm', 'last', 'Rm', 'Ra'].forEach(function (c) { tot[c] = L.reduce(function (s, x) { return s + x[c]; }, 0); }); }
    h += '<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Season</th><th class="l">Team</th><th>G</th><th>Dunks</th><th>Dunk att</th><th>Dunk FG%</th><th>Dunks / g</th><th>Dunks assisted</th><th>Layups</th><th>Layup att</th><th>Layup FG%</th><th>Layups assisted</th><th>Dunk share</th><th>Rim FG%</th></tr></thead><tbody>' +
      L.map(function (x) { return row(x); }).join('') + (tot ? row(tot, true) : '') + '</tbody></table></div>';
    h += '<p class="rim-note">Layups include tip-ins. Rim shots are dunks plus layups. D-I dunk FG% in ' + sLbl(o.season) + ' is ' + pc(lD, 1) + '.' + (o.pct ? ' Percentiles compare players with ' + lg.qual + '+ rim shots.' : ' Percentiles need ' + lg.qual + ' rim shots.') + ' Play-by-play since 2022-23. <a href="dunks.html" style="color:var(--accent);font-weight:700">D-I dunk leaders →</a></p>';
    host.innerHTML = h;
    host.querySelectorAll('.rim-chips button').forEach(function (b) { b.onclick = function () { draw(host, d, L, L.filter(function (x) { return x.season === +b.dataset.s; })[0]); }; });
  }
  g.TDC_RIM = { render: render };
})(window);
