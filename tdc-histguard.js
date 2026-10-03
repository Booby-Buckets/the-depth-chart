/* tdc-histguard.js — which player_history rows really belong to a roster player.
 *
 * Several engines (projection-engine.js and its copies on team / projections / team-stats / draft pages,
 * the player page's id recovery) look history up by NAME. Names collide: USC freshman Christian Collins
 * inherited a 2012 Towson Christian Collins (0.8 ppg), which turned a top recruit into a "transfer"
 * and gave him a different projection and overall on every page that used it.
 *
 * tdcHistFor(player, rows) keeps only the rows that are this person:
 *   - he has an ESPN id → rows with that id (anything else under his name is a namesake)
 *   - no id and a freshman who isn't a listed transfer → no history
 *   - no id otherwise → one person who played in the last four seasons; when the roster names the school
 *     he came from ("George Mason (24-25)") it has to be that school; ambiguous → no history
 */
(function (g) {
  const RECENT = 2023;   // 2022-23 or later: a roster player's real history is never older than this
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function fromSchool(p) {   // the roster's transfer marker
    const m = String(p.hometown || p.from || '').match(/^(.+?)\s*\(\d{2}-\d{2}\)/);
    return m ? norm(m[1]) : null;
  }
  function isFreshman(p) { return /^(r-)?fr/i.test(String(p.class_year || p.yr || '').trim()); }
  function pickId(p, rows) {
    const recent = rows.filter(r => +r.season_year >= RECENT && r.espn_id != null);
    if (!recent.length) return null;
    const from = fromSchool(p);
    if (from) {
      const ids = [...new Set(recent.filter(r => { const t = norm(r.team); return t && (t.indexOf(from) === 0 || from.indexOf(t) === 0); }).map(r => r.espn_id))];
      if (ids.length === 1) return ids[0];
    }
    const ids = [...new Set(recent.map(r => r.espn_id))];
    return ids.length === 1 ? ids[0] : null;
  }
  function tdcHistFor(p, rows) {
    if (!p || !rows || !rows.length) return rows || null;
    const id = p.espn_id != null && p.espn_id !== '' ? String(p.espn_id) : null;
    if (id) return rows.filter(r => String(r.espn_id) === id || (r.espn_id == null && r.team === p.team));
    if (isFreshman(p) && !fromSchool(p)) return [];
    const pid = pickId(p, rows);
    return pid == null ? [] : rows.filter(r => r.espn_id === pid);
  }
  g.tdcHistFor = tdcHistFor;
  g.tdcHistPickId = (p, rows) => (p && p.espn_id) ? p.espn_id : ((isFreshman(p) && !fromSchool(p)) ? null : pickId(p, rows || []));
})(typeof window !== 'undefined' ? window : globalThis);
