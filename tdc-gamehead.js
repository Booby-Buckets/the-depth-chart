/* tdc-gamehead.js — the team-colour scoreboard band at the top of a game page (game.html, scrimmage.html).
 *
 *   TDC_GAMEHEAD.html({
 *     away: {name, href, logo, color, sub, pts},   // sub = the small line under the name (rank, game rating…)
 *     home: {…},
 *     status: 'Final', statusSub: 'Unofficial',     // the badge in the middle
 *     meta:  'Tue, Oct 13, 2026 · 7:00 PM · Neutral site · NBC Sports Boston'
 *   }) -> html
 *
 * Each half is the team's own colour, darkened only as far as it takes for white text to read
 * (WCAG 4.5:1), so a gold or light-blue school still gets a legible band. pts null = not played yet.
 */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lum(r, g, b) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
  // the team colour, darkened until white text clears 4.5:1 (and a touch more, so the band reads as one deep field)
  function band(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#2A2F3A';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, k = 0.9;
    while (k > 0.25 && 1.05 / (lum(r * k, g * k, b * k) + 0.05) < 5.2) k -= 0.04;
    return 'rgb(' + Math.round(r * k) + ',' + Math.round(g * k) + ',' + Math.round(b * k) + ')';
  }
  function css() {
    if (document.getElementById('gh-band-css')) return;
    var s = document.createElement('style'); s.id = 'gh-band-css';
    s.textContent =
      '.ghb{position:relative;display:grid;grid-template-columns:1fr 1fr;border-radius:14px;overflow:hidden;color:#fff;min-height:128px;margin:6px 0 0;}' +
      '.ghb .sd{display:flex;align-items:center;gap:16px;padding:20px 26px;min-width:0;}' +
      '.ghb .sd.h{flex-direction:row-reverse;text-align:right;}' +
      '.ghb .sd img{width:64px;height:64px;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 2px 6px rgba(0,0,0,.25));}' +
      '.ghb .who{min-width:0;}' +
      '.ghb .nm{font-family:"Playfair Display",Georgia,serif;font-size:30px;font-weight:800;line-height:1.05;letter-spacing:-.01em;color:#fff;text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.ghb a.nm:hover{text-decoration:underline;}' +
      '.ghb .sub{font-size:12.5px;font-weight:600;opacity:.85;margin-top:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.ghb .sd.h .sub{justify-content:flex-end;}' +
      '.ghb .pts{font-size:52px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1;}' +
      '.ghb .sd.a .pts{margin-left:auto;padding-right:44px;}.ghb .sd.h .pts{margin-right:auto;padding-left:44px;}' +
      '.ghb .sd.lose .pts{opacity:.55;}' +
      '.ghb .mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.55);padding:8px 14px;border-radius:8px;text-align:center;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;}' +
      '.ghb .mid small{display:block;font-size:9.5px;opacity:.8;letter-spacing:.08em;margin-top:2px;}' +
      '.ghb-meta{display:flex;gap:6px 18px;flex-wrap:wrap;font-size:13px;color:var(--text2);margin:10px 0 0;}' +
      '@media(max-width:760px){.ghb{min-height:0;}.ghb .sd{padding:14px 14px;gap:10px;flex-direction:column;align-items:flex-start;}.ghb .sd.h{flex-direction:column;align-items:flex-end;}' +
      '.ghb .sd img{width:40px;height:40px;}.ghb .nm{font-size:19px;max-width:100%;}.ghb .pts{font-size:36px;}' +
      '.ghb .sd.a .pts,.ghb .sd.h .pts{margin:0;padding:0;}.ghb .mid{top:auto;bottom:12px;transform:translateX(-50%);padding:6px 10px;}}';
    document.head.appendChild(s);
  }
  function side(t, cls, lose) {
    var nm = t.href ? '<a class="nm" href="' + esc(t.href) + '">' + esc(t.name) + '</a>' : '<span class="nm">' + esc(t.name) + '</span>';
    return '<div class="sd ' + cls + (lose ? ' lose' : '') + '" style="background:' + band(t.color) + '">' +
      (t.logo ? '<img src="' + esc(t.logo) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '<div class="who">' + nm + (t.sub ? '<div class="sub">' + t.sub + '</div>' : '') + '</div>' +
      '<div class="pts">' + (t.pts == null ? '—' : t.pts) + '</div></div>';
  }
  function html(o) {
    css();
    var a = o.away, h = o.home, played = a.pts != null && h.pts != null;
    return '<div class="ghb">' + side(a, 'a', played && +a.pts < +h.pts) + side(h, 'h', played && +h.pts < +a.pts) +
      '<div class="mid">' + esc(o.status || (played ? 'Final' : 'Not played')) + (o.statusSub ? '<small>' + esc(o.statusSub) + '</small>' : '') + '</div></div>' +
      (o.meta ? '<div class="ghb-meta">' + o.meta + '</div>' : '');
  }
  // the colour + logo for a team name, from team-colors.js
  function team(name) { var c = window.tdcTeamColor && window.tdcTeamColor(name); return { color: c && c.c1, logo: c && c.logo }; }
  window.TDC_GAMEHEAD = { html: html, team: team, band: band };
})();
