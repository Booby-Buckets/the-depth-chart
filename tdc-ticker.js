/* tdc-ticker.js — the scores strip at the very top of every page (mounted by tdc-nav.js, above the nav bar).
 *
 * Games come from scripts/data/ticker.json (scripts/build_ticker.py: scrimmages + the schedule, 3 days back to 10
 * ahead, finals filled in). Today's real games are overlaid with live ESPN scores (polled every 60 s while any is
 * in progress). It runs as a ticker: one day's games (live first) auto-scrolling in a loop — see render().
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
      '.tdt-sc{flex:1;display:flex;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;min-width:0;}' +
      '.tdt-trk{display:flex;flex:0 0 auto;}' +
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
    var ot = e.otl || (e.ot ? (e.ot > 1 ? e.ot + 'OT' : 'OT') : ''), final = 'Final' + (ot ? '/' + ot : '');
    var when = live ? '<span class="live">' + esc(e.clock || 'Live') + '</span>' : fin ? final : (e.d === TODAY ? '' : dayName(e.d) + ' · ') + (e.t || 'TBA');
    if (fin && e.d !== TODAY) when = final + ' · ' + dayName(e.d);
    var right = e.k === 's' ? (fin || !e.tv ? 'Scrimmage' : e.tv) : (e.tv || '');
    var row = function (t, sc, lose) {
      return '<div class="tdt-t' + (lose ? ' lose' : '') + '">' + (t.l ? '<img src="' + esc(window.tdcLogoSmall ? tdcLogoSmall(t.l, 40) : t.l) + '" alt="" loading="lazy">' : '<span style="width:15px"></span>') +
        (t.r && t.r <= 25 ? '<span class="rk">' + t.r + '</span>' : '') + '<span class="nm">' + esc(t.n) + '</span>' +
        '<span class="sc">' + (sc == null ? '' : sc) + '</span></div>';
    };
    var tag = e.u ? 'a href="' + esc(e.u) + '"' : 'div';
    return '<' + tag + ' class="tdt-g' + (first ? ' day0' : '') + '" data-d="' + e.d + '" data-id="' + esc(e.id) + '" title="' + esc(e.a.n + (e.nt ? ' vs ' : ' at ') + e.h.n + (e.k === 's' ? ' · scrimmage, unofficial' : '')) + '">' +
      '<div class="tdt-st"><span>' + when + '</span><span class="tv">' + esc(right) + '</span></div>' +
      row(e.a, e.as, (fin || live) && hw) + row(e.h, e.hs, (fin || live) && aw) + '</' + (e.u ? 'a' : 'div') + '>';
  }

  // TICKER (owner, Nov 22 2026: "turn that into a ticker up there" — the homepage's Live now block is gone, so the strip
  // carries the day): one day's games at a time (the day picker switches), live games first, auto-scrolling in a seamless
  // loop. It stops while the pointer is over it, it has focus, or a finger/wheel is moving it, and picks up a few seconds
  // later from wherever it was left. Reduced-motion users get the plain scrollable strip. Re-renders (live scores every
  // 60 s) keep the position. "Reduce motion" users still get the ticker (the owner asked for one, and his own Mac has the
  // setting on), at half speed; it always stops under the pointer, on focus and on touch.
  var reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var SPEED = reduce ? 75 : 80;   // px per second (owner, Nov 22 2026: 34 too slow, 60 still slow, 110 too fast; his Mac has reduce-motion on)
  function render(host, games) {
    var from = etDate(-2), list = games.filter(function (e) { return e.d >= from; });
    if (!list.length) { host.innerHTML = '<div class="tdt-none">No games on the slate yet</div>'; return; }
    var days = []; list.forEach(function (e) { if (days.indexOf(e.d) < 0) days.push(e.d); });
    var start = days.filter(function (d) { return d >= TODAY; })[0] || days[days.length - 1];
    var day = host._day && days.indexOf(host._day) >= 0 ? host._day : start;
    var ord = function (e) { return e.st === 'l' ? 0 : e.st === 'f' ? 2 : 1; };
    var show = list.filter(function (e) { return e.d === day || (day === TODAY && e.d === YDAY && e.st === 'l'); })
      .map(function (e, i) { return [e, i]; }).sort(function (a, b) { return (ord(a[0]) - ord(b[0])) || (a[1] - b[1]); }).map(function (x) { return x[0]; });
    var cards = show.map(function (e) { return card(e, false); }).join('');
    host.innerHTML =
      '<div class="tdt-lead"><span class="tdt-lg">Men\'s CBB</span><select class="tdt-day" aria-label="Show day">' +
      days.map(function (d) { return '<option value="' + d + '"' + (d === day ? ' selected' : '') + '>' + dayName(d) + '</option>'; }).join('') + '</select></div>' +
      '<div class="tdt-sc"><div class="tdt-trk">' + cards + '</div></div>' +
      '<div class="tdt-tail"><button class="tdt-arw" aria-label="More games">›</button><a class="tdt-all" href="today.html">Full Scoreboard »</a></div>';
    var sc = host.querySelector('.tdt-sc'), trk = host.querySelector('.tdt-trk');
    // seamless loop: a second, hidden copy of the day's games follows the first when they overflow the strip
    var setW = trk.scrollWidth;
    // mounted before layout (or while hidden): measure again next frame, a few times at most
    if (!sc.clientWidth || !setW) { host._tries = (host._tries || 0) + 1; if (host._tries < 40) setTimeout(function () { render(host, games); }, 100); return; }
    host._loop = show.length > 1 && setW > sc.clientWidth + 40;
    if (host._loop) {
      var clone = document.createElement('div'); clone.innerHTML = cards; clone.setAttribute('aria-hidden', 'true');
      [].slice.call(clone.children).forEach(function (c) { c.setAttribute('tabindex', '-1'); c.classList.add('tdt-cl'); trk.appendChild(c); });
    }
    host._setW = setW; host._sc = sc;
    if (host._pos == null || host._pos > setW) host._pos = 0;
    sc.scrollLeft = Math.round(host._pos);
    host.querySelector('.tdt-day').onchange = function () { host._day = this.value; host._pos = 0; render(host, games); };
    host.querySelector('.tdt-arw').onclick = function () { hold(host, 5000); sc.style.scrollBehavior = 'smooth'; sc.scrollLeft += sc.clientWidth * 0.8; setTimeout(function () { sc.style.scrollBehavior = 'auto'; }, 600); };
    if (!host._wired) { host._wired = true; wire(host); }
  }
  // pause handling + the one animation loop per strip
  function hold(host, ms) { host._holdUntil = Math.max(host._holdUntil || 0, Date.now() + (ms || 0)); }
  function wire(host) {
    host.addEventListener('mouseenter', function () { host._hover = true; });
    host.addEventListener('mouseleave', function () { host._hover = false; hold(host, 1200); });
    host.addEventListener('focusin', function () { host._focus = true; });
    host.addEventListener('focusout', function () { host._focus = false; hold(host, 1200); });
    host.addEventListener('touchstart', function () { host._touch = true; }, { passive: true });
    host.addEventListener('touchend', function () { host._touch = false; hold(host, 4000); }, { passive: true });
    host.addEventListener('wheel', function () { hold(host, 4000); }, { passive: true });
    var last = 0;
    var step = function (t) {
      requestAnimationFrame(step);
      var dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
      var sc = host._sc; if (!sc || !host._loop || document.hidden) return;
      if (host._hover || host._focus || host._touch || Date.now() < (host._holdUntil || 0)) { host._pos = sc.scrollLeft; return; }
      if (Math.abs(sc.scrollLeft - Math.round(host._pos)) > 2) host._pos = sc.scrollLeft;   // someone moved it: carry on from there
      host._pos += SPEED * dt;
      if (host._pos >= host._setW) host._pos -= host._setW;
      sc.scrollLeft = Math.round(host._pos);
    };
    requestAnimationFrame(step);
  }

  // live overlay: ESPN's board -> status + scores for games we list by ESPN id. Yesterday's unfinished games too, so a
  // late tip still going past midnight ET stays live instead of freezing (owner, Nov 2 2026: High Point–Liberty).
  function overlay(games) {
    var today = games.filter(function (e) { return (e.d === TODAY || e.d === YDAY) && e.k === 'g' && e.st !== 'f'; });
    if (!today.length) return Promise.resolve(false);
    var days = []; today.forEach(function (e) { if (days.indexOf(e.d) < 0) days.push(e.d); });
    return Promise.all(days.map(function (d) {
      return fetch(ESPN + d.replace(/-/g, '')).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    })).then(function (js) {
      if (!js.some(Boolean)) return false;
      var by = {}; js.forEach(function (j) { ((j && j.events) || []).forEach(function (ev) { by[ev.id] = ev; }); });
      var anyLive = false;
      today.forEach(function (e) {
        var ev = by[String(e.id)]; if (!ev) return;
        var c = ev.competitions && ev.competitions[0], st = ev.status && ev.status.type || {};
        var side = function (ha) { return (c && c.competitors || []).filter(function (x) { return x.homeAway === ha; })[0]; };
        var h = side('home'), a = side('away');
        if (st.state === 'in' || st.state === 'post') { e.hs = h ? +h.score : e.hs; e.as = a ? +a.score : e.as; }
        if (st.state === 'in') { e.st = 'l'; e.clock = st.shortDetail || 'Live'; anyLive = true; }
        else if (st.state === 'post') { e.st = 'f'; var om = /\/(\d*OT)\b/.exec(st.shortDetail || ''); if (om) e.otl = om[1]; }
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
