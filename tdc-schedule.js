/* tdc-schedule.js — the 2026-27 schedule projection.
 *
 * Reads the announced schedule (scripts/data/schedule_2027.json, every D-I game
 * ESPN lists) plus hand-added games (schedule_extras_2027.json), prices every
 * game off the predictive ratings, and runs a Monte Carlo season so the record
 * distribution and the per-game win odds carry the things a single line can't:
 *
 *   venue      opponent-strength home curve + the host's measured offset (tdc-ratings)
 *   rest       days since each side's previous game  — back-to-backs cost ~2.4 pts,
 *              8+ days ~1.2, an opener ~3.4 (scripts/calibrate_situational.py, 111k games)
 *   road trip  2nd/3rd/4th straight road game — measured ≈ 0 beyond the venue itself
 *   streaks    won 2+ straight ≈ +0.3 pts — momentum barely exists once strength is known
 *   snowball   what DOES chain wins together is not knowing how good a team really is:
 *              each simulated season draws every team's true rating from N(projection, τ),
 *              so in the seasons where a team is better than we think it wins the close
 *              ones in a row, and the record distribution widens honestly
 *
 * API:  await TDCSched.load();  const r = await TDCSched.project(fullName);  TDCSched.render(host, r)
 */
(function (g) {
  const SEASON = 2027;
  const SIMS_FULL = 3000;
  const _walkCache = {};
  const TAU = 4.5;          // preseason rating uncertainty, pts (≈ historical projection RMSE)
  const DEFAULT_TOTAL = 145.5;
  let _sched = null, _model = null, _extras = null, _loading = null;

  function load() {
    if (_loading) return _loading;
    _loading = Promise.all([
      fetch('scripts/data/schedule_2027.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('scripts/data/situational_model.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('scripts/data/schedule_extras_2027.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([s, m, x]) => {
      _sched = s; _model = m || { rest: {}, stint: {}, streak: {}, form: 0 }; _extras = x || {};
      return { sched: s, model: _model, extras: _extras };
    });
    return _loading;
  }

  // every listed game as {id,date,home,away,neutral,conf}
  function allGames() {
    if (!_sched) return [];
    if (_sched._rows) return _sched._rows;
    const T = _sched.teams;
    _sched._rows = _sched.games.map(a => ({ id: a[0], date: a[1], home: T[a[2]], away: T[a[3]], neutral: !!a[4], conf: !!a[5] }));
    return _sched._rows;
  }
  function gamesFor(team) { return allGames().filter(x => x.home === team || x.away === team); }
  function extrasFor(team) {
    return ((_extras && _extras[team]) || []).map((e, i) => ({
      id: `x${i}`, date: e.date, home: e.where === 'A' ? (e.opp || 'TBD') : team, away: e.where === 'A' ? team : (e.opp || 'TBD'),
      neutral: e.where === 'N', conf: false, extra: e,
    }));
  }

  // ── situational features ──────────────────────────────────────────────────
  function restBucket(days) {
    if (days == null) return 'opener';
    if (days <= 1) return 'b2b';
    if (days === 2) return 'r2';
    if (days <= 4) return 'r34';
    if (days <= 7) return 'r57';
    return 'r8';
  }
  function restPts(days) { return (_model.rest && _model.rest[restBucket(days)]) || 0; }
  function stintPts(n) { const k = n >= 4 ? 's4' : n === 3 ? 's3' : n === 2 ? 's2' : null; return k ? (_model.stint[k] || 0) : 0; }
  function streakPts(s) { const k = s <= -5 ? 'l5' : s <= -2 ? 'l24' : s >= 5 ? 'w5' : s >= 2 ? 'w24' : null; return k ? (_model.streak[k] || 0) : 0; }
  const dayMs = 864e5;
  const days = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / dayMs);

  // what a team carries into each of its games: {date → {rest, stint}}
  function walk(team, games) {
    const mine = games.filter(x => x.home === team || x.away === team).sort((a, b) => a.date.localeCompare(b.date));
    const out = {}; let last = null, stint = 0;
    mine.forEach(x => {
      const home = x.home === team && !x.neutral;
      stint = home ? 0 : stint + 1;
      out[x.date] = { rest: last ? days(last, x.date) : null, stint };
      last = x.date;
    });
    return out;
  }

  // ── projection ────────────────────────────────────────────────────────────
  function phi(x) { return g.TDC_RATINGS ? g.TDC_RATINGS.phi(x) : 0.5 * (1 + Math.tanh(x * 0.8)); }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  async function project(team, opts) {
    opts = opts || {};
    await load();
    if (!_sched || !g.TDC_RATINGS) return null;
    const D = await g.TDC_RATINGS.get();
    const SIGMA = g.TDC_RATINGS.SIGMA || 11;
    const rowOf = n => D.teams.find(t => t.full === n) || null;
    const me = rowOf(team); if (!me) return null;
    const FLOOR = { team: '?', full: '?', rating: -14, hcaOff: 0 };     // unrated (non-D-I) opponents

    // my slate: listed games + hand-added ones, date order; played games (from the DB) are passed in and skipped
    const played = new Set((opts.playedIds || []).map(String));
    const slate = gamesFor(team).concat(extrasFor(team)).filter(x => !played.has(String(x.id))).sort((a, b) => a.date.localeCompare(b.date));
    if (!slate.length) return null;
    const all = allGames();
    const myWalk = walk(team, slate);
    const oppWalk = _walkCache;                           // opponent → its own season walk (shared across teams)
    const oppOf = x => x.home === team ? x.away : x.home;
    slate.forEach(x => { const o = oppOf(x); if (o && o !== 'TBD' && !oppWalk[o]) oppWalk[o] = walk(o, all); });
    const SIMS = opts.sims || SIMS_FULL;

    // per-game deterministic pricing (ratings at their means, no streak)
    const rows = slate.map(x => {
      const ex = x.extra || null;
      const homeMe = x.home === team && !x.neutral, awayMe = x.away === team && !x.neutral;
      const venue = x.neutral ? 'N' : homeMe ? 'H' : 'A';
      const oppName = ex && (ex.opps || ex.pool) ? null : oppOf(x);
      const opp = oppName ? (rowOf(oppName) || FLOOR) : null;
      const mf = myWalk[x.date] || { rest: null, stint: 0 };
      const known = !!(oppName && oppWalk[oppName] && oppWalk[oppName][x.date]);   // ESPN lists the game from their side too
      const of = known ? oppWalk[oppName][x.date] : { rest: null, stint: 0 };
      // opponent edge (their strength) is applied per-sim; here we build the situational parts
      const venuePts = !opp ? 0 : homeMe ? g.TDC_RATINGS.baseHca(opp.rating) + (me.hcaOff || 0)
                    : awayMe ? -(g.TDC_RATINGS.baseHca(me.rating) + (opp.hcaOff || 0)) : 0;
      // bracket / pool days: whoever we draw is in the same event on the same schedule
      const sameEvent = !oppName;
      const restMe = restPts(mf.rest), restOpp = sameEvent ? restMe : known ? restPts(of.rest) : 0;
      const stintMe = stintPts(mf.stint), stintOpp = sameEvent ? stintMe : known ? stintPts(of.stint) : 0;
      const sit = restMe - restOpp + stintMe - stintOpp;
      return { g: x, opp, oppName, venue, venuePts, sit, mf, of, known, restMe, restOpp, stintMe, stintOpp,
        event: ex && ex.event || '', bracket: ex && ex.bracket ? ex.opps : null, pool: ex && ex.pool || null };
    });

    // pool of every rated team we might meet (for the per-sim rating draws)
    const names = new Set();
    rows.forEach(r => { if (r.oppName) names.add(r.oppName); (r.bracket || []).forEach(n => names.add(n)); (r.pool || []).forEach(n => names.add(n)); });
    const pool = {}; names.forEach(n => { pool[n] = rowOf(n) || FLOOR; });

    // ── Monte Carlo season ──
    const wins = new Array(rows.length).fill(0), W = new Int16Array(SIMS), CW = new Int16Array(SIMS);
    // ESPN doesn't flag conference games until the season starts — same league in the ratings = league game
    rows.forEach(r => { if (!r.g.conf && !r.g.neutral && r.opp && r.opp.conf && me.conf && r.opp.conf === me.conf) r.g.conf = true; });
    let confN = rows.filter(r => r.g.conf).length;
    for (let s = 0; s < SIMS; s++) {
      const rMe = me.rating + TAU * gauss();
      const rOpp = {}; for (const n in pool) rOpp[n] = pool[n].rating + TAU * gauss();
      let streak = 0, w = 0, cw = 0; const faced = new Set(); let day1Won = null;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; let oppName = r.oppName, venuePts = r.venuePts;
        if (r.bracket) {
          // day 2 of a 4-team bracket: our day-1 result decides whether we meet the other pair's winner or loser
          const [a, b] = r.bracket; const pa = phi((rOpp[a] - rOpp[b]) / SIGMA); const aWon = Math.random() < pa;
          const winner = aWon ? a : b, loser = aWon ? b : a;
          oppName = day1Won === false ? loser : winner;
        } else if (r.pool) {
          const cands = r.pool.filter(n => !faced.has(n)); oppName = cands[Math.floor(Math.random() * cands.length)] || r.pool[0];
        }
        const oppR = oppName ? (rOpp[oppName] != null ? rOpp[oppName] : FLOOR.rating) : FLOOR.rating;
        const m = rMe - oppR + venuePts + r.sit + streakPts(streak);
        const won = Math.random() < phi(m / SIGMA);
        if (rows[i + 1] && rows[i + 1].bracket && !r.bracket) day1Won = won;   // the game right before a bracket day-2 is our day-1
        if (oppName) faced.add(oppName);
        if (won) { wins[i]++; w++; if (r.g.conf) cw++; streak = streak > 0 ? streak + 1 : 1; }
        else { streak = streak < 0 ? streak - 1 : -1; }
      }
      W[s] = w; CW[s] = cw;
    }
    const sorted = Array.from(W).sort((a, b) => a - b), n = rows.length;
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const expW = mean(Array.from(W)), expCW = mean(Array.from(CW));
    const pct = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const hist = {}; sorted.forEach(w => { hist[w] = (hist[w] || 0) + 1; });
    const modeW = +Object.keys(hist).sort((a, b) => hist[b] - hist[a])[0];
    const pAtLeast = k => sorted.filter(w => w >= k).length / sorted.length;

    // per-game display
    const sn = g.tdcShortSchool || (x => x);
    rows.forEach((r, i) => {
      r.p = wins[i] / SIMS;
      const oppR = r.opp ? r.opp.rating : (r.bracket ? mean(r.bracket.map(x => pool[x].rating)) : r.pool ? mean(r.pool.map(x => pool[x].rating)) : FLOOR.rating);
      const margin = me.rating - oppR + r.venuePts + r.sit;
      r.margin = +margin.toFixed(1);
      r.p0 = phi(margin / SIGMA);                                          // point-estimate odds, no rating uncertainty / streak
      r.scoreMe = Math.round(DEFAULT_TOTAL / 2 + margin / 2); r.scoreOpp = Math.round(DEFAULT_TOTAL / 2 - margin / 2);
      const oppLabel = r.bracket ? `${sn(r.bracket[0])} / ${sn(r.bracket[1])}` : r.pool ? 'TBD · ' + r.event.replace(/ · day.*/, '') : (r.oppName || 'TBD');
      r.label = oppLabel;
      r.spread = margin >= 0 ? `${sn(team)} −${margin.toFixed(1)}` : `${r.oppName ? sn(r.oppName) : 'Opp'} −${(-margin).toFixed(1)}`;
    });
    return { team, me, rows, sims: SIMS, tau: TAU, sigma: SIGMA, n, confN, expW, expCW, modeW, lo: pct(0.1), hi: pct(0.9),
      p20: pAtLeast(20), p25: pAtLeast(25), pHalf: sorted.filter(w => w * 2 >= n).length / sorted.length, model: _model, hist };
  }

  // ── render ────────────────────────────────────────────────────────────────
  // its own table class (not .sched-table) so the team page's mono/dim overrides don't apply
  const CSS = `
  .tsp{font-family:'Inter',system-ui,sans-serif;}
  .tsp-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px;}
  .tsp-tile{border:1px solid var(--border);border-radius:9px;padding:9px 12px 8px;background:var(--bg2);min-width:0;}
  .tsp-tile .k{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:3px;white-space:nowrap;}
  .tsp-tile .v{font-family:'Playfair Display',serif;font-weight:800;font-size:21px;line-height:1;color:var(--text);white-space:nowrap;}
  .tsp-tile .v small{font-family:'Inter',sans-serif;font-size:10.5px;font-weight:600;color:var(--text3);margin:0 3px;}
  .tsp-tile .s{font-size:10.5px;color:var(--text3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  /* kenpom-style grid: bordered cells, no stretching, whole row tinted by the outcome */
  .tsp-wrap{overflow:auto;}
  .tsp-table{border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;width:auto;min-width:780px;margin:0 auto;border:1px solid color-mix(in srgb,var(--text) 28%,transparent);}
  .tsp-table th{text-align:center;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#fff;padding:8px 16px;border:1px solid rgba(255,255,255,.18);background:#121C33;white-space:nowrap;}
  .tsp-table td{padding:4px 16px;border:1px solid color-mix(in srgb,var(--text) 18%,transparent);white-space:nowrap;text-align:center;color:var(--text);line-height:1.35;height:27px;}
  .tsp-table tr.sec td{background:#1A2A4C!important;color:#fff;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;text-align:center;padding:6px 16px;}
  .tsp-table td.tsp-pm{font-weight:700;}
  .tsp-table td.l{text-align:left;}
  .tsp-table td.r{text-align:right;}
  .tsp-table tr.mo1 td{border-top:2px solid color-mix(in srgb,var(--text) 35%,transparent);}
  .tsp-table tr.w td{background:color-mix(in srgb,#2f9159 calc(var(--k)*1%),transparent);}
  .tsp-table tr.x td{background:color-mix(in srgb,#d05a5a calc(var(--k)*1%),transparent);}
  .tsp-table tr:hover td{filter:brightness(1.06);}
  .tsp-table td.tsp-d{color:var(--text);font-weight:600;min-width:96px;}
  .tsp-table td.tsp-o .cfdot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--tc-readable,var(--accent));margin-left:7px;vertical-align:middle;}
  .tsp-table td.tsp-o.cf{font-weight:800;}
  .tsp-table td.tsp-q{font-weight:800;font-size:11.5px;color:var(--text3);}
  .tsp-table td.tsp-q.q1{color:#1f7a45;} .tsp-table td.tsp-q.q2{color:#3f74c9;} .tsp-table td.tsp-q.q3{color:var(--text2);}
  [data-theme="dark"] .tsp-table td.tsp-q.q1{color:#4fc07a;} [data-theme="dark"] .tsp-table td.tsp-q.q2{color:#7fb0ff;}
  .tsp-table td.tsp-pr{color:var(--text2);}
  .tsp-ev{display:block;font-size:8.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);line-height:1.1;}
  .tsp-table td.tsp-rk{color:var(--text3);font-size:11px;font-weight:600;}
  .tsp-table td.tsp-o{font-weight:700;overflow:hidden;text-overflow:ellipsis;max-width:240px;min-width:170px;}
  .tsp-table td.tsp-o .pre{font-weight:500;color:var(--text3);}
  .tsp-table td.tsp-o.hist{font-weight:600;}
  .tsp-table td.tsp-site b{font-weight:800;}
  .tsp-table td.tsp-site b.H{color:#2f9159;} .tsp-table td.tsp-site b.A{color:#d05a5a;} .tsp-table td.tsp-site b.N{color:var(--text3);}
  .tsp-table td.tsp-rest{color:var(--text2);}
  .tsp-table td.tsp-rest b{font-weight:700;color:var(--text);}
  .tsp .pos{color:#2f9159!important;} .tsp .neg{color:#d05a5a!important;}
  [data-theme="dark"] .tsp .pos{color:#4fc07a!important;} [data-theme="dark"] .tsp .neg{color:#ef6e6e!important;}
  [data-theme="dark"] .tsp-table td.tsp-site b.H{color:#4fc07a;} [data-theme="dark"] .tsp-table td.tsp-site b.A{color:#ef6e6e;}
  .tsp-table td.tsp-edge{font-weight:700;}
  .tsp-table td.tsp-p{font-weight:800;}
  .tsp-table td.tsp-line{color:var(--text2);font-weight:600;}
  .tsp-table td.tsp-sc{color:var(--text2);}
  .tsp-table td .tsp-res{font-weight:800;}
  .tsp-note{font-size:11px;color:var(--text3);line-height:1.5;margin:10px 2px 0;}
  .tsp-note b{color:var(--text2);}
  @media(max-width:760px){.tsp-sum{grid-template-columns:repeat(2,minmax(0,1fr));}.tsp-hide{display:none;}.tsp-table td.tsp-o{max-width:140px;}}`;
  function ensureCss() { if (document.getElementById('tsp-css')) return; const s = document.createElement('style'); s.id = 'tsp-css'; s.textContent = CSS; document.head.appendChild(s); }

  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dParts(d) { const x = new Date(d + 'T12:00:00'); return { mo: MO[x.getMonth()], day: x.getDate(), dw: DW[x.getDay()], num: (x.getMonth() + 1) + '/' + x.getDate(), key: x.getFullYear() + '-' + x.getMonth() }; }
  // NET-style quadrant from opponent rank + site (home 1-30 / neutral 1-50 / away 1-75 = Q1 …)
  function quad(rank, site) {
    if (!rank) return null;
    const cut = site === 'H' ? [30, 75, 160] : site === 'A' ? [75, 135, 240] : [50, 100, 200];
    return rank <= cut[0] ? 1 : rank <= cut[1] ? 2 : rank <= cut[2] ? 3 : 4;
  }
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const cls = v => v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : '';
  // win-probability cell: tint deepens with confidence either way
  function pCell(p) {
    const pc = Math.round(p * 100), good = pc >= 50, k = Math.min(1, Math.abs(pc - 50) / 45);
    const col = good ? '#2f9159' : '#d05a5a';
    return `<span style="background:color-mix(in srgb,${col} ${Math.round(8 + 30 * k)}%,transparent);">${pc}%</span>`;
  }
  const restTxt = f => f.rest == null ? 'opener' : f.rest <= 1 ? 'b2b' : f.rest + 'd';

  function render(host, R, opts) {
    ensureCss(); opts = opts || {};
    const sn = g.tdcShortSchool || (x => x);
    let lastMo = null, rows = '';
    const moCls = key => { const c = lastMo !== null && key !== lastMo ? ' mo1' : ''; lastMo = key; return c; };
    const tint = p => { const k = Math.round(5 + 9 * Math.min(1, Math.abs(p - 0.5) / 0.45)); return `class="${p >= 0.5 ? 'w' : 'x'}" style="--k:${k}"`; };
    (opts.played || []).forEach(x => {          // results already on the books
      const d = dParts(x.date);
      rows += `<tr class="${x.won ? 'w' : 'x'}${moCls(d.key)}" style="--k:18;cursor:${x.href ? 'pointer' : 'default'}" onclick="${x.href ? `location.href='${x.href}'` : ''}">
        <td class="l tsp-d">${d.dw} ${d.num}</td>
        <td class="tsp-rk">${x.rank || ''}</td>
        <td class="l tsp-o hist">${sn(x.opp)}</td>
        <td class="tsp-sc"><span class="tsp-res">${x.won ? 'W' : 'L'} ${x.ms}–${x.os}</span></td>
        <td class="tsp-site"><b class="${x.site}">${x.site}</b></td>
        <td class="tsp-q q${quad(x.rank, x.site) || 0}">${quad(x.rank, x.site) ? 'Q' + quad(x.rank, x.site) : ''}</td>
        <td class="tsp-pr"></td>
        <td class="tsp-p"></td>
        <td class="tsp-line">${x.rec}</td></tr>`;
    });
    R.rows.forEach(r => {
      const d = dParts(r.g.date);
      const oppTxt = r.bracket ? `${sn(r.bracket[0])} / ${sn(r.bracket[1])}` : r.pool ? 'TBD' : (r.oppName ? sn(r.oppName) : 'TBD');
      const pre = r.venue === 'A' ? '<span class="pre">at </span>' : r.venue === 'N' ? '<span class="pre">vs </span>' : '';
      const restD = r.restMe - r.restOpp, trip = r.stintMe - r.stintOpp;
      const edge = r.venuePts + r.sit;
      const siteTitle = r.venue === 'H' ? `home edge ${sg(r.venuePts)}` : r.venue === 'A' ? `their building ${sg(r.venuePts)}` : 'neutral floor';
      const t = tint(r.p), mc = moCls(d.key);
      const rk = r.opp && r.opp.rank ? r.opp.rank : null, q = quad(rk, r.venue);
      const pc = Math.round(r.p * 100), pk = Math.round(8 + 34 * Math.min(1, Math.abs(pc - 50) / 45));
      rows += `<tr ${t.replace('class="', 'class="' + mc.trim() + ' ')}>
        <td class="l tsp-d">${d.dw} ${d.num}${r.event ? `<span class="tsp-ev">${r.event}</span>` : ''}</td>
        <td class="tsp-rk">${rk || ''}</td>
        <td class="l tsp-o${r.g.conf ? ' cf' : ''}">${pre}${oppTxt}${r.g.conf ? '<i class="cfdot" title="conference game"></i>' : ''}</td>
        <td class="tsp-sc">${r.scoreMe}–${r.scoreOpp}</td>
        <td class="tsp-site" title="${siteTitle} · rest ${restTxt(r.mf)} vs ${r.known ? restTxt(r.of) : (r.oppName ? '?' : 'same')}${Math.abs(restD) >= 0.15 ? ` (${sg(restD)})` : ''}${r.mf.stint >= 2 ? ` · ${r.mf.stint}${r.mf.stint === 2 ? 'nd' : r.mf.stint === 3 ? 'rd' : 'th'} straight away` : ''} · situational edge ${sg(edge)}"><b class="${r.venue}">${r.venue}</b></td>
        <td class="tsp-q q${q || 0}" title="NET-style quadrant: opponent rank ${rk || '—'} ${r.venue === 'H' ? 'at home' : r.venue === 'A' ? 'on the road' : 'on a neutral floor'}">${q ? 'Q' + q : ''}</td>
        <td class="tsp-pr">${r.opp && isFinite(r.opp.rating) ? sg(r.opp.rating) : ''}</td>
        <td class="tsp-p" style="background:color-mix(in srgb,${pc >= 50 ? '#2f9159' : '#d05a5a'} ${pk}%,transparent)" title="${Math.round(r.p0 * 100)}% on the line alone · ${pc}% across simulated seasons">${pc}%</td>
        <td class="tsp-line">${r.margin >= 0 ? '−' : '+'}${Math.abs(r.margin).toFixed(1)}</td></tr>`;
    });
    const W = Math.round(R.expW), L = R.n - W, cw = Math.round(R.expCW), cl = R.confN - cw;
    const pw = (opts.played || []).filter(x => x.won).length, pl = (opts.played || []).length - pw;
    const m = R.model || {};
    const sum = `<div class="tsp-sum">
      <div class="tsp-tile" title="likely range ${pw + R.lo}–${pl + R.n - R.lo} to ${pw + R.hi}–${pl + R.n - R.hi} (10th–90th pct of ${R.sims.toLocaleString()} simulated seasons)"><div class="k">Projected record</div><div class="v">${pw + W}–${pl + L}</div><div class="s">${(pw + R.expW).toFixed(1)} expected wins${pw + pl ? ` · ${pw}–${pl} so far` : ''}</div></div>
      <div class="tsp-tile"><div class="k">Conference</div><div class="v">${R.confN ? `${cw}–${cl}` : '—'}</div><div class="s">${R.confN ? `${R.expCW.toFixed(1)} of ${R.confN} league games` : 'no league games listed yet'}</div></div>
      <div class="tsp-tile"><div class="k">20+ wins</div><div class="v">${Math.round(R.p20 * 100)}%</div><div class="s">25+ ${Math.round(R.p25 * 100)}% · .500+ ${Math.round(R.pHalf * 100)}%</div></div>
    </div>`;
    const note = `<div class="tsp-note"><b>Line</b> = projected margin (− favored, + underdog), built from the ratings, the host's measured home edge, and rest: back-to-backs cost ${sg(m.rest && m.rest.b2b || 0)} pts, 8+ days off ${sg(m.rest && m.rest.r8 || 0)}, a season opener ${sg(m.rest && m.rest.opener || 0)} (${(m.n || 0).toLocaleString()} games since ${m.firstSeason || 2008}; road trips and win streaks measure ≈ 0). Hover a Site badge for that game's breakdown. <b>Win %</b> is the share of ${R.sims.toLocaleString()} simulated seasons, each drawing every team's true strength ±${R.tau} around its projection.</div>`;
    host.innerHTML = `<div class="tsp">${sum}<div class="tsp-wrap"><table class="tsp-table"><thead><tr>
      <th>Date</th><th>Rk</th><th>Opponent</th><th>Score</th><th>Site</th><th title="NET-style quadrant">Quad</th><th title="opponent's projected Power Rating">Opp PRtg</th><th>Win %</th><th>Line</th>
    </tr></thead><tbody>${rows}</tbody></table></div>${note}</div>`;
  }

  // every rated team's projected record for the rankings table — lighter sims, cached in
  // localStorage until the ratings or the schedule file change
  const LS_ALL = 'tdc_projrec_v2';
  async function projectAll(opts) {
    opts = opts || {};
    await load();
    if (!_sched || !g.TDC_RATINGS) return {};
    const D = await g.TDC_RATINGS.get();
    const stamp = (D.generated || '') + '|' + (_sched.pulled || '') + '|' + (_sched.games || []).length;
    try { const c = JSON.parse(localStorage.getItem(LS_ALL) || 'null'); if (c && c.stamp === stamp) return c.recs; } catch (e) {}
    const recs = {};
    for (const t of D.teams) {
      const R = await project(t.full, { sims: opts.sims || 600 });
      if (R) recs[t.full] = { w: Math.round(R.expW), l: R.n - Math.round(R.expW), cw: Math.round(R.expCW), cl: R.confN - Math.round(R.expCW),
        n: R.n, confN: R.confN, lo: R.lo, hi: R.hi, p20: +R.p20.toFixed(2) };
    }
    try { localStorage.setItem(LS_ALL, JSON.stringify({ stamp, recs })); } catch (e) {}
    return recs;
  }

  // played season, same grid: Date · Rk · Opponent · Result · Site · Quad · Opp PRtg · Exp · +/- · Record
  // rows: [{date, opp, rank, oppSrs, site, won, ms, os, rec, conf, href, section}] ; opts.mySrs
  function renderPast(host, rows, opts) {
    ensureCss(); opts = opts || {};
    const sn = g.tdcShortSchool || (x => x);
    const hca = g.TDC_RATINGS && g.TDC_RATINGS.baseHca ? g.TDC_RATINGS.baseHca : (() => 3.7);
    let lastMo = null, html = '';
    const moCls = key => { const c = lastMo !== null && key !== lastMo ? ' mo1' : ''; lastMo = key; return c; };
    rows.forEach(x => {
      if (x.section) { html += `<tr class="sec"><td colspan="10">${x.section}</td></tr>`; return; }
      const d = dParts(x.date), q = quad(x.rank, x.site), m = x.ms - x.os;
      const exp = (opts.mySrs != null && x.oppSrs != null) ? opts.mySrs - x.oppSrs + (x.site === 'H' ? hca(x.oppSrs) : x.site === 'A' ? -hca(opts.mySrs) : 0) : null;
      const diff = exp != null ? m - exp : null;
      const dk = diff == null ? 0 : Math.round(6 + 30 * Math.min(1, Math.abs(diff) / 20));
      html += `<tr class="${x.won ? 'w' : 'x'}${moCls(d.key)}" style="--k:14;cursor:${x.href ? 'pointer' : 'default'}" onclick="${x.href ? `location.href='${x.href}'` : ''}">
        <td class="l tsp-d">${d.dw} ${d.num}</td>
        <td class="tsp-rk">${x.rank || ''}</td>
        <td class="l tsp-o${x.conf ? ' cf' : ''}">${x.site === 'A' ? '<span class="pre">at </span>' : x.site === 'N' ? '<span class="pre">vs </span>' : ''}${sn(x.opp)}${x.conf ? '<i class="cfdot" title="conference game"></i>' : ''}</td>
        <td class="tsp-sc"><span class="tsp-res ${x.won ? 'w' : 'l'}">${x.won ? 'W' : 'L'} ${x.ms}–${x.os}</span></td>
        <td class="tsp-site"><b class="${x.site}">${x.site}</b></td>
        <td class="tsp-q q${q || 0}">${q ? 'Q' + q : ''}</td>
        <td class="tsp-pr">${x.oppSrs != null ? sg(x.oppSrs) : ''}</td>
        <td class="tsp-line" title="expected margin from the two Power Ratings + venue">${exp != null ? sg(exp) : ''}</td>
        <td class="tsp-pm ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}" style="background:color-mix(in srgb,${diff >= 0 ? '#2f9159' : '#d05a5a'} ${dk}%,transparent)" title="actual margin vs expected">${diff != null ? sg(diff) : ''}</td>
        <td class="tsp-line">${x.rec}</td></tr>`;
    });
    host.innerHTML = `<div class="tsp"><div class="tsp-wrap"><table class="tsp-table"><thead><tr>
      <th>Date</th><th>Rk</th><th>Opponent</th><th>Result</th><th>Site</th><th title="NET-style quadrant">Quad</th><th title="opponent's Power Rating that season">Opp PRtg</th><th title="expected margin (Power Ratings + venue)">Exp</th><th title="actual margin minus expected">+/−</th><th>Record</th>
    </tr></thead><tbody>${html}</tbody></table></div></div>`;
  }

  g.TDCSched = { load, project, projectAll, render, renderPast, gamesFor, extrasFor, SEASON };
})(window);
