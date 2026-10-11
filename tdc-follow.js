/* tdc-follow.js — follow players and teams (Oct 2026). One store for every page:
     signed in  → public.player_follows / public.team_follows (own rows only, RLS)
     signed out → this browser (localStorage), moved into the account the first time you sign in
   API (window.TDCFollow):
     list()                       → Promise<{players:[{espn_id,name,team}], teams:[name]}>
     has('player'|'team', item)   → bool (after list() has resolved)
     toggle('player'|'team', item)→ Promise<bool following>
     button(kind, item, opts)     → a ☆ Follow / ★ Following <button> that keeps itself in sync
   item: player {espn_id, name, team} · team "Full Team Name" */
(function () {
  'use strict';
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  var LSP = 'tdc_follow_players', LST = 'tdc_follow_teams';
  var cache = null, pending = null, noTable = false, subs = [];
  function sess() { try { var s = JSON.parse(localStorage.getItem('tdc_session') || 'null'); return s && s.access_token && s.user ? s : null; } catch (e) { return null; } }
  function H(s, extra) { var h = { apikey: KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }; for (var k in (extra || {})) h[k] = extra[k]; return h; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { return []; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var pkey = function (p) { return p.espn_id ? 'e' + p.espn_id : 'n' + String(p.name || '').toLowerCase() + '|' + String(p.team || '').toLowerCase(); };
  function emit() { subs.forEach(function (f) { try { f(cache); } catch (e) {} }); }

  function list(force) {
    if (cache && !force) return Promise.resolve(cache);
    if (pending && !force) return pending;
    var s = sess();
    if (!s) { cache = { players: lsGet(LSP), teams: lsGet(LST), local: true }; emit(); return Promise.resolve(cache); }
    var uid = s.user.id;
    pending = Promise.all([
      fetch(SB + '/rest/v1/player_follows?user_id=eq.' + uid + '&select=espn_id,player_name,team,created_at&order=created_at.asc', { headers: H(s) })
        .then(function (r) { if (!r.ok) { noTable = true; return null; } return r.json(); }).catch(function () { noTable = true; return null; }),
      fetch(SB + '/rest/v1/team_follows?user_id=eq.' + uid + '&select=team_name,created_at&order=created_at.asc', { headers: H(s) })
        .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
    ]).then(function (r) {
      var players = r[0] ? r[0].map(function (x) { return { espn_id: x.espn_id, name: x.player_name, team: x.team }; }) : lsGet(LSP);
      var teams = (r[1] || []).map(function (x) { return x.team_name; });
      cache = { players: players, teams: teams, local: false };
      // follows made while signed out move into the account
      var lp = lsGet(LSP), lt = lsGet(LST), moves = [];
      if (!noTable) lp.forEach(function (p) { if (!cache.players.some(function (q) { return pkey(q) === pkey(p); })) moves.push(save('player', p, true)); });
      lt.forEach(function (t) { if (cache.teams.indexOf(t) < 0) moves.push(save('team', t, true)); });
      if (moves.length) return Promise.all(moves).then(function () { if (!noTable) lsSet(LSP, []); lsSet(LST, []); return list(true); });
      pending = null; emit(); return cache;
    });
    return pending;
  }
  function has(kind, item) {
    if (!cache) return false;
    if (kind === 'team') return cache.teams.indexOf(item) >= 0;
    var k = pkey(item); return cache.players.some(function (p) { return pkey(p) === k || (item.espn_id && String(p.espn_id) === String(item.espn_id)); });
  }
  function save(kind, item, add) {
    var s = sess();
    if (!s || (kind === 'player' && noTable)) {   // this browser
      var key = kind === 'team' ? LST : LSP, arr = lsGet(key);
      if (kind === 'team') arr = arr.filter(function (t) { return t !== item; }); else arr = arr.filter(function (p) { return pkey(p) !== pkey(item); });
      if (add) arr.push(kind === 'team' ? item : { espn_id: item.espn_id || null, name: item.name, team: item.team || null });
      lsSet(key, arr); return Promise.resolve(true);
    }
    var uid = s.user.id;
    if (kind === 'team') {
      return add ? fetch(SB + '/rest/v1/team_follows', { method: 'POST', headers: H(s, { Prefer: 'return=minimal' }), body: JSON.stringify({ user_id: uid, team_name: item }) })
        : fetch(SB + '/rest/v1/team_follows?user_id=eq.' + uid + '&team_name=eq.' + encodeURIComponent(item), { method: 'DELETE', headers: H(s) });
    }
    if (add) return fetch(SB + '/rest/v1/player_follows', { method: 'POST', headers: H(s, { Prefer: 'return=minimal,resolution=ignore-duplicates' }),
      body: JSON.stringify({ user_id: uid, espn_id: item.espn_id ? String(item.espn_id) : null, player_name: item.name, team: item.team || null }) });
    var q = item.espn_id ? 'espn_id=eq.' + encodeURIComponent(item.espn_id) : 'player_name=eq.' + encodeURIComponent(item.name) + (item.team ? '&team=eq.' + encodeURIComponent(item.team) : '');
    return fetch(SB + '/rest/v1/player_follows?user_id=eq.' + uid + '&' + q, { method: 'DELETE', headers: H(s) });
  }
  function toggle(kind, item) {
    return list().then(function () {
      var on = !has(kind, item);
      // optimistic: the cache flips at once, the write follows
      if (kind === 'team') { if (on) cache.teams.push(item); else cache.teams = cache.teams.filter(function (t) { return t !== item; }); }
      else { if (on) cache.players.push({ espn_id: item.espn_id || null, name: item.name, team: item.team || null }); else cache.players = cache.players.filter(function (p) { return pkey(p) !== pkey(item) && !(item.espn_id && String(p.espn_id) === String(item.espn_id)); }); }
      emit();
      return Promise.resolve(save(kind, item, on)).then(function () { return on; });
    });
  }
  function button(kind, item, opts) {
    opts = opts || {};
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tdc-follow-btn' + (opts.cls ? ' ' + opts.cls : '');
    var paint = function () { var on = has(kind, item); b.classList.toggle('on', on); b.innerHTML = opts.compact ? (on ? '★' : '☆') : (on ? '★ Following' : '☆ Follow');
      b.title = on ? 'Unfollow' : ('Follow — find it again under Following'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); toggle(kind, item).then(paint); };
    subs.push(paint); list().then(paint); paint();
    return b;
  }
  function onChange(f) { subs.push(f); }
  if (!document.getElementById('tdc-follow-css')) {
    var st = document.createElement('style'); st.id = 'tdc-follow-css';
    st.textContent = '.tdc-follow-btn{font:700 12px Inter,system-ui,sans-serif;border:1px solid var(--border2,#c6c0b2);background:var(--bg,#fff);color:var(--text,#1a1814);border-radius:999px;padding:6px 12px;cursor:pointer;white-space:nowrap}' +
      '.tdc-follow-btn.on{background:var(--accent,#a8843c);border-color:var(--accent,#a8843c);color:#1a1814}' +
      '.pa-follow{display:inline-block;vertical-align:middle;margin-left:16px}.pa-follow .tdc-follow-btn{font-size:12.5px;padding:7px 13px;letter-spacing:0}' +
      '.mpb-fol{position:relative;margin-top:9px}.mpb-fol .tdc-follow-btn{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.55);color:#fff;padding:5px 11px;font-size:11.5px}' +
      '.mpb-fol .tdc-follow-btn.on{background:#fff;color:#14120f;border-color:#fff}';
    (document.head || document.documentElement).appendChild(st);
  }
  window.TDCFollow = { list: list, has: has, toggle: toggle, button: button, onChange: onChange, signedIn: function () { return !!sess(); } };
})();
