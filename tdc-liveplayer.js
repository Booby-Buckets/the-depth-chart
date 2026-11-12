/* tdc-liveplayer.js — live stat lines while a game is on, outside the game page.
 *   TDCLivePlayer.player(hostOrId, espnId)   player page: "LIVE · 2nd 8:41 · DUKE 61–58 UNC" + the player's
 *                                        line so far (PTS REB AST, FG/3PT/FT, MIN, PF), refreshed every 20s
 *   TDCLivePlayer.team(hostOrId, teamId)   team page: the score, clock and each team's top performers
 * Both stay empty unless the team is playing today (or finished today, shown as Final). Data is ESPN's
 * scoreboard + game summary (CORS-open, the same feed the live game page uses). Test on any past game:
 * ?livegame=<ESPN game id> on the player or team page.
 */
(function (g) {
  'use strict';
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
  const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/athletes/';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const qs = new URLSearchParams(g.location ? g.location.search : '');
  const TEST = /^\d{6,12}$/.test(qs.get('livegame') || '') ? qs.get('livegame') : null;
  const inSeason = () => { const m = new Date().getMonth(); return m >= 10 || m <= 3; };
  const etDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
  const j = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

  const CSS = `
  .lpl{border:1px solid color-mix(in srgb,var(--red,#c0392b) 40%,var(--border));border-radius:12px;background:var(--bg);padding:12px 14px;margin:14px 0;font-family:'Inter',system-ui,sans-serif;}
  .lpl.fin{border-color:var(--border);}
  .lpl-h{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);}
  .lpl-h .lv{color:var(--red,#c0392b);} .lpl-h .lv i{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:6px;vertical-align:1px;animation:lplp 1.6s infinite;}
  @keyframes lplp{50%{opacity:.25}} @media (prefers-reduced-motion:reduce){.lpl-h .lv i{animation:none}}
  .lpl-h a{color:var(--accent);text-decoration:none;letter-spacing:0;text-transform:none;font-size:12.5px;}
  .lpl-sc{display:flex;align-items:center;gap:10px;margin:8px 0 6px;font-size:15px;font-weight:700;color:var(--text);flex-wrap:wrap;}
  .lpl-sc img{width:22px;height:22px;object-fit:contain;} .lpl-sc b{font-size:20px;font-variant-numeric:tabular-nums;} .lpl-sc .d{color:var(--text3);}
  .lpl-line{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;}
  .lpl-big{display:flex;gap:16px;} .lpl-big div{text-align:center;} .lpl-big b{display:block;font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);} .lpl-big span{font-size:10.5px;font-weight:800;color:var(--text3);letter-spacing:.05em;}
  .lpl-sm{font-size:13px;color:var(--text2);font-variant-numeric:tabular-nums;} .lpl-sm b{color:var(--text);}
  .lpl-tops{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px 18px;margin-top:4px;}
  .lpl-tops h4{margin:0 0 3px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);}
  .lpl-tops div{font-size:13px;color:var(--text2);padding:2px 0;} .lpl-tops div b{color:var(--text);}
  .lpl-note{font-size:11.5px;color:var(--text3);margin-top:6px;}
  /* the score bug (owner, Nov 12 2026): TV-style bar — team-colour edges, logos, records, big scores, status chip */
  .lpl-bug{max-width:760px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:stretch;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg2);margin:6px 0 10px;}
  .lpl-bt{display:flex;align-items:center;gap:12px;padding:10px 16px;min-width:0;position:relative;}
  .lpl-bt::before{content:'';position:absolute;top:0;bottom:0;width:5px;background:var(--bc,#666);}
  .lpl-bt.a::before{left:0;} .lpl-bt.h{justify-content:flex-end;text-align:right;} .lpl-bt.h::before{right:0;}
  .lpl-bt img{width:40px;height:40px;object-fit:contain;flex:0 0 40px;}
  .lpl-bn{min-width:0;display:flex;flex-direction:column;}
  .lpl-bn a{font-size:17px;font-weight:800;color:var(--text);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em;}
  .lpl-bn span{font-size:11.5px;color:var(--text3);font-weight:600;font-variant-numeric:tabular-nums;}
  .lpl-bs{font-size:38px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);line-height:1;margin-left:auto;}
  .lpl-bt.h .lpl-bs{margin-left:0;margin-right:auto;}
  .lpl-bt.lose .lpl-bs,.lpl-bt.lose .lpl-bn a{color:var(--text3);}
  .lpl-bm{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px 16px;border-left:1px solid var(--border);border-right:1px solid var(--border);background:var(--bg);min-width:96px;}
  .lpl-bm b{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text);}
  .lpl-bm b.lv{color:var(--red,#c0392b);} .lpl-bm b.lv i{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:5px;vertical-align:1px;animation:lplp 1.6s infinite;}
  .lpl-bm span{font-size:11px;color:var(--text3);font-weight:600;white-space:nowrap;}
  .lpl-bm a{font-size:11.5px;font-weight:700;color:var(--accent);text-decoration:none;white-space:nowrap;}
  .lpl-tops h4{display:flex;align-items:center;gap:6px;} .lpl-tops h4 i{width:8px;height:8px;border-radius:50%;background:var(--bc,#888);display:inline-block;}
  .lpl-tops a{text-decoration:none;}
  .lpl-wrap{max-width:1400px;margin:0 auto;padding:0 64px;}
  @media(max-width:860px){ .lpl-wrap{padding:0 16px;} }
  @media(max-width:640px){ .lpl{padding:10px;} .lpl-bt{padding:8px 8px 8px 12px;gap:6px;} .lpl-bt.h{padding:8px 12px 8px 8px;} .lpl-bt img{width:24px;height:24px;flex-basis:24px;}
    .lpl-bn{flex:0 0 auto;} .lpl-bn a{font-size:13px;overflow:visible;} .lpl-bn span{font-size:10.5px;} .lpl-bs{font-size:24px;} .lpl-bm{min-width:0;padding:6px 8px;} .lpl-bm b{font-size:10.5px;letter-spacing:.08em;} .lpl-bm span{display:none;} .lpl-bm a{font-size:10.5px;}
    .lpl-tops div{font-size:12.5px;} }`;
  let cssDone = false;
  const css = () => { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); };

  async function teamOfAthlete(espnId) {
    const k = 'tdc_ath_team_' + espnId;
    try { const c = sessionStorage.getItem(k); if (c) return c; } catch (e) {}
    const a = await j(CORE + espnId);
    const m = a && a.team && /teams\/(\d+)/.exec(a.team.$ref || '');
    const tid = m ? m[1] : null;
    try { if (tid) sessionStorage.setItem(k, tid); } catch (e) {}
    return tid;
  }
  const boards = {};   // one scoreboard fetch per date per page view, shared by the live line and finals()
  const board = d => boards[d] || (boards[d] = j(`${BASE}/scoreboard?groups=50&limit=400&dates=${d}`));
  // today's (or a test) game for this team: {id, state}
  async function gameFor(teamId) {
    if (TEST) return { id: TEST };
    if (!inSeason() || !teamId) return null;
    const now = new Date();
    for (const d of [etDate(now), etDate(new Date(now - 86400e3))]) {
      const sb = await board(d);
      const ev = ((sb && sb.events) || []).find(e => (e.competitions[0].competitors || []).some(c => String(c.team && c.team.id) === String(teamId)));
      if (ev && (ev.status.type.state !== 'post' || d === etDate(now))) return { id: ev.id, state: ev.status.type.state };
    }
    return null;
  }
  function header(sum, id) {
    const c = sum.header.competitions[0], st = c.status.type;
    const H = c.competitors.find(x => x.homeAway === 'home'), A = c.competitors.find(x => x.homeAway === 'away');
    const logo = t => (t.team.logos && t.team.logos[0] && t.team.logos[0].href) || `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.team.id}.png`;
    const live = st.state === 'in', done = st.state === 'post';
    const col = t => { const h = (t.team.color || '').replace('#', ''); return /^[0-9a-f]{6}$/i.test(h) ? '#' + h : '#777'; };
    const rec = t => { const r = (t.record || []).find(x => x.type === 'total') || (t.record || [])[0]; return r ? (r.summary || r.displayValue || '') : ''; };
    const win = t => done && +t.score > +((t === H ? A : H).score);
    const side = (t, cls) => `<div class="lpl-bt ${cls}${done && !win(t) ? ' lose' : ''}" style="--bc:${col(t)}">` +
      (cls === 'a' ? `<img src="${esc(logo(t))}" alt="">` : '') +
      (cls === 'h' ? `<b class="lpl-bs">${esc(t.score)}</b>` : '') +
      `<div class="lpl-bn"><a href="team.html?team=${encodeURIComponent(t.team.location || t.team.displayName)}">${esc(t.team.abbreviation || t.team.shortDisplayName)}</a><span>${esc(rec(t))}${t.curatedRank && t.curatedRank.current && t.curatedRank.current < 26 ? ' · #' + t.curatedRank.current : ''}</span></div>` +
      (cls === 'a' ? `<b class="lpl-bs">${esc(t.score)}</b>` : '') +
      (cls === 'h' ? `<img src="${esc(logo(t))}" alt="">` : '') + '</div>';
    const when = c.date ? new Date(c.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : '';
    const mid = `<div class="lpl-bm"><b class="${live ? 'lv' : ''}">${live ? '<i></i>' : ''}${esc(live ? (st.shortDetail || st.detail) : done ? (st.shortDetail || 'Final') : (st.shortDetail || st.detail))}</b>` +
      (when && !live ? `<span>${esc(when)}</span>` : '') + `<a href="game.html?id=${esc(id)}">${live ? 'Watch →' : 'Box score →'}</a></div>`;
    return { live, state: st.state, cols: { [String(H.team.id)]: col(H), [String(A.team.id)]: col(A) }, html: `<div class="lpl-bug">${side(A, 'a')}${mid}${side(H, 'h')}</div>` };
  }
  const statsOf = (sum, pred) => {
    for (const tp of (sum.boxscore && sum.boxscore.players) || []) {
      const sx = (tp.statistics || [])[0]; if (!sx) continue;
      for (const a of sx.athletes || []) if (pred(a, tp)) return { labels: sx.labels || [], stats: a.stats || [], a, team: tp.team };
    }
    return null;
  };
  const val = (r, k) => { const i = r.labels.indexOf(k); return i >= 0 ? r.stats[i] : ''; };

  // Finished games from today and yesterday (ET) that ESPN has and our box_scores doesn't yet, as box_scores-shaped rows.
  // GitHub runs the results job only 5-6 times a day (its "every 20 minutes" schedule gets dropped), so without this a
  // player page lags the game page by hours on game nights. have = game ids already loaded from box_scores.
  async function finals(espnId, have) {
    if (!espnId || (!TEST && !inSeason())) return [];
    const seen = new Set((have || []).map(String)), now = new Date(), ids = [];
    if (TEST) ids.push(TEST);
    else {
      const tid = await teamOfAthlete(espnId); if (!tid) return [];
      for (const d of [etDate(now), etDate(new Date(now - 86400e3))]) {
        const sb = await board(d);
        ((sb && sb.events) || []).forEach(e => {
          if (seen.has(String(e.id)) || !(e.status && e.status.type && e.status.type.completed)) return;
          if ((e.competitions[0].competitors || []).some(c => String(c.team && c.team.id) === String(tid))) ids.push(e.id);
        });
      }
    }
    const out = [], n = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; }, pair = v => String(v == null ? '' : v).split('-').map(n);
    for (const id of ids) {
      const sum = await j(`${BASE}/summary?event=${id}`); if (!sum) continue;
      const r = statsOf(sum, a => String(a.athlete && a.athlete.id) === String(espnId));
      if (!r || !r.stats.length || r.a.didNotPlay) continue;
      const comp = sum.header.competitions[0], opp = (comp.competitors || []).find(c => String(c.team.id) !== String(r.team && r.team.id));
      const fg = pair(val(r, 'FG')), tp = pair(val(r, '3PT')), ft = pair(val(r, 'FT')), d = etDate(new Date(comp.date));
      out.push({ game_id: +id, season_year: 2027, _espn: true, date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6), team: r.team && r.team.displayName, opp: opp && opp.team && opp.team.displayName,
        starter: !!r.a.starter, min: n(val(r, 'MIN')), pts: n(val(r, 'PTS')), reb: n(val(r, 'REB')), oreb: n(val(r, 'OREB')), dreb: n(val(r, 'DREB')), ast: n(val(r, 'AST')), stl: n(val(r, 'STL')),
        blk: n(val(r, 'BLK')), tov: n(val(r, 'TO')), pf: n(val(r, 'PF')), fgm: fg[0] || 0, fga: fg[1] || 0, tpm: tp[0] || 0, tpa: tp[1] || 0, ftm: ft[0] || 0, fta: ft[1] || 0 });
    }
    return out.filter(g => g.min > 0).sort((a, b) => a.date.localeCompare(b.date));
  }

  // host may be an element id: pages that re-render their layout would otherwise orphan the element
  const el = h => (typeof h === 'string' ? document.getElementById(h) : h);
  function loop(host, draw) {
    let t = null, stop = false;
    async function tick() {
      if (stop) return;
      let again = 0;
      if (document.visibilityState === 'visible') { try { again = await draw(); } catch (e) { again = 60000; } } else again = 15000;
      if (again && !stop) t = setTimeout(tick, again);
    }
    // hidden tabs get their timers throttled: catch up the moment the tab is visible again
    const vis = () => { if (document.visibilityState === 'visible' && !stop) { clearTimeout(t); tick(); } };
    document.addEventListener('visibilitychange', vis);
    tick();
    return () => { stop = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
  }

  function player(hostRef, espnId) {
    if (!hostRef || !espnId || (!TEST && !inSeason())) return () => {};
    const host = { set innerHTML(v) { const e = el(hostRef); if (e) e.innerHTML = v; } };
    css();
    let gm = null, tid = null;
    return loop(host, async () => {
      if (!gm) { tid = tid || await teamOfAthlete(espnId); gm = await gameFor(tid); if (!gm) { host.innerHTML = ''; return 0; } }
      const sum = await j(`${BASE}/summary?event=${gm.id}`);
      if (!sum) return 60000;
      const h = header(sum, gm.id);
      const r = statsOf(sum, a => String(a.athlete && a.athlete.id) === String(espnId));
      const dnp = !r || !r.stats.length;
      const big = dnp ? '<div class="lpl-sm">Hasn’t checked in yet.</div>'
        : `<div class="lpl-line"><div class="lpl-big"><div><b>${esc(val(r, 'PTS'))}</b><span>PTS</span></div><div><b>${esc(val(r, 'REB'))}</b><span>REB</span></div><div><b>${esc(val(r, 'AST'))}</b><span>AST</span></div></div>
          <div class="lpl-sm"><b>${esc(val(r, 'FG'))}</b> FG · <b>${esc(val(r, '3PT'))}</b> 3PT · <b>${esc(val(r, 'FT'))}</b> FT · <b>${esc(val(r, 'STL'))}</b> STL · <b>${esc(val(r, 'BLK'))}</b> BLK · <b>${esc(val(r, 'TO'))}</b> TO · <b>${esc(val(r, 'PF'))}</b> PF · <b>${esc(val(r, 'MIN'))}</b> MIN</div></div>`;
      host.innerHTML = `<div class="lpl${h.live ? '' : ' fin'}">${h.html}${big}${h.live ? '<div class="lpl-note">Updates every 20 seconds.</div>' : ''}</div>`;
      return h.live ? 20000 : 0;
    });
  }

  function team(hostRef, teamId) {
    if (!hostRef || !teamId || (!TEST && !inSeason())) return () => {};
    const host = { set innerHTML(v) { const e = el(hostRef); if (e) e.innerHTML = v; } };
    css();
    let gm = null;
    return loop(host, async () => {
      if (!gm) { gm = await gameFor(teamId); if (!gm) { host.innerHTML = ''; return 0; } }
      const sum = await j(`${BASE}/summary?event=${gm.id}`);
      if (!sum) return 60000;
      const h = header(sum, gm.id);
      const cols = ((sum.boxscore && sum.boxscore.players) || []).map(tp => {
        const sx = (tp.statistics || [])[0]; if (!sx) return '';
        const L = sx.labels || [], ix = k => L.indexOf(k);
        const rows = (sx.athletes || []).filter(a => (a.stats || []).length).map(a => ({ n: a.athlete.shortName || a.athlete.displayName, id: a.athlete.id, s: a.stats }))
          .sort((x, y) => (+y.s[ix('PTS')] || 0) - (+x.s[ix('PTS')] || 0)).slice(0, 4);
        return `<div><h4 style="--bc:${(h.cols && h.cols[String(tp.team.id)]) || '#888'}"><i></i>${esc(tp.team.displayName || tp.team.abbreviation)}</h4>${rows.map(r => `<div><a href="player.html?espn=${esc(r.id)}" style="color:inherit"><b>${esc(r.n)}</b></a> · ${esc(r.s[ix('PTS')])} pts, ${esc(r.s[ix('REB')])} reb, ${esc(r.s[ix('AST')])} ast · ${esc(r.s[ix('FG')])} FG</div>`).join('')}</div>`;
      }).join('');
      host.innerHTML = `<div class="lpl${h.live ? '' : ' fin'}">${h.html}${cols ? `<div class="lpl-tops">${cols}</div>` : ''}${h.live ? '<div class="lpl-note">Top scorers so far · updates every 20 seconds.</div>' : ''}</div>`;
      return h.live ? 20000 : 0;
    });
  }

  g.TDCLivePlayer = { player, team, finals };
})(window);
