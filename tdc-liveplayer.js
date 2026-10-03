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
  .lpl-note{font-size:11.5px;color:var(--text3);margin-top:6px;}`;
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
  // today's (or a test) game for this team: {id, state}
  async function gameFor(teamId) {
    if (TEST) return { id: TEST };
    if (!inSeason() || !teamId) return null;
    const now = new Date();
    for (const d of [etDate(now), etDate(new Date(now - 86400e3))]) {
      const sb = await j(`${BASE}/scoreboard?groups=50&limit=400&dates=${d}`);
      const ev = ((sb && sb.events) || []).find(e => (e.competitions[0].competitors || []).some(c => String(c.team && c.team.id) === String(teamId)));
      if (ev && (ev.status.type.state !== 'post' || d === etDate(now))) return { id: ev.id, state: ev.status.type.state };
    }
    return null;
  }
  function header(sum, id) {
    const c = sum.header.competitions[0], st = c.status.type;
    const H = c.competitors.find(x => x.homeAway === 'home'), A = c.competitors.find(x => x.homeAway === 'away');
    const logo = t => (t.team.logos && t.team.logos[0] && t.team.logos[0].href) || `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.team.id}.png`;
    const live = st.state === 'in';
    return { live, state: st.state, html: `<div class="lpl-h"><span class="${live ? 'lv' : ''}">${live ? '<i></i>LIVE · ' : ''}${esc(st.shortDetail || st.detail)}</span><a href="game.html?id=${esc(id)}">${live ? 'Watch the game →' : 'Box score →'}</a></div>
      <div class="lpl-sc"><img src="${esc(logo(A))}" alt=""><span>${esc(A.team.abbreviation)}</span><b>${esc(A.score)}</b><span class="d">–</span><b>${esc(H.score)}</b><span>${esc(H.team.abbreviation)}</span><img src="${esc(logo(H))}" alt=""></div>` };
  }
  const statsOf = (sum, pred) => {
    for (const tp of (sum.boxscore && sum.boxscore.players) || []) {
      const sx = (tp.statistics || [])[0]; if (!sx) continue;
      for (const a of sx.athletes || []) if (pred(a, tp)) return { labels: sx.labels || [], stats: a.stats || [], a, team: tp.team };
    }
    return null;
  };
  const val = (r, k) => { const i = r.labels.indexOf(k); return i >= 0 ? r.stats[i] : ''; };

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
        return `<div><h4>${esc(tp.team.displayName || tp.team.abbreviation)}</h4>${rows.map(r => `<div><a href="player.html?espn=${esc(r.id)}" style="color:inherit"><b>${esc(r.n)}</b></a> · ${esc(r.s[ix('PTS')])} pts, ${esc(r.s[ix('REB')])} reb, ${esc(r.s[ix('AST')])} ast · ${esc(r.s[ix('FG')])} FG</div>`).join('')}</div>`;
      }).join('');
      host.innerHTML = `<div class="lpl${h.live ? '' : ' fin'}">${h.html}${cols ? `<div class="lpl-tops">${cols}</div>` : ''}${h.live ? '<div class="lpl-note">Top scorers so far · updates every 20 seconds.</div>' : ''}</div>`;
      return h.live ? 20000 : 0;
    });
  }

  g.TDCLivePlayer = { player, team };
})(window);
