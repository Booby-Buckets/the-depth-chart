/* Post: payrolls — estimated 2026-27 payroll, spending power and roster worth for every D-I program (tdc-nil.js payroll model:
 * worth = open-market NIL price of the roster, power = EADA basketball spending + athletics revenue blended with worth,
 * payroll = power and worth 70/30). Same numbers as payroll.html and the team NIL tab. Estimates, not reported contracts. */
TDC_POSTS.add('payrolls', {
  group: 'Teams', label: 'Payrolls (NIL spending)',
  note: 'Estimated 2026-27 payroll by program, from our NIL worth model and the schools\' federal athletics filings (EADA). Not reported contracts.',
  opts: { conf: true, team: false, tier: true, dir: true, upLabel: 'Highest first', downLabel: 'Lowest first', n: 10,
          stats: [['payroll', 'Est. payroll'], ['power', 'Spending power'], ['worth', 'Roster worth'], ['value', 'Value (payroll vs worth)'], ['cpp', 'Payroll per rating point']],
          statsLabel: 'Rank by' },
  load: async function (d, H) {
    var N = window.TDC_NIL; if (!N) await H.needScript('tdc-nil.js?v=pay1'); N = window.TDC_NIL;
    var res = await Promise.all([H.json('nil-data.json?v=gradesync19'), H.ratings(), N.budgetsReady, N.dealsReady, N.pedigreeReady]);
    var D = res[0], rs = res[1], n = Math.max(1, Math.min(25, +d.n || 10));
    var floor = Math.min.apply(null, rs.map(function (t) { return +t.rating; }).filter(isFinite).concat([0]));
    var ST = { payroll: ['Est. payroll', 'The biggest payrolls', 'The smallest payrolls'], power: ['Spending power', 'The most spending power', 'The least spending power'],
      worth: ['Roster worth', 'The most valuable rosters', 'The least valuable rosters'], value: ['Payroll / worth', 'Paying over market', 'The best bargains'],
      cpp: ['$ / rating pt', 'The priciest wins', 'The most efficient payrolls'] };
    var sk = ST[d.pstat] ? d.pstat : 'payroll', down = d.dir === 'down';
    var fm = function (v) { return v >= 1 ? '$' + v.toFixed(1) + 'M' : '$' + Math.round(v * 1000) + 'K'; };
    var out = [];
    Object.keys(D.teams).forEach(function (t) {
      var T = D.teams[t], rt = rs.find(function (x) { return x.team === t; }) || rs.find(function (x) { return H.onTeam(x.team, t); });
      var conf = rt ? rt.conf : ((N.budgetRow(t) || {}).conf || '');
      if (d.conf && H.confName(conf) !== d.conf) return;
      if (d.tier && H.tierOf(conf) !== d.tier) return;
      var o = N.payroll(T.players, t, T.tier); if (!o || !(o.worth > 0)) return;
      var v = N.payVerdict(o), rating = rt ? +rt.rating : null;
      var cpp = rating != null && isFinite(rating) ? o.payroll / Math.max(1, rating - floor) : null;
      var key = { payroll: o.payroll, power: o.power, worth: o.worth, value: v.ratio, cpp: cpp }[sk]; if (key == null) return;
      out.push({ name: H.school(rt ? (rt.full || rt.team) : t), team: t, tag: H.confName(conf), _v: key,
        val: sk === 'value' ? Math.round(v.ratio * 100) + '%' : sk === 'cpp' ? '$' + Math.round(cpp * 1000) + 'K' : fm(key),
        pay: o.payroll, pow: o.power, wor: o.worth, pw: Math.round(v.ratio * 100), rt: rating });
    });
    out.sort(function (a, b) { return down ? a._v - b._v : b._v - a._v; });
    var dist = { pay: out.map(function (r) { return r.pay; }), pow: out.map(function (r) { return r.pow; }), wor: out.map(function (r) { return r.wor; }),
      pw: out.map(function (r) { return r.pw; }), rt: out.map(function (r) { return r.rt; }).filter(function (x) { return x != null; }) };
    var m1 = function (v) { return v.toFixed(1); };   // $M as a plain number so the heat cells can read it
    var rows = out.slice(0, n).map(function (r) {
      return { name: r.name, team: r.team, tag: r.tag, val: r.val, _v: r._v, pay: m1(r.pay), pow: m1(r.pow), wor: m1(r.wor), pw: r.pw + '%', rt: r.rt == null ? '' : H.fmt(r.rt, 1, true) };
    });
    var scope = d.conf ? d.conf + ': ' : d.tier ? { H: 'High-major: ', M: 'Mid-major: ', L: 'Low-major: ' }[d.tier] : '';
    var cols = [{ k: 'pay', lab: 'Payroll $M' }, { k: 'pow', lab: 'Power $M' }, { k: 'wor', lab: 'Worth $M' }, { k: 'pw', lab: '% of worth', inv: true }, { k: 'rt', lab: 'Rating', off: true }]
      .filter(function (c) { return !({ payroll: 'pay', power: 'pow', worth: 'wor', value: 'pw' }[sk] === c.k); });
    return {
      title: scope + ST[sk][down ? 2 : 1], subtitle: H.SEASON + ' estimated NIL payrolls',
      lead: ST[sk][0], src: 'The Depth Chart NIL model · school EADA filings (2024-25) · estimates, not reported contracts',
      cols: cols, dist: dist, rows: rows, players: false
    };
  }
});
