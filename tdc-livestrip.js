/* tdc-livestrip.js — the home page "Live now / Today" scores strip.
 * Mount: <section id="tdcLive" hidden></section>. Needs tdc-live.js; uses tdc-schedule.js /
 * tdc-ratings.js (pregame TDC line) and team-colors.js (short names) when the page has them.
 * Hidden entirely when there are no games today. */
(function () {
  'use strict';
  const host = document.getElementById('tdcLive');
  if (!host || !window.TDC_LIVE) return;
  const L = window.TDC_LIVE;
  const CAP = 12;
  const CSS = `
  .tlv{margin:22px max(var(--tdc-gut,16px), calc((100% - var(--tdc-col,1400px)) / 2)) 0;font-family:'Inter',system-ui,sans-serif;}
  .tlv[hidden]{display:none!important;}
  .tlv-head{display:flex;align-items:flex-end;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;margin-bottom:10px;}
  .tlv-eye{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:3px;}
  .tlv-h{font-family:'Playfair Display',serif;font-weight:800;font-size:22px;line-height:1.1;color:var(--text);margin:0;}
  .tlv-h .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin:0 8px 3px 0;vertical-align:middle;animation:tlvPulse 1.6s ease-in-out infinite;}
  @keyframes tlvPulse{50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.tlv-h .dot{animation:none}}
  .tlv-chips{display:flex;gap:6px;flex-wrap:wrap;}
  .tlv-chip{font:600 12px/1 'Inter',sans-serif;padding:6px 11px;border-radius:999px;border:1px solid var(--border2,var(--border));background:transparent;color:var(--text2);cursor:pointer;}
  .tlv-chip:hover{color:var(--text);border-color:var(--text3);}
  .tlv-chip.on{background:var(--text);color:var(--bg);border-color:var(--text);}
  .tlv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;}
  .tlv-card{border:1px solid var(--border);border-radius:10px;background:var(--bg);padding:10px 12px 9px;min-width:0;display:flex;flex-direction:column;gap:5px;}
  .tlv-card.is-live{border-color:color-mix(in srgb,var(--red) 38%,var(--border));}
  .tlv-top{display:flex;justify-content:space-between;gap:8px;font-size:11px;font-weight:600;color:var(--text3);white-space:nowrap;}
  .tlv-top span{overflow:hidden;text-overflow:ellipsis;}
  .tlv-live{color:var(--red);font-weight:800;}
  .tlv-tm{display:flex;align-items:center;gap:8px;min-width:0;}
  .tlv-tm img{width:20px;height:20px;object-fit:contain;flex:0 0 20px;}
  .tlv-tm .nm{flex:1;min-width:0;font-size:13.5px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .tlv-tm .nm a{color:inherit;text-decoration:none;}
  .tlv-tm .nm a:hover{color:var(--accent);}
  .tlv-tm .rk{font-size:10.5px;font-weight:700;color:var(--text3);margin-right:4px;}
  .tlv-tm .ps{color:var(--accent);font-size:9px;margin-left:5px;vertical-align:1px;}
  .tlv-tm .sc{font-size:17px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;}
  .tlv-tm .sc.pct{font-size:12.5px;font-weight:700;color:var(--text2);}
  .tlv-tm.lose .nm,.tlv-tm.lose .sc{color:var(--text3);font-weight:600;}
  .tlv-bar{display:flex;height:4px;border-radius:3px;overflow:hidden;background:var(--bg3,var(--border));margin-top:2px;}
  .tlv-bar i{display:block;height:100%;transition:width .5s ease;}
  .tlv-bar i.a{background:var(--text3);opacity:.45;}
  .tlv-bar i.h{background:var(--accent);}
  .tlv-foot{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--text2);min-width:0;}
  .tlv-foot span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .tlv-foot b{color:var(--text);font-weight:700;}
  .tlv-foot a{color:var(--accent);font-weight:700;text-decoration:none;white-space:nowrap;}
  .tlv-foot a:hover{text-decoration:underline;}
  .tlv-more{margin-top:10px;}
  .tlv-note{font-size:11px;color:var(--text3);margin-top:8px;}
  @media(max-width:760px){.tlv{margin-top:16px;}.tlv-h{font-size:20px;}
    /* phones: one swipeable row instead of a tall stack */
    .tlv-grid{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:82%;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:6px;scrollbar-width:thin;}
    .tlv-card{scroll-snap-align:start;}
    .tlv-foot{align-items:flex-end;} .tlv-foot span{white-space:normal;}}`;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  host.classList.add('tlv');

  const pass = ['livetest', 'livedate'].map(k => { const v = new URLSearchParams(location.search).get(k); return v ? `&${k}=${encodeURIComponent(v)}` : ''; }).join('');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let mode = 'all', showAll = false, board = null;
  const lines = {};                       // id → pregame line (or null)
  let keyOf = {};                         // ESPN full name → sheet short (team.html key)

  // ESPN full → our short name / team page key (ratings map), else team-colors' mascot trim
  if (window.TDC_RATINGS) window.TDC_RATINGS.get().then(D => { (D.teams || []).forEach(t => { keyOf[t.full] = t.team; }); draw(); }).catch(() => {});
  // ratings rows without a sheet entry carry the ESPN full name as their key: trim those, and don't link them
  const sheetKey = t => { const k = keyOf[t.name]; return k && k !== t.name ? k : null; };
  const shortName = t => sheetKey(t) || (window.tdcShortSchool ? window.tdcShortSchool(t.name) : '') || t.loc || t.name;
  const etTime = d => { try { return new Date(d).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (e) { return ''; } };
  const dayLabel = day => { try { return new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); } catch (e) { return ''; } };

  function wpOf(x) {
    const ln = lines[x.id];
    if (x.state === 'in') return L.winProb({ spread: ln ? ln.margin : 0, margin: (x.home.score || 0) - (x.away.score || 0), period: x.period, clock: x.clock });
    if (x.state === 'pre') return ln ? ln.p : null;
    return null;
  }
  function lineText(x, abbr) {
    const ln = lines[x.id]; if (!ln) return '';
    if (Math.abs(ln.margin) < 0.05) return 'Pick’em';
    const fav = ln.margin > 0 ? x.home : x.away;
    return `${esc(abbr && fav.abbr ? fav.abbr : shortName(fav))} −${Math.abs(ln.margin).toFixed(1)}`;
  }
  function row(x, sideKey, pHome) {
    const t = x[sideKey], o = sideKey === 'home' ? x.away : x.home;
    const isLive = x.state === 'in', isFinal = x.state === 'post';
    const lose = isFinal && t.score != null && o.score != null && t.score < o.score;
    const key = sheetKey(t);
    const nm = key ? `<a href="team.html?team=${encodeURIComponent(key)}">${esc(shortName(t))}</a>` : esc(shortName(t));
    const sc = isLive || isFinal ? `<span class="sc">${t.score != null ? t.score : ''}</span>`
      : pHome != null ? `<span class="sc pct">${Math.round((sideKey === 'home' ? pHome : 1 - pHome) * 100)}%</span>` : '<span class="sc pct"></span>';
    return `<div class="tlv-tm${lose ? ' lose' : ''}">
      <img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="nm">${t.rank ? `<span class="rk">${t.rank}</span>` : ''}${nm}${isLive && x.poss === t.id ? '<span class="ps" title="Possession">●</span>' : ''}</div>${sc}</div>`;
  }
  function card(x) {
    const isLive = x.state === 'in', isFinal = x.state === 'post';
    const p = wpOf(x);
    const pHome = p == null ? 0.5 : p;
    const status = isLive ? `<span class="tlv-live">LIVE · ${esc(x.detail)}</span>` : isFinal ? `<span>${esc(x.detail || 'Final')}</span>` : `<span>${x.timeValid === false ? 'Time TBD' : esc(etTime(x.date))}</span>`;
    const where = [x.neutral ? 'Neutral' : '', x.tv || ''].filter(Boolean).join(' · ');
    const lt = lineText(x);
    const fav = pHome >= 0.5 ? x.home : x.away;
    const foot = isLive
      ? `<span>Win prob <b>${esc(shortName(fav))} ${Math.round(Math.max(pHome, 1 - pHome) * 100)}%</b>${lt ? ` · pregame ${lineText(x, true)}` : ''}</span>`
      : lt ? `<span>TDC line <b>${lt}</b></span>` : `<span>${isFinal ? '' : 'No TDC line'}</span>`;
    const link = `<a href="game.html?id=${encodeURIComponent(x.id)}${pass}">${isLive ? 'Live →' : isFinal ? 'Box score →' : 'Preview →'}</a>`;
    const title = isLive ? `Live win probability: ${shortName(x.away)} ${Math.round((1 - pHome) * 100)}%, ${shortName(x.home)} ${Math.round(pHome * 100)}%` : 'Away / home win probability';
    return `<div class="tlv-card${isLive ? ' is-live' : ''}" data-id="${esc(x.id)}">
      <div class="tlv-top">${status}<span>${esc(where)}</span></div>
      ${row(x, 'away', p)}${row(x, 'home', p)}
      ${p != null ? `<div class="tlv-bar" title="${esc(title)}"><i class="a" style="width:${(100 - pHome * 100).toFixed(1)}%"></i><i class="h" style="width:${(pHome * 100).toFixed(1)}%"></i></div>` : ''}
      <div class="tlv-foot">${foot}${link}</div></div>`;
  }
  function isTop(x) { return !!(x.home.rank || x.away.rank); }
  function draw() {
    if (!board) return;
    const games = board.games;
    if (!games.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    const live = games.filter(x => x.state === 'in');
    if (mode === 'live' && !live.length) mode = 'all';
    let list = games.filter(x => mode === 'all' || (mode === 'live' ? x.state === 'in' : isTop(x)));
    const ord = { in: 0, pre: 1, post: 2 };
    list = list.slice().sort((a, b) => (ord[a.state] - ord[b.state])
      || (a.state === 'in' ? Math.abs((wpOf(a) || .5) - .5) - Math.abs((wpOf(b) || .5) - .5) : 0)   // closest live games first
      || ((isTop(b) ? 1 : 0) - (isTop(a) ? 1 : 0))
      || (a.state === 'pre' ? new Date(a.date) - new Date(b.date) : 0));
    const shown = showAll ? list : list.slice(0, CAP);
    const chips = [['all', `All ${games.length}`], ...(live.length ? [['live', `Live ${live.length}`]] : []), ['top', 'Top 25']]
      .map(([k, l]) => `<button class="tlv-chip${k === mode ? ' on' : ''}" data-mode="${k}">${l}</button>`).join('');
    host.innerHTML = `<div class="tlv-head"><div>
        <div class="tlv-eye">Scores · ${esc(dayLabel(board.day))}${board.test ? ' · test data' : ''}</div>
        <h2 class="tlv-h">${live.length ? `<span class="dot" aria-hidden="true"></span>Live now` : 'Today’s games'}</h2></div>
        <div class="tlv-chips" role="group" aria-label="Filter games">${chips}<a class="tlv-chip" href="today.html" style="text-decoration:none">All of today's games →</a></div></div>
      ${shown.length ? `<div class="tlv-grid">${shown.map(card).join('')}</div>` : '<div class="tlv-note">No games in this view.</div>'}
      ${list.length > CAP ? `<div class="tlv-more"><button class="tlv-chip" data-more="1">${showAll ? 'Show fewer' : `Show all ${list.length} games`}</button></div>` : ''}
      <div class="tlv-note">Live odds blend the TDC pregame line with the score and clock. Scores from ESPN, updated every 20 seconds while games are on.</div>`;
  }
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { mode = b.dataset.mode; showAll = false; draw(); }
    else if (b.dataset.more) { showAll = !showAll; draw(); }
  });
  L.subscribe(data => {
    board = data;
    draw();
    // fetch any missing pregame lines, redraw once they land
    const need = data.games.filter(x => x.state !== 'post' && !(x.id in lines));
    need.forEach(x => { lines[x.id] = null; });
    if (need.length) Promise.all(need.map(x => L.pregame(x).then(l => { lines[x.id] = l; }).catch(() => {}))).then(draw);
  });
})();
