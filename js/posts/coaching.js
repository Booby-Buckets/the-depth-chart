/* Post: coaches who beat their talent — career coaching lift (data/coach-careers.json `lf`): the mean, over a coach's seasons,
 * of actual SRS minus the SRS his roster's talent predicted (the same number tdc-ratings.js turns into coachAdj).
 * Current head coach per school = data/coach-2027.json (last season's staffs + the 2026 coaching carousel). */
TDC_POSTS.add('coaching', {
  group: 'Coaching', label: 'Coaches who beat their talent',
  note: 'Career lift = average power-rating points a coach finished above what his roster\'s talent predicted (min. 4 rated seasons). "Least" shows the underachievers.',
  opts: { conf: true, team: false, dir: true, upLabel: 'Overachievers first', downLabel: 'Underachievers first' },
  load: async function (d, H) {
    var now = await H.json('data/coach-2027.json'), car = await H.json('data/coach-careers.json'), rs = await H.ratings();
    var prof = {}; try { (await H.json('scripts/data/coach_profiles.json')).forEach(function (p) { prof[p.coach_slug] = p; }); } catch (e) {}
    var n = Math.max(1, Math.min(20, +d.n || 10)), MIN = 4;
    // a carousel hire is linked by name to a career id; only trust it when first names agree ("Dustin Ford" isn't Dana Ford)
    var NICK = { mike: 'michael', will: 'william', bill: 'william', matt: 'matthew', tom: 'thomas', joe: 'joseph', dave: 'david', chris: 'christopher', jim: 'james', jimmy: 'james', rob: 'robert', bobby: 'robert', danny: 'daniel', steve: 'steven', greg: 'gregory', jon: 'jonathan', pat: 'patrick', tony: 'anthony', andy: 'andrew', josh: 'joshua', zach: 'zachary', jake: 'jacob' };
    var first = function (s) { var f = String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean)[0] || ''; return NICK[f] || f; };
    var rows = [];
    now.forEach(function (x) {
      var c = x && x.c && car[x.c]; if (!c || c.lf == null || (+c.ln || 0) < MIN) return;
      if (first(c.n) !== first(x.n)) return;
      var rt = rs.find(function (t) { return t.full === x.tm; }) || rs.find(function (t) { return H.onTeam(t.full, x.tm) || H.onTeam(t.team, x.tm); });
      if (!rt) return;
      if (d.conf && H.confName(rt.conf) !== d.conf) return;
      var p = prof[x.c] || {}, g = (+c.w || 0) + (+c.l || 0);
      rows.push({ name: x.n, team: rt.team, tag: H.school(rt.full || rt.team) + (x.new ? ' · new' : ''),
        val: H.fmt(c.lf, 1, true), _v: +c.lf,
        yrs: String(c.s || c.ln), rec: c.w + '-' + c.l, wpct: g ? (c.w / g).toFixed(3).replace(/^0/, '') : '',
        pace: p.poss_pg != null ? (+p.poss_pg).toFixed(1) : '', sty: c.a || p.archetype || '' });
    });
    var down = d.dir === 'down';
    rows.sort(function (a, b) { return down ? a._v - b._v : b._v - a._v; });
    return {
      title: (d.conf ? d.conf + ': ' : '') + (down ? 'Coaches who leave wins on the table' : 'Coaches who beat their talent'),
      subtitle: 'Career power-rating points above what their rosters\' talent predicted · ' + H.SEASON + ' head coaches',
      lead: 'Lift / yr', src: 'The Depth Chart coaching model · D-I head-coaching seasons since 2007 (min. ' + MIN + ')',
      cols: [{ k: 'yrs', lab: 'Seasons' }, { k: 'rec', lab: 'Record' }, { k: 'wpct', lab: 'Win %' }, { k: 'pace', lab: 'Pace' }, { k: 'sty', lab: 'Style' }],
      dist: { rec: [], sty: [] },        // text columns: no heat
      rows: rows.slice(0, n), players: false
    };
  }
});
