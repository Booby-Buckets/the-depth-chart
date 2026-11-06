/* tdc-reallines.js — real season-to-date lines and the site-wide Real / Projected filter (owner, Nov 2026).
 *
 * Data: scripts/data/real_lines_2027.json (scripts/build_real_lines.py, three times a day), season TOTALS from box_scores.
 * The viewer's choice is remembered across pages. Real is the default; a page re-renders on the 'tdc:statmode' event.
 *
 *   TDCReal.ready            promise, resolves once the file is in (or failed: of() then returns null)
 *   TDCReal.mode()           'real' | 'proj'      TDCReal.setMode(m)      TDCReal.isReal()
 *   TDCReal.of(player)       per-game line by espn_id, same field names as TDCProjGrade.lineOf, or null if he hasn't played
 *   TDCReal.team(name)       a team's per-game line + w, l, opp_ppg, or null. Takes the ESPN full or the sheet short name
 *   TDCReal.through()        date of the last game counted
 *   TDCReal.control(host, o) mounts the two-button filter; o.onChange(mode) is optional, the event always fires
 *   TDCReal.ovrReady()       promise: loads scripts/data/ovr_history_2027.json (scripts/snapshot_ovr.py) on first use
 *   TDCReal.ovrMove(player)  {from, to, delta, since, history:[[date, ovr],...]} since preseason, or null
 *   TDCReal.MIN_G            below this many real games, percentile reads stay on the projection (one hot game is not a skill)
 */
(function () {
  if (window.TDCReal) return;
  var KEY = 'tdcStatMode', MODE = 'real', DOC = null;
  try { var saved = localStorage.getItem(KEY); if (saved === 'proj' || saved === 'real') MODE = saved; } catch (e) {}
  var ready = fetch('scripts/data/real_lines_2027.json?h=' + Math.floor(Date.now() / 36e5))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { DOC = j; return j; })
    .catch(function () { return null; });

  function rd(v) { return Math.round(v * 10) / 10; }
  function pct(m, a) { return a > 0 ? Math.round(1000 * m / a) / 10 : null; }
  function line(t) {
    var g = t.g; if (!(g > 0)) return null;
    var A = function (k) { return rd((+t[k] || 0) / g); };
    return { _real: true, gp: g, gs: t.gs || 0, mpg: A('min'), ppg: A('pts'), rpg: rd(((+t.oreb || 0) + (+t.dreb || 0)) / g), apg: A('ast'),
      oreb: A('oreb'), dreb: A('dreb'), stl: A('stl'), blk: A('blk'), tovs: A('tov'), pf: A('pf'),
      fgm: A('fgm'), fga: A('fga'), tpm: A('tpm'), tpa: A('tpa'), ftm: A('ftm'), fta: A('fta'),
      fg_pct: pct(+t.fgm || 0, +t.fga || 0), tp_pct: pct(+t.tpm || 0, +t.tpa || 0), ft_pct: pct(+t.ftm || 0, +t.fta || 0) };
  }
  function teamRow(name) {
    if (!DOC || !name) return null;
    if (DOC.teams[name]) return DOC.teams[name];
    // the exact sheet -> full name list, never a prefix guess: "UMass" also starts UMass Lowell, "Penn" Penn State
    var f = (DOC.alias || {})[name];
    return f ? (DOC.teams[f] || null) : null;
  }
  function fire() { try { window.dispatchEvent(new CustomEvent('tdc:statmode', { detail: { mode: MODE } })); } catch (e) {} }
  function setMode(m) {
    if (m !== 'real' && m !== 'proj') return;
    var changed = m !== MODE; MODE = m;
    try { localStorage.setItem(KEY, m); } catch (e) {}
    document.querySelectorAll('.tdc-mode button').forEach(function (b) { var on = b.getAttribute('data-m') === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (changed) fire();
  }
  function css() {
    if (document.getElementById('tdc-mode-css')) return;
    var s = document.createElement('style'); s.id = 'tdc-mode-css';
    s.textContent = '.tdc-mode{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--bg2);vertical-align:middle;flex:0 0 auto}' +
      '.tdc-mode button{appearance:none;border:0;background:none;border-radius:7px;padding:6px 12px;font:700 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);cursor:pointer;min-height:30px}' +
      '.tdc-mode button:hover{color:var(--text)}' +
      '.tdc-mode button.on{background:var(--accent,#A88847);color:var(--accent-on,#fff)}' +
      '.tdc-mode-note{font:500 11px Inter,system-ui,sans-serif;color:var(--text3)}' +
      '@media(max-width:640px){.tdc-mode button{min-height:34px;padding:6px 14px}}';
    document.head.appendChild(s);
  }
  function control(host, o) {
    if (!host) return null; o = o || {}; css();
    var w = document.createElement('div'); w.className = 'tdc-mode'; w.setAttribute('role', 'group'); w.setAttribute('aria-label', 'Show real or projected stats');
    [['real', 'Real'], ['proj', 'Projected']].forEach(function (x) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = x[1]; b.setAttribute('data-m', x[0]);
      var on = x[0] === MODE; b.className = on ? 'on' : ''; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () { setMode(x[0]); if (o.onChange) o.onChange(x[0]); });
      w.appendChild(b);
    });
    host.appendChild(w);
    return w;
  }
  // many roster rows have no espn_id yet: match on name + team, and only when exactly one player fits
  var _names = null;
  function nk(x) { return String(x || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function byName(p) {
    if (!p.name || !p.team) return null;
    if (!_names) { _names = {}; [DOC.players, DOC.named || {}].forEach(function (S) { Object.keys(S).forEach(function (k) { var n = nk(S[k].n); (_names[n] = _names[n] || []).push(S[k]); }); }); }
    var full = (DOC.alias || {})[p.team] || p.team, hits = (_names[nk(p.name)] || []).filter(function (r) { return r.t === full; });
    return hits.length === 1 ? hits[0] : null;
  }
  var OH = null, ohP = null;
  function ovrReady() {
    if (!ohP) ohP = fetch('scripts/data/ovr_history_2027.json?h=' + Math.floor(Date.now() / 36e5)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { OH = j; return j; }).catch(function () { return null; });
    return ohP;
  }
  function ovrMove(p) {
    if (!OH || !p) return null;
    var e = p.espn_id != null ? OH.espn[String(p.espn_id)] : null;
    var s = e || OH.fresh[String(p.team || '').trim().toLowerCase() + '|' + String(p.name || '').trim().toLowerCase()];
    if (!s || !s.length) return null;
    var a = s[0][1], b = s[s.length - 1][1];
    return { from: a, to: b, delta: b - a, since: OH.days[s[0][0]], history: s.map(function (x) { return [OH.days[x[0]], x[1]]; }) };
  }
  window.TDCReal = {
    MIN_G: 5, ready: ready, ovrReady: ovrReady, ovrMove: ovrMove,
    mode: function () { return MODE; }, isReal: function () { return MODE === 'real'; }, setMode: setMode, control: control,
    through: function () { return DOC ? DOC.through : null; },
    of: function (p) {
      if (!DOC || !p) return null;
      var r = p.espn_id != null ? DOC.players[String(p.espn_id)] : null;
      return (r || (r = byName(p))) ? line(r) : null;
    },
    team: function (name) {
      var t = teamRow(name); if (!t) return null;
      var l = line(t); if (!l) return null;
      l.w = t.w || 0; l.l = t.l || 0; l.opp_ppg = rd((+t.opts || 0) / t.g);
      return l;
    }
  };
})();
