/* tdc-livegame.js — game.html live mode, fed by ESPN's summary through tdc-live.js.
 * Scoreboard header, win-probability chart over every play (biggest swings marked), scoring
 * runs, recent plays, team stats and the live player box. Polls every 20s while live.
 *   TDCLiveGame.mount(host, id, {onFinal})   onFinal() fires once when ESPN marks the game final */
(function (g) {
  'use strict';
  const L = () => g.TDC_LIVE;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CSS = `
  .lg{display:grid;gap:18px;margin-top:16px;font-family:'Inter',system-ui,sans-serif;}
  .lg-card{border:1px solid var(--border);border-radius:10px;background:var(--bg);padding:16px;min-width:0;}
  .lg-card h2{font-family:'Playfair Display',serif;font-weight:800;font-size:18px;color:var(--text);margin:0 0 8px;}
  .lg-board{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;}
  .lg-team{display:flex;align-items:center;gap:12px;min-width:0;}
  .lg-team img{width:48px;height:48px;object-fit:contain;flex:0 0 48px;}
  .lg-tn{flex:1;min-width:0;}
  .lg-tn .n{font-family:'Playfair Display',serif;font-weight:800;font-size:22px;line-height:1.15;color:var(--text);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .lg-tn a{color:inherit;text-decoration:none;} .lg-tn a:hover{color:var(--accent);}
  .lg-tn small{display:block;font-size:11.5px;color:var(--text3);font-weight:600;margin-top:2px;}
  .lg-tn .rk{font-family:'Inter',sans-serif;font-size:12px;color:var(--text3);font-weight:700;margin-right:5px;}
  .lg-sc{font-family:'Playfair Display',serif;font-size:38px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);}
  .lg-team.lose .lg-sc,.lg-team.lose .n{color:var(--text3);}
  .lg-ps{color:var(--accent);font-size:10px;margin-left:6px;vertical-align:3px;}
  .lg-status{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px 16px;font-size:13px;color:var(--text2);border-top:1px solid var(--border);padding-top:10px;}
  .lg-live{color:var(--red);font-weight:800;}
  .lg-lsw{max-height:none;}
  .lg-wph{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px 12px;}
  .lg-wph span{font-size:13px;color:var(--text2);} .lg-wph b{color:var(--text);}
  .lg-chart{width:100%;height:auto;display:block;margin-top:8px;overflow:visible;}
  .lg-chart .sw{cursor:help;}
  .lg-note{font-size:12px;color:var(--text3);margin-top:6px;line-height:1.45;}
  .lg-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;}
  .lg-play{font-size:13px;line-height:1.45;padding:6px 0;border-bottom:1px solid var(--border);color:var(--text2);}
  .lg-play:last-child{border-bottom:none;}
  .lg-play b{color:var(--text);font-variant-numeric:tabular-nums;margin-right:5px;}
  .lg-play span.t{color:var(--text3);font-variant-numeric:tabular-nums;margin-right:5px;}
  .lg-play.scored{background:color-mix(in srgb,var(--accent) 9%,transparent);}
  .lg-run{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text2);}
  .lg-run:last-child{border-bottom:none;}
  .lg-run b{font-size:15px;color:var(--text);font-variant-numeric:tabular-nums;min-width:58px;}
  .lg-chip{font:600 12px/1 'Inter',sans-serif;padding:6px 11px;border-radius:999px;border:1px solid var(--border2,var(--border));background:transparent;color:var(--text2);cursor:pointer;margin-top:10px;}
  .lg-chip:hover{color:var(--text);border-color:var(--text3);}
  .sheet.lg-box tbody tr.totals td{border-top:2px solid var(--border2);}
  .lg-err{font-size:12.5px;color:var(--red);}
  @media(max-width:640px){.lg-board{grid-template-columns:1fr;}.lg-sc{font-size:30px;}.lg-tn .n{font-size:19px;}.lg-card{padding:12px;}}`;
  let cssDone = false;
  function css() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

  // pregame line needs the ratings stack; the plain box-score page doesn't load it, so pull it in on demand
  function loadScript(src) {
    return new Promise(res => {
      if (document.querySelector(`script[src^="${src.split('?')[0]}"]`)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = s.onerror = () => res(); document.head.appendChild(s);
    });
  }
  let _deps = null;
  function deps() {
    if (!_deps) _deps = loadScript('team-colors.js?v=10').then(() => loadScript('tdc-ratings.js?v=21')).then(() => loadScript('tdc-schedule.js?v=21'));
    return _deps;
  }

  const periodName = q => q === 1 ? '1st' : q === 2 ? '2nd' : q === 3 ? 'OT' : `${q - 2}OT`;
  const elapsed = (q, clock) => { const c = L().clockSecs(clock); return q <= 2 ? (q - 1) * 1200 + (1200 - Math.min(1200, c)) : 2400 + (q - 3) * 300 + (300 - Math.min(300, c)); };

  function mount(host, id, opts) {
    opts = opts || {};
    css();
    host.innerHTML = '<div class="loading">Loading the live game…</div>';
    let game = null, line = undefined, keyOf = {}, showAll = false, finalFired = false, err = null;
    deps().then(() => {
      if (g.TDC_RATINGS) g.TDC_RATINGS.get().then(D => { (D.teams || []).forEach(t => { keyOf[t.full] = t.team; }); draw(); }).catch(() => {});
    });
    let rz = null, lastW = host.clientWidth;
    g.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (Math.abs(host.clientWidth - lastW) > 30) { lastW = host.clientWidth; draw(); } }, 200); });
    host.addEventListener('click', e => { const b = e.target.closest('[data-allplays]'); if (b) { showAll = !showAll; draw(); } });
    const stop = L().watchGame(id, (d, e) => {
      if (e) { err = e; if (!game) host.innerHTML = '<div class="err">Couldn’t reach the live feed. Retrying…</div>'; else draw(); return; }
      err = null; game = d;
      if (line === undefined) { line = null; deps().then(() => L().pregame(d)).then(l => { line = l; draw(); }).catch(() => {}); }
      draw();
      if (d.state === 'post' && !finalFired) { finalFired = true; if (opts.onFinal) opts.onFinal(d); }
    });

    const sheetKey = t => { const k = keyOf[t.name]; return k && k !== t.name ? k : null; };
    const nameOf = t => sheetKey(t) || (g.tdcShortSchool ? g.tdcShortSchool(t.name) : '') || t.loc || t.name;
    const teamLink = t => { const k = sheetKey(t); return k ? `<a href="team.html?team=${encodeURIComponent(k)}">${esc(nameOf(t))}</a>` : esc(nameOf(t)); };

    function series() {
      const spread = line ? line.margin : 0;
      const pts = [{ t: 0, wp: L().winProb({ spread, margin: 0, frac: 1 }), p: null }];
      for (const p of game.plays) {
        const wp = L().winProb({ spread, margin: p.hs - p.as, period: p.q, clock: p.clock });
        pts.push({ t: elapsed(p.q, p.clock), wp, p });
      }
      if (game.state === 'post' && game.home.score != null) pts.push({ t: pts[pts.length - 1].t, wp: game.home.score > game.away.score ? 1 : 0, p: null });
      else if (game.state === 'in') {   // the clock can run past the last logged play
        const nowT = elapsed(game.period || 1, game.clock);
        if (nowT > pts[pts.length - 1].t) pts.push({ t: nowT, wp: L().winProb({ spread, margin: (game.home.score || 0) - (game.away.score || 0), period: game.period, clock: game.clock }), p: null });
      }
      return pts;
    }
    function runs() {
      const out = []; let cur = null, prevH = 0, prevA = 0;
      for (const p of game.plays) {
        const dh = p.hs - prevH, da = p.as - prevA;
        if (dh <= 0 && da <= 0) continue;
        const side = dh > 0 ? 'home' : 'away', pts = dh > 0 ? dh : da;
        if (dh > 0 && da > 0) { cur = null; prevH = p.hs; prevA = p.as; continue; }
        if (cur && cur.side === side) { cur.pts += pts; cur.end = p; }
        else { cur = { side, pts, start: p, end: p, oppPts: 0 }; out.push(cur); }
        prevH = p.hs; prevA = p.as;
      }
      return out.filter(r => r.pts >= 7).sort((a, b) => b.pts - a.pts).slice(0, 6);
    }

    function board() {
      const h = game.home, a = game.away, live = game.state === 'in', fin = game.state === 'post', pre = game.state === 'pre';
      const team = (t, o, home) => `<div class="lg-team${fin && t.score < o.score ? ' lose' : ''}">
        <img src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'">
        <div class="lg-tn"><span class="n">${t.rank ? `<span class="rk">${t.rank}</span>` : ''}${teamLink(t)}${live && game.poss === t.id ? '<span class="lg-ps" title="Possession">●</span>' : ''}</span>
          <small>${home ? (game.neutral ? 'Neutral site' : 'Home') : 'Away'}${t.record ? ' · ' + esc(t.record) : ''}</small></div>
        <div class="lg-sc">${pre ? '–' : (t.score != null ? t.score : '–')}</div></div>`;
      const nq = Math.max(h.halves.length, a.halves.length);
      const ls = nq ? `<div class="sheet-wrap lg-lsw"><table class="sheet dense lg-ls"><thead><tr><th class="l">Team</th>${Array.from({ length: nq }, (_, i) => `<th>${periodName(i + 1)}</th>`).join('')}<th>T</th></tr></thead><tbody>
        ${[a, h].map(t => `<tr><td class="l nm">${esc(t.abbr)}</td>${Array.from({ length: nq }, (_, i) => `<td>${t.halves[i] != null ? t.halves[i] : ''}</td>`).join('')}<td class="big">${t.score != null ? t.score : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
      const status = live ? `<span class="lg-live">LIVE · ${esc(game.detail)}</span>` : `<b>${esc(game.detail)}</b>`;
      return `<section class="lg-card"><div class="lg-board">${team(a, h, false)}${team(h, a, true)}
        <div class="lg-status"><span>${status}${game.venue ? ` · ${esc(game.venue)}` : ''}${err ? ' · <span class="lg-err">feed hiccup, retrying</span>' : ''}</span>${ls}</div></div></section>`;
    }

    function chart() {
      const s = series(), h = game.home, a = game.away;
      const now = s[s.length - 1].wp;
      const nOT = Math.max(0, (game.period || 0) - 2, ...game.plays.map(p => p.q - 2));
      const T = 2400 + nOT * 300;
      const W = Math.round(Math.max(300, Math.min(720, (host.clientWidth || 720) - 34))), H = W < 500 ? 170 : 200, TOP = 22, X = t => (t / T) * W, Y = p => TOP + H - p * H;
      const path = s.map((x, i) => `${i ? 'L' : 'M'}${X(x.t).toFixed(1)},${Y(x.wp).toFixed(1)}`).join('');
      const area = `${path}L${X(s[s.length - 1].t).toFixed(1)},${Y(.5)}L0,${Y(.5)}Z`;
      const swings = s.slice(1).map((x, i) => ({ ...x, d: x.wp - s[i].wp })).filter(x => x.p).sort((u, v) => Math.abs(v.d) - Math.abs(u.d)).slice(0, 5).filter(x => Math.abs(x.d) >= 0.02);
      const spread = line ? line.margin : null;
      const lineTxt = spread == null ? 'no pregame line' : Math.abs(spread) < .05 ? 'pregame pick’em' : `pregame ${esc(nameOf(spread > 0 ? h : a))} −${Math.abs(spread).toFixed(1)}`;
      const lead = now >= 0.5 ? h : a;
      const headline = game.state === 'post' ? `<b>${esc(nameOf(h.score > a.score ? h : a))} won</b>` : game.state === 'pre' ? `<b>${esc(nameOf(lead))} ${Math.round(Math.max(now, 1 - now) * 100)}%</b> to win` : `<b>${esc(nameOf(lead))} ${Math.round(Math.max(now, 1 - now) * 100)}%</b>`;
      const marks = [1200, ...Array.from({ length: nOT }, (_, i) => 2400 + i * 300)];
      const labels = [['1st half', 600], ['2nd half', 1800], ...Array.from({ length: nOT }, (_, i) => [nOT > 1 ? `OT${i + 1}` : 'OT', 2400 + i * 300 + 150])];
      return `<section class="lg-card">
        <div class="lg-wph"><h2>Win probability</h2><span>${headline} · ${lineTxt}</span></div>
        <svg class="lg-chart" viewBox="0 0 ${W} ${TOP + H + 40}" role="img" aria-label="Win probability chart; ${esc(nameOf(h))} now ${Math.round(now * 100)}%">
          ${[0.25, 0.5, 0.75].map(p => `<line x1="0" x2="${W}" y1="${Y(p)}" y2="${Y(p)}" stroke="var(--border)" ${p === 0.5 ? '' : 'stroke-dasharray="3 4"'}/>`).join('')}
          ${marks.map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${TOP}" y2="${TOP + H}" stroke="var(--border)"/>`).join('')}
          ${labels.map(([l, t]) => `<text x="${X(t)}" y="${TOP + H + 15}" text-anchor="middle" font-size="11" fill="var(--text3)">${l}</text>`).join('')}
          <text x="0" y="13" font-size="11" font-weight="700" fill="var(--text2)">▲ ${esc(nameOf(h))}</text>
          <text x="0" y="${TOP + H + 34}" font-size="11" font-weight="700" fill="var(--text2)">▼ ${esc(nameOf(a))}</text>
          <path d="${area}" fill="var(--accent)" opacity=".08"/>
          <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round"/>
          ${game.state === 'in' ? `<circle cx="${X(s[s.length - 1].t)}" cy="${Y(now)}" r="5" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>` : ''}
          ${swings.map(x => `<circle class="sw" cx="${X(x.t).toFixed(1)}" cy="${Y(x.wp).toFixed(1)}" r="5" fill="var(--text)" stroke="var(--bg)" stroke-width="1.5"><title>${esc(nameOf(x.d > 0 ? h : a))} +${Math.abs(Math.round(x.d * 100))}% win probability · ${periodName(x.p.q)} ${esc(x.p.clock)} · ${esc(x.p.text)}</title></circle>`).join('')}
        </svg>
        <p class="lg-note">The TDC pregame line blended with the score and the clock (calibrated on every play of 314 games from 2025-26). Dots mark the biggest swings; hover one to see the play.</p>
      </section>`;
    }

    function sidebars() {
      const h = game.home, a = game.away, s = series();
      const swings = s.slice(1).map((x, i) => ({ ...x, d: x.wp - s[i].wp })).filter(x => x.p).sort((u, v) => Math.abs(v.d) - Math.abs(u.d)).slice(0, 5).filter(x => Math.abs(x.d) >= 0.02);
      const R = runs();
      const tm = side => side === 'home' ? h : a;
      const runsHtml = R.length ? R.map(r => `<div class="lg-run"><b>${r.pts}–0</b><span>${esc(nameOf(tm(r.side)))} run · ${periodName(r.start.q)} ${esc(r.start.clock)}${r.end !== r.start ? ` to ${r.end.q !== r.start.q ? periodName(r.end.q) + ' ' : ''}${esc(r.end.clock)}` : ''}</span></div>`).join('')
        : '<div class="lg-note">No run of 7 or more yet.</div>';
      const swingHtml = swings.length ? swings.map(x => `<div class="lg-play"><b>${esc(x.d > 0 ? h.abbr : a.abbr)} +${Math.abs(Math.round(x.d * 100))}%</b><span class="t">${periodName(x.p.q)} ${esc(x.p.clock)}</span>${esc(x.p.text)}</div>`).join('')
        : '<div class="lg-note">Nothing yet.</div>';
      const skip = /^(Team Turnovers|Total Turnovers|Technical Fouls|Total Technical Fouls|Flagrant Fouls)$/;
      const bx = game.box, byId = {}; bx.forEach(b => { byId[b.id] = b; });
      const A = byId[a.id], Hh = byId[h.id];
      const ts = A && Hh ? `<div class="sheet-wrap"><table class="sheet dense lg-ts"><thead><tr><th class="l">Stat</th><th>${esc(a.abbr)}</th><th>${esc(h.abbr)}</th></tr></thead><tbody>
          ${Hh.stats.filter(([l]) => !skip.test(l)).map(([l, v]) => { const av = (A.stats.find(x => x[0] === l) || [])[1]; return `<tr><td class="l dim">${esc(l)}</td><td>${esc(av != null ? av : '')}</td><td>${esc(v)}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<div class="lg-note">Team stats appear once the game starts.</div>';
      return `<div class="lg-cols">
        <section class="lg-card"><h2>Scoring runs</h2>${runsHtml}<h2 style="margin-top:16px">Biggest swings</h2>${swingHtml}</section>
        <section class="lg-card"><h2>Team stats</h2>${ts}</section></div>`;
    }

    function playerBox() {
      const order = [game.away, game.home];
      const idx = (labels, k) => labels.indexOf(k);
      return order.map(t => {
        const tp = game.players.find(x => x.id === t.id); if (!tp || !tp.athletes.length) return '';
        const L_ = tp.labels, v = (a, k) => { const i = idx(L_, k); return i >= 0 ? (a[i] != null ? a[i] : '') : ''; };
        const split = (x) => { const m = /^(\d+)-(\d+)$/.exec(x || ''); return m ? [+m[1], +m[2]] : [0, 0]; };
        const rate = st => {
          if (typeof g.playerRating !== 'function' || !st.length || !(+v(st, 'MIN') > 0)) return null;
          const [fgm, fga] = split(v(st, 'FG')), [tpm, tpa] = split(v(st, '3PT')), [ftm, fta] = split(v(st, 'FT'));
          return g.playerRating({ pts: +v(st, 'PTS'), fgm, fga, tpm, tpa, ftm, fta, oreb: +v(st, 'OREB'), dreb: +v(st, 'DREB'), stl: +v(st, 'STL'), ast: +v(st, 'AST'), blk: +v(st, 'BLK'), pf: +v(st, 'PF'), tov: +v(st, 'TO') });
        };
        const played = tp.athletes.filter(a => !a.dnp).sort((x, y) => (y.starter ? 1 : 0) - (x.starter ? 1 : 0) || (+v(y.stats, 'MIN') || 0) - (+v(x.stats, 'MIN') || 0));
        // the site sheet: one line per player, plain numbers shaded within the team (tdcSheetHeat, run in draw());
        // FG/3PT/FT shade by their percentage; the totals row spans Player+Role so the shading skips it
        const pv = x => { const [m, at] = split(x); return at > 0 ? (m / at * 100).toFixed(1) : ''; };
        const stat = (st, k, cls) => `<td${cls || ''}>${esc(v(st, k))}</td>`;
        const shoot = (st, k, cls) => `<td${cls || ''} data-v="${pv(v(st, k))}">${esc(v(st, k))}</td>`;
        const rows = played.map(a => {
          const r = rate(a.stats);
          return `<tr><td class="l nm"><a href="player.html?espn=${esc(a.id)}&name=${encodeURIComponent(a.name)}">${esc(a.name)}</a></td><td class="l dim">${a.starter ? 'Starter' : 'Bench'}</td>
            <td title="0-10 game rating so far">${r == null ? '' : r.toFixed(1)}</td>${stat(a.stats, 'MIN')}${shoot(a.stats, 'FG')}${shoot(a.stats, '3PT')}${shoot(a.stats, 'FT')}
            ${stat(a.stats, 'REB')}${stat(a.stats, 'AST')}${stat(a.stats, 'STL')}${stat(a.stats, 'BLK')}
            ${stat(a.stats, 'TO')}${stat(a.stats, 'PF')}<td class="big">${esc(v(a.stats, 'PTS'))}</td></tr>`;
        }).join('');
        const T = tp.totals || [], S = ' class="strong"';
        const tot = T.length ? `<tr class="totals"><td class="l strong" colspan="2">Team</td><td></td><td></td>${shoot(T, 'FG', S)}${shoot(T, '3PT', S)}${shoot(T, 'FT', S)}
          ${stat(T, 'REB', S)}${stat(T, 'AST', S)}${stat(T, 'STL', S)}${stat(T, 'BLK', S)}${stat(T, 'TO', S)}${stat(T, 'PF', S)}<td class="big">${esc(v(T, 'PTS'))}</td></tr>` : '';
        const th = (l, heat, tip) => `<th${heat ? ` data-heat="${heat}"` : ''}${tip ? ` title="${tip}"` : ''}>${l}</th>`;
        return `<div class="bs"><div class="bs-team">${esc(nameOf(t))}</div><div class="sheet-wrap"><table class="sheet dense freeze lg-box"><thead><tr>
          <th class="l">Player</th><th class="l">Role</th>${th('RTG', 1, '0-10 game rating so far, same scale as the player pages')}${th('Min')}${th('FG', 1, 'Field goals made-attempted, shaded by FG%')}${th('3PT', 1, 'Threes made-attempted, shaded by 3P%')}${th('FT', 1, 'Free throws made-attempted, shaded by FT%')}
          ${th('Reb', 1)}${th('Ast', 1)}${th('Stl', 1)}${th('Blk', 1)}${th('TO', -1)}${th('PF', -1)}${th('Pts', 1)}</tr></thead><tbody>${rows}${tot}</tbody></table></div></div>`;
      }).join('');
    }

    function feed() {
      const f = game.plays.slice().reverse().filter(p => p.type !== 'Substitution');
      if (!f.length) return '';
      const list = showAll ? f : f.slice(0, 25);
      return `<section class="lg-card"><h2>${game.state === 'in' ? 'Recent plays' : 'Play by play'}</h2>
        ${list.map(p => `<div class="lg-play${p.score ? ' scored' : ''}"><span class="t">${periodName(p.q)} ${esc(p.clock)}</span>${p.score ? `<b>${p.as}–${p.hs}</b>` : ''}${esc(p.text)}</div>`).join('')}
        ${f.length > 25 ? `<button class="lg-chip" data-allplays="1">${showAll ? 'Show latest 25' : `Show all ${f.length} plays`}</button>` : ''}</section>`;
    }

    function draw() {
      if (!game) return;
      document.title = `${nameOf(game.away)} at ${nameOf(game.home)} — ${game.state === 'in' ? 'Live' : 'Box Score'}`;
      const hasPlays = game.plays.length > 0;
      const pbox = playerBox();
      host.innerHTML = `<div class="lg">${board()}${hasPlays || game.state !== 'pre' ? chart() : ''}${hasPlays ? sidebars() : ''}${pbox ? `<section class="lg-card"><h2>Box score</h2>${pbox}</section>` : ''}${feed()}</div>`;
      if (g.tdcSheetHeat) host.querySelectorAll('table.lg-box').forEach(t => g.tdcSheetHeat(t));
    }
    return { stop };
  }

  g.TDCLiveGame = { mount };
})(window);
