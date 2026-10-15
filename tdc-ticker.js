/* tdc-ticker.js — the scores strip at the very top of every page (mounted by tdc-nav.js, above the nav bar).
 *
 * Games come from scripts/data/ticker.json (scripts/build_ticker.py: scrimmages + the schedule, 3 days back to 10
 * ahead, finals filled in). Today's real games are overlaid with live ESPN scores (polled every 60 s while any is
 * in progress). The strip opens scrolled to today's first game; the day picker jumps, the arrow pages right.
 * Scrimmages say so (owner rule: scrimmages are labelled, never passed off as games).
 * A page can opt out with window.TDC_NO_TICKER = true before tdc-nav.js runs.
 */
(function () {
  if (window.TDC_NO_TICKER || window.__tdcTicker) return;
  window.__tdcTicker = true;
  var SRC = 'scripts/data/ticker.json';
  var ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=300&dates=';
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // US Eastern calendar date (the slate's day), as YYYY-MM-DD
  function etDate(off) {
    var d = new Date(Date.now() + (off || 0) * 864e5);
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  var TODAY = etDate(0), YDAY = etDate(-1), TMRW = etDate(1);
  function dayName(iso) {
    if (iso === TODAY) return 'Today'; if (iso === TMRW) return 'Tomorrow'; if (iso === YDAY) return 'Yesterday';
    var d = new Date(iso + 'T12:00:00'); return DAYS[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function css() {
    if (document.getElementById('tdt-css')) return;
    var s = document.createElement('style'); s.id = 'tdt-css';
    s.textContent =
      '.tdt{display:flex;align-items:stretch;height:66px;background:var(--bg);border-bottom:1px solid var(--border);font-family:Inter,system-ui,sans-serif;position:relative;z-index:401;}' +
      '.tdt-lead{display:flex;flex-direction:column;justify-content:center;gap:4px;padding:0 14px 0 18px;border-right:1px solid var(--border);flex-shrink:0;}' +
      '.tdt-lg{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text);}' +
      '.tdt-day{font:600 11.5px Inter,system-ui,sans-serif;color:var(--text2);background:var(--bg2);border:1px solid var(--border2);border-radius:999px;padding:3px 8px;cursor:pointer;}' +
      '.tdt-sc{flex:1;display:flex;overflow-x:auto;overflow-y:hidden;scroll-behavior:smooth;scrollbar-width:none;min-width:0;}' +
      '.tdt-sc::-webkit-scrollbar{display:none;}' +
      '.tdt-g{flex:0 0 198px;display:block;padding:6px 12px 6px 12px;border-right:1px solid var(--border);text-decoration:none;color:var(--text);transition:background .12s;}' +
      '.tdt-g:hover{background:var(--bg2);}' +
      '.tdt-g.day0{border-left:2px solid var(--text3);}' +
      '.tdt-st{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;font-weight:700;color:var(--text2);margin-bottom:3px;white-space:nowrap;}' +
      '.tdt-st .tv{color:var(--text3);font-weight:600;overflow:hidden;text-overflow:ellipsis;max-width:92px;}' +
      '.tdt-st .live{color:#C8102E;}' +
      '.tdt-t{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;line-height:19px;white-space:nowrap;}' +
      '.tdt-t img{width:15px;height:15px;object-fit:contain;flex-shrink:0;}' +
      '.tdt-t .rk{font-size:10px;color:var(--text3);font-weight:600;min-width:0;}' +
      '.tdt-t .nm{overflow:hidden;text-overflow:ellipsis;}' +
      '.tdt-t .sc{margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums;}' +
      '.tdt-t.lose{color:var(--text3);}.tdt-t.lose .sc{font-weight:600;}' +
      '.tdt-tail{display:flex;align-items:center;flex-shrink:0;border-left:1px solid var(--border);}' +
      '.tdt-arw{background:none;border:none;border-right:1px solid var(--border);height:100%;width:34px;cursor:pointer;color:var(--text3);font-size:18px;}' +
      '.tdt-arw:hover{color:var(--text);background:var(--bg2);}' +
      '.tdt-all{font-size:11.5px;font-weight:600;color:var(--text2);text-decoration:none;padding:0 16px;white-space:nowrap;}' +
      '.tdt-all:hover{color:var(--text);text-decoration:underline;}' +
      '.tdt-none{display:flex;align-items:center;padding:0 16px;font-size:12px;color:var(--text3);}' +
      '@media(max-width:640px){.tdt{height:58px;}.tdt-lead{display:none;}.tdt-g{flex-basis:150px;padding:5px 9px;}.tdt-t{font-size:11.5px;line-height:17px;}' +
      '.tdt-st{font-size:10px;}.tdt-st .tv{max-width:58px;}.tdt-all{display:none;}}';
    document.head.appendChild(s);
  }

  function card(e, first) {
    var fin = e.st === 'f', live = e.st === 'l';
    var aw = fin && e.as > e.hs, hw = fin && e.hs > e.as;
    var when = live ? '<span class="live">' + esc(e.clock || 'Live') + '</span>' : fin ? 'Final' : (e.d === TODAY ? '' : dayName(e.d) + ' · ') + (e.t || 'TBA');
    if (fin && e.d !== TODAY) when = 'Final · ' + dayName(e.d);
    var right = e.k === 's' ? (fin || !e.tv ? 'Scrimmage' : e.tv) : (e.tv || '');
    var row = function (t, sc, lose) {
      return '<div class="tdt-t' + (lose ? ' lose' : '') + '">' + (t.l ? '<img src="' + esc(t.l) + '" alt="" loading="lazy">' : '<span style="width:15px"></span>') +
        (t.r && t.r <= 25 ? '<span class="rk">' + t.r + '</span>' : '') + '<span class="nm">' + esc(t.n) + '</span>' +
        '<span class="sc">' + (sc == null ? '' : sc) + '</span></div>';
    };
    var tag = e.u ? 'a href="' + esc(e.u) + '"' : 'div';
    return '<' + tag + ' class="tdt-g' + (first ? ' day0' : '') + '" data-d="' + e.d + '" title="' + esc(e.a.n + (e.nt ? ' vs ' : ' at ') + e.h.n + (e.k === 's' ? ' · scrimmage, unofficial' : '')) + '">' +
      '<div class="tdt-st"><span>' + when + '</span><span class="tv">' + esc(right) + '</span></div>' +
      row(e.a, e.as, (fin || live) && hw) + row(e.h, e.hs, (fin || live) && aw) + '</' + (e.u ? 'a' : 'div') + '>';
  }

  function render(host, games) {
    // yesterday's finals, today, and what's next: from 2 days back
    var from = etDate(-2), list = games.filter(function (e) { return e.d >= from; });
    if (!list.length) { host.innerHTML = '<div class="tdt-none">No games on the slate yet</div>'; return; }
    var days = []; list.forEach(function (e) { if (days.indexOf(e.d) < 0) days.push(e.d); });
    var start = days.filter(function (d) { return d >= TODAY; })[0] || days[days.length - 1];
    var seen = {}, old = host.querySelector('.tdt-sc'), keep = old ? old.scrollLeft : null;
    host.innerHTML =
      '<div class="tdt-lead"><span class="tdt-lg">Men\'s CBB</span><select class="tdt-day" aria-label="Jump to day">' +
      days.map(function (d) { return '<option value="' + d + '"' + (d === start ? ' selected' : '') + '>' + dayName(d) + '</option>'; }).join('') + '</select></div>' +
      '<div class="tdt-sc">' + list.map(function (e) { var f = !seen[e.d]; seen[e.d] = 1; return card(e, f && e.d !== list[0].d); }).join('') + '</div>' +
      '<div class="tdt-tail"><button class="tdt-arw" aria-label="More games">›</button><a class="tdt-all" href="today.html">Full Scoreboard »</a></div>';
    var sc = host.querySelector('.tdt-sc');
    var jump = function (d, smooth) { var c = sc.querySelector('[data-d="' + d + '"]'); if (!c) return; sc.style.scrollBehavior = smooth ? 'smooth' : 'auto'; sc.scrollLeft = c.offsetLeft - sc.offsetLeft; };
    if (keep != null) { sc.style.scrollBehavior = 'auto'; sc.scrollLeft = keep; } else jump(start, false);
    host.querySelector('.tdt-day').onchange = function () { jump(this.value, true); };
    host.querySelector('.tdt-arw').onclick = function () { sc.style.scrollBehavior = 'smooth'; sc.scrollLeft += sc.clientWidth * 0.8; };
  }

  // live overlay: today's ESPN board -> status + scores for games we list by ESPN id
  function overlay(games) {
    var today = games.filter(function (e) { return e.d === TODAY && e.k === 'g' && e.st !== 'f'; });
    if (!today.length) return Promise.resolve(false);
    return fetch(ESPN + TODAY.replace(/-/g, '')).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return false;
      var by = {}; (j.events || []).forEach(function (ev) { by[ev.id] = ev; });
      var anyLive = false;
      today.forEach(function (e) {
        var ev = by[String(e.id)]; if (!ev) return;
        var c = ev.competitions && ev.competitions[0], st = ev.status && ev.status.type || {};
        var side = function (ha) { return (c && c.competitors || []).filter(function (x) { return x.homeAway === ha; })[0]; };
        var h = side('home'), a = side('away');
        if (st.state === 'in' || st.state === 'post') { e.hs = h ? +h.score : e.hs; e.as = a ? +a.score : e.as; }
        if (st.state === 'in') { e.st = 'l'; e.clock = st.shortDetail || 'Live'; anyLive = true; }
        else if (st.state === 'post') e.st = 'f';
        else if (st.shortDetail && !e.t) e.t = st.shortDetail.replace(/^[^-]*-\s*/, '');
        var bc = c && c.broadcasts && c.broadcasts[0] && c.broadcasts[0].names; if (bc && bc.length && !e.tv) e.tv = bc[0];
      });
      return anyLive;
    }).catch(function () { return false; });
  }

  function mount(host) {
    css();
    fetch(SRC, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.games) { host.remove(); return; }
      var games = d.games;
      render(host, games);
      var tick = function () { overlay(games).then(function (live) { render(host, games); if (live) setTimeout(tick, 60000); }); };
      tick();
    }).catch(function () { host.remove(); });
  }
  window.TDC_TICKER = { mount: mount };
})();
