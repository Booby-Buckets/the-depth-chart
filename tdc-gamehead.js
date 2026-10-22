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
  // one team's band for the Scouting pages: logo + name + a sub line on the left, a few big numbers on the right
  //   teamBand({name, href, logo, color, sub, stats:[[label, value], …]})
  function teamBand(o) {
    css();
    if (!document.getElementById('gh-band1-css')) {
      var s = document.createElement('style'); s.id = 'gh-band1-css';
      s.textContent =
        '.ghb1{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;border-radius:14px;color:#fff;padding:18px 24px;margin:6px 0 0;}' +
        '.ghb1 .who1{display:flex;align-items:center;gap:16px;min-width:0;}' +
        '.ghb1 img{width:58px;height:58px;object-fit:contain;flex-shrink:0;background:rgba(255,255,255,.94);border-radius:12px;padding:6px;}' +   // a light tile: a navy logo on a navy band would vanish
        '.ghb1 .nm{font-family:"Playfair Display",Georgia,serif;font-size:30px;font-weight:800;line-height:1.05;color:#fff;text-decoration:none;}' +
        '.ghb1 a.nm:hover{text-decoration:underline;}' +
        '.ghb1 .sub{font-size:12.5px;font-weight:600;opacity:.85;margin-top:5px;}' +
        '.ghb1 .st1{display:flex;gap:28px;}' +
        '.ghb1 .st1 div{text-align:right;} .ghb1 .st1 b{display:block;font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1;}' +
        '.ghb1 .st1 span{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.8;}' +
        '@media(max-width:640px){.ghb1{padding:14px 16px;}.ghb1 img{width:42px;height:42px;padding:4px;border-radius:9px;}.ghb1 .nm{font-size:22px;}.ghb1 .st1{gap:18px;width:100%;}.ghb1 .st1 div{text-align:left;}.ghb1 .st1 b{font-size:20px;}}';
      document.head.appendChild(s);
    }
    var nm = o.href ? '<a class="nm" href="' + esc(o.href) + '">' + esc(o.name) + '</a>' : '<span class="nm">' + esc(o.name) + '</span>';
    return '<div class="ghb1" style="background:' + band(o.color) + '"><div class="who1">' +
      (o.logo ? '<img src="' + esc(o.logo) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '<div>' + nm + (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div></div>' +
      ((o.stats || []).length ? '<div class="st1">' + o.stats.map(function (x) { return '<div><b>' + x[1] + '</b><span>' + esc(x[0]) + '</span></div>'; }).join('') + '</div>' : '') +
      '</div>';
  }
  // the colour + logo for a team name, from team-colors.js
  function team(name) { var c = window.tdcTeamColor && window.tdcTeamColor(name); return { color: c && c.c1, logo: c && c.logo }; }
  window.TDC_GAMEHEAD = { html: html, teamBand: teamBand, team: team, band: band };
})();
