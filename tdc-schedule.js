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
  const SIMS = 3000;
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
    const oppWalk = {};                                   // opponent → its own season walk
    const oppOf = x => x.home === team ? x.away : x.home;
    slate.forEach(x => { const o = oppOf(x); if (o && o !== 'TBD' && !oppWalk[o]) oppWalk[o] = walk(o, all); });

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
    rows.forEach(r => { if (!r.g.conf && r.opp && r.opp.conf && me.conf && r.opp.conf === me.conf) r.g.conf = true; });
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
  const CSS = `
  .tsp-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:2px 0 14px;}
  .tsp-tile{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--bg2);}
  .tsp-tile .k{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:5px;}
  .tsp-tile .v{font-family:'Playfair Display',serif;font-weight:800;font-size:22px;line-height:1;color:var(--text);}
  .tsp-tile .v small{font-family:'Inter',sans-serif;font-size:11px;font-weight:600;color:var(--text3);margin-left:4px;}
  .tsp-tile .s{font-size:11px;color:var(--text3);margin-top:4px;}
  .tsp-edge{font-size:11px;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap;}
  .tsp-edge b{color:var(--text);font-weight:800;}
  .tsp-edge .chip{display:inline-block;font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--bg3,var(--bg2));color:var(--text3);margin-left:4px;vertical-align:middle;}
  .tsp-edge .chip.neg{color:#bd4b4b;} .tsp-edge .chip.pos{color:#2f9159;}
  .tsp-p{font-weight:800;font-variant-numeric:tabular-nums;}
  .tsp-bar{display:inline-block;width:46px;height:5px;border-radius:3px;background:var(--bg3,var(--border));vertical-align:middle;margin-left:6px;overflow:hidden;}
  .tsp-bar i{display:block;height:100%;border-radius:3px;}
  .tsp-note{font-size:11.5px;color:var(--text3);line-height:1.55;margin:12px 2px 0;}
  .tsp-note b{color:var(--text2);}
  .tsp-ev{font-size:10px;font-weight:700;color:var(--tc,var(--accent));text-transform:uppercase;letter-spacing:.04em;}
  @media(max-width:680px){.tsp-hide{display:none;}}`;
  function ensureCss() { if (document.getElementById('tsp-css')) return; const s = document.createElement('style'); s.id = 'tsp-css'; s.textContent = CSS; document.head.appendChild(s); }

  function fmtD(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);

  function render(host, R, opts) {
    ensureCss(); opts = opts || {};
    const sn = g.tdcShortSchool || (x => x);
    const green = 'var(--green,#3fa66a)', red = 'var(--red,#c75d5d)';
    const restTxt = f => f.rest == null ? 'opener' : f.rest <= 1 ? 'b2b' : f.rest + 'd';
    const rows = R.rows.map(r => {
      const rk = r.opp && r.opp.rank ? `<span style="opacity:.6">#</span>${r.opp.rank}` : '';
      const chips = [];
      if (r.venuePts) chips.push(`<span class="chip ${r.venuePts < 0 ? 'neg' : 'pos'}">${r.venue === 'H' ? 'home' : 'away'} ${sg(r.venuePts)}</span>`);
      const rest = r.restMe - r.restOpp; if (Math.abs(rest) >= 0.15) chips.push(`<span class="chip ${rest < 0 ? 'neg' : 'pos'}" title="rest: ${restTxt(r.mf)} vs ${r.known ? restTxt(r.of) : '—'}">rest ${sg(rest)}</span>`);
      const trip = r.stintMe - r.stintOpp; if (Math.abs(trip) >= 0.15) chips.push(`<span class="chip ${trip < 0 ? 'neg' : 'pos'}">trip ${sg(trip)}</span>`);
      if (r.mf.stint >= 2 && Math.abs(trip) < 0.15) chips.push(`<span class="chip" title="road trips measure ≈ 0 beyond the venue itself">${r.mf.stint}${r.mf.stint === 2 ? 'nd' : r.mf.stint === 3 ? 'rd' : 'th'} road</span>`);
      const edge = r.venuePts + r.sit;
      const pc = Math.round(r.p * 100);
      return `<tr class="sched-row">
        <td class="sched-date">${fmtD(r.g.date)}${r.event ? `<div class="tsp-ev">${r.event}</div>` : ''}</td>
        <td class="sched-rk">${rk}</td>
        <td class="sched-opp">${r.venue === 'A' ? 'at ' : r.venue === 'N' ? 'vs ' : ''}${r.label}</td>
        <td class="tsp-edge tsp-hide"><b>${sg(edge)}</b>${chips.join('')}</td>
        <td class="sched-res tsp-p" style="color:${pc >= 50 ? green : red};" title="${Math.round(r.p0 * 100)}% on the line alone · ${pc}% across simulated seasons (rating uncertainty + streaks)">${pc}%<span class="tsp-bar"><i style="width:${pc}%;background:${pc >= 50 ? green : red};"></i></span></td>
        <td class="sched-loc col-loc">${r.spread}</td>
        <td class="sched-rec" style="color:var(--text3);">${r.scoreMe}–${r.scoreOpp}</td>
      </tr>`;
    }).join('');
    const L = R.n - Math.round(R.expW), cl = R.confN - Math.round(R.expCW);
    const m = R.model || {};
    const sum = `<div class="tsp-sum">
      <div class="tsp-tile"><div class="k">Projected record</div><div class="v">${Math.round(R.expW)}–${L}</div><div class="s">${R.expW.toFixed(1)} expected wins of ${R.n}</div></div>
      <div class="tsp-tile"><div class="k">Likely range</div><div class="v">${R.lo}–${R.n - R.lo}<small>to</small> ${R.hi}–${R.n - R.hi}</div><div class="s">10th–90th pct of ${R.sims.toLocaleString()} seasons</div></div>
      ${R.confN ? `<div class="tsp-tile"><div class="k">Conference</div><div class="v">${Math.round(R.expCW)}–${cl}</div><div class="s">${R.expCW.toFixed(1)} of ${R.confN} league games</div></div>` : ''}
      <div class="tsp-tile"><div class="k">20+ wins</div><div class="v">${Math.round(R.p20 * 100)}%</div><div class="s">25+: ${Math.round(R.p25 * 100)}% · .500+: ${Math.round(R.pHalf * 100)}%</div></div>
    </div>`;
    const note = `<div class="tsp-note">Every game is priced off the predictive ratings with the host's <b>measured venue edge</b>, then the whole season is simulated ${R.sims.toLocaleString()} times with each team's true strength drawn around its projection (±${R.tau} pts), so a hot start and the wins it chains together are in the odds. Situational terms come from ${(m.n || 0).toLocaleString()} games since ${m.firstSeason || 2008}: <b>back-to-back ${sg(m.rest && m.rest.b2b || 0)}</b>, 8+ days off ${sg(m.rest && m.rest.r8 || 0)}, season opener ${sg(m.rest && m.rest.opener || 0)}; a 2nd/3rd/4th straight road game measures <b>${sg(m.stint && m.stint.s2 || 0)} / ${sg(m.stint && m.stint.s3 || 0)} / ${sg(m.stint && m.stint.s4 || 0)}</b> beyond the venue (nothing); a win streak is worth <b>${sg(m.streak && m.streak.w24 || 0)}</b> once strength is known. Edge = venue + rest + trip, in points.</div>`;
    host.innerHTML = `${sum}<table class="sched-table"><thead><tr>
      <th>Date</th><th>Rk</th><th>Opponent</th><th class="tsp-hide">Edge</th><th>Win %</th><th class="col-loc">Line</th><th>Proj</th>
    </tr></thead><tbody>${opts.beforeRows || ''}${rows}</tbody></table>${note}`;
  }

  g.TDCSched = { load, project, render, gamesFor, extrasFor, SEASON };
})(window);
