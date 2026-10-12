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
 *   streaks    won 2+ straight ≈ +0.3 pts — measured but NOT applied: it depends on each team's own path
 *              through a simulated season, so it would make the two sides of one game disagree
 *   snowball   what DOES chain wins together is not knowing how good a team really is:
 *              each simulated season draws every team's true rating from N(projection, τ),
 *              so in the seasons where a team is better than we think it wins the close
 *              ones in a row, and the record distribution widens honestly
 *   one league every page draws from the SAME simulated seasons: sim s gives each team one true rating
 *              and each game one coin (both hashed from the sim number + team / game id), so in every
 *              sim a game Notre Dame wins on its page is a loss on the opponent's page, and the two
 *              win %s add to exactly 100
 *
 * API:  await TDCSched.load();  const r = await TDCSched.project(fullName);  TDCSched.render(host, r)
 */
(function (g) {
  const SEASON = 2027;
  const SIMS_FULL = 3000;
  const _walkCache = {};
  // preseason rating uncertainty, pts: a team's rating vs last year's (regressed) misses by 4.7 pre-portal
  // (2013-19) and 5.05 in the portal era (2022-26) — team_seasons SRS, Oct 2026
  const TAU = 5.0;
  // common random numbers: a uniform in [0,1) from (stream, sim, key) — the same on every page
  const _hk = {};
  function hkey(str) { if (_hk[str] != null) return _hk[str]; let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (_hk[str] = h >>> 0); }
  function U(stream, sim, key) {
    let h = Math.imul(stream ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(sim + 1, 0xC2B2AE35) ^ key;
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D); h ^= h >>> 15; h = Math.imul(h, 0x846CA68B); h ^= h >>> 16;
    return ((h >>> 0) + 0.5) / 4294967296;
  }
  // team T's true-rating draw in sim s (Box-Muller on two of its uniforms)
  const zTeam = (s, name) => { const k = hkey('t:' + name); return Math.sqrt(-2 * Math.log(U(1, s, k))) * Math.cos(2 * Math.PI * U(2, s, k)); };
  const DEFAULT_TOTAL = 145.5;
  let _sched = null, _model = null, _extras = null, _eff = null, _members = null, _results = null, _loading = null;
  // ── results so far (scripts/data/results_2027.json, written by the nightly ingest) ─────────────────
  // id → {date, home, away, hs, as}. A played game is a FIXED result in every simulated season.
  let RES = {};
  // In-season strength comes from tdc-ratings (applyForm): the preseason rating counts as ADJ_K = 8 games and every
  // result is opponent- and venue-adjusted (owner, Oct 12 2026 — backtest_fade.py beat the old K 20 / ±15 blend here).
  // So the rating is used as-is; this only counts each team's played games so uncertainty shrinks: TAU·√(K/(K+n)).
  const K_PRIOR = 8;
  let _rate = null;
  function buildRates(D) {
    if (_rate && _rate.D === D) return _rate;
    const out = { D, r: {}, n: {} }, cnt = {};
    Object.values(RES).forEach(x => { cnt[x.home] = (cnt[x.home] || 0) + 1; cnt[x.away] = (cnt[x.away] || 0) + 1; });
    D.teams.forEach(t => { out.n[t.full] = Math.max(cnt[t.full] || 0, +t.formGp || 0); out.r[t.full] = +t.rating || 0; });
    return (_rate = out);
  }
  // a team's current strength + its uncertainty, for every simulation on the site
  const rateOf = (full, row) => (_rate && _rate.r[full] != null) ? _rate.r[full] : (row ? +row.rating || 0 : 0);
  const tauOf = full => TAU * Math.sqrt(K_PRIOR / (K_PRIOR + ((_rate && _rate.n[full]) || 0)));
  // 2026-27 league membership (ESPN team groups — realignment-correct; the ratings' conf can be stale)
  const leagueOf = (full, row) => (_members && _members.teams && _members.teams[full]) || (row && row.conf) || null;

  function load() {
    if (_loading) return _loading;
    _loading = Promise.all([
      fetch('scripts/data/schedule_2027.json?v=5').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('scripts/data/situational_model.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('scripts/data/schedule_extras_2027.json?v=2').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('scripts/data/team_pace_eff.json?v=8').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('scripts/data/conf_members_2027.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null),
      // results change every night: an hourly query string keeps the offline cache from serving a stale copy
      fetch('scripts/data/results_2027.json?h=' + new Date().toISOString().slice(0, 13), { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([s, m, x, e, mem, res]) => {
      _sched = s; _model = m || { rest: {}, stint: {}, streak: {}, form: 0 }; _extras = x || {}; _eff = e || null; _members = mem; _results = res;
      RES = {};
      if (res && res.games) res.games.forEach(a => { RES[a[0]] = { id: a[0], date: a[1], home: res.teams[a[2]], away: res.teams[a[3]], hs: a[4], as: a[5], neutral: !!a[6], conf: !!a[7] }; });
      // games that went final since the last ingest: straight from ESPN (capped wait, never blocks the page)
      return Promise.race([mergeLive(), new Promise(r => setTimeout(r, 3500))]).then(() => { watchLive(); return { sched: s, model: _model, extras: _extras }; });
    });
    return _loading;
  }

  // ── live finals ─────────────────────────────────────────────────────────────────────────────────
  // The nightly/20-minute ingest writes results_2027.json; between runs, a game ESPN has marked final
  // joins RES right here (matched by ESPN game id to the announced schedule, so no name translation),
  // records and every projection count it immediately, and pages hear 'tdc:results' to redraw.
  let _liveN = 0, _liveTimer = null;
  const SB_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=400&dates=';
  const etDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
  const inSeason = () => { const m = new Date().getMonth(); return m >= 10 || m <= 3; };     // Nov – Apr
  async function mergeLive() {
    if (!_sched || !inSeason()) return 0;
    const byId = {}; (_sched.games || []).forEach(a => { byId[String(a[0])] = a; });
    const T = _sched.teams, now = Date.now();
    let added = 0;
    for (const d of [etDate(new Date(now)), etDate(new Date(now - 86400e3))]) {
      let j; try { j = await fetch(SB_URL + d).then(r => r.ok ? r.json() : null); } catch (e) { j = null; }
      ((j && j.events) || []).forEach(ev => {
        const id = String(ev.id), st = ev.status && ev.status.type;
        if (!st || st.state !== 'post' || RES[id] || !byId[id]) return;
        const c = ev.competitions && ev.competitions[0]; if (!c) return;
        const side = {}; (c.competitors || []).forEach(x => { side[x.homeAway] = x; });
        if (!side.home || !side.away) return;
        const hs = +side.home.score, as = +side.away.score; if (!isFinite(hs) || !isFinite(as) || hs === as) return;
        const a = byId[id];
        // our schedule's home/away came from ESPN too; if a game was flipped, swap the scores to match
        const flip = String(side.home.team && side.home.team.id) && a.length > 6 && a[6] && String(a[6]) !== String(side.home.team.id);
        RES[id] = { id, date: a[1], home: T[a[2]], away: T[a[3]], hs: flip ? as : hs, as: flip ? hs : as, neutral: !!a[4], conf: !!a[5], live: true };
        added++;
      });
    }
    if (added) {
      _liveN += added; _rate = null;
      if (_sched) _sched._rows = null;
      if (_results) _results.updated = String(_results.updated || '') + '|live' + _liveN;
      else _results = { updated: 'live' + _liveN, games: [] };
    }
    return added;
  }
  // while a page is open on a game day: look again every 2 minutes (visible tabs only)
  function watchLive() {
    if (_liveTimer || !inSeason() || typeof document === 'undefined') return;
    _liveTimer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const n = await mergeLive();
      if (n) { try { g.dispatchEvent(new CustomEvent('tdc:results', { detail: { added: n } })); } catch (e) {} }
    }, 120000);
  }

  // every listed game as {id,date,home,away,neutral,conf}
  function allGames() {
    if (!_sched) return [];
    if (_sched._rows) return _sched._rows;
    const T = _sched.teams;
    _sched._rows = _sched.games.map(a => ({ id: a[0], date: a[1], home: T[a[2]], away: T[a[3]], neutral: !!a[4], conf: !!a[5] }));
    // games that were played but never on the announced slate (late adds, event pairings) still count
    const ids = new Set(_sched._rows.map(r => String(r.id)));
    Object.values(RES).forEach(x => { if (!ids.has(String(x.id))) _sched._rows.push({ id: x.id, date: x.date, home: x.home, away: x.away, neutral: x.neutral, conf: x.conf }); });
    _sched._rows.sort((a, b) => a.date.localeCompare(b.date));
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

  // ── pace / efficiency pricing (scores + a light nudge on the spread) ───────
  // expected pace = tA + tB − avg; each offense vs the other defense, relative to the
  // league average, over that many possessions. Teams without a line get the flat total.
  function effLine(a, b) {
    if (!_eff || !_eff.teams) return null;
    const A = a && _eff.teams[a], B = b && _eff.teams[b]; if (!A || !B) return null;
    const pace = A.t + B.t - _eff.avgT, k = pace / 100, avg = (_eff.avgO + _eff.avgD) / 2;
    const ptsA = (A.o + B.d - avg) * k, ptsB = (B.o + A.d - avg) * k;
    return { pace, total: ptsA + ptsB, margin: ptsA - ptsB };
  }

  // ── projection ────────────────────────────────────────────────────────────
  // blowout tail (tdc-ratings.js tame): same soft knee as every other line on the site
  function tame(m) { return g.TDC_RATINGS && g.TDC_RATINGS.tame ? g.TDC_RATINGS.tame(m) : m; }
  function phi(x) { return g.TDC_RATINGS ? g.TDC_RATINGS.phi(x) : 0.5 * (1 + Math.tanh(x * 0.8)); }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  async function project(team, opts) {
    opts = opts || {};
    await load();
    if (!_sched || !g.TDC_RATINGS) return null;
    const D = await g.TDC_RATINGS.get();
    const SIGMA = g.TDC_RATINGS.SIGMA || 11, STRETCH = g.TDC_RATINGS.GAP_STRETCH || 1;
    buildRates(D);
    const rowOf = n => D.teams.find(t => t.full === n) || null;
    const me0 = rowOf(team); if (!me0) return null;
    // current strength (preseason prior + results so far) and its shrinking uncertainty
    const me = Object.assign({}, me0, { rating: rateOf(team, me0) }), tauMe = tauOf(team);
    // unrated (non-D-I) opponents. −14 over-projected bad teams by ~0.9 wins (they beat non-D-I schools less often
    // than that implies); −8 removes the bias top to bottom (scratchpad backtest_wl2.py, 4,801 team-seasons 2012-26:
    // expected-wins MAE 3.12 -> 3.09, bottom-quarter miss −0.87 -> −0.04, top quarter −0.10 -> +0.01). Owner, Oct 12 2026.
    const FLOOR = { team: '?', full: '?', rating: -8, hcaOff: 0 };
    const rated = n => { const r = rowOf(n); return r ? Object.assign({}, r, { rating: rateOf(n, r), _tau: tauOf(n) }) : null; };

    // my slate: listed games + hand-added ones, date order. A game in the results file is a fixed result;
    // a game the page knows is played (DB) but the results file doesn't have yet is left out.
    const played = new Set((opts.playedIds || []).map(String).filter(id => !RES[id]));
    // hand-added extras only fill dates the listed schedule doesn't already cover
    const listed = gamesFor(team), days = new Set(listed.map(x => x.date));
    const slate = listed.concat(extrasFor(team).filter(x => !days.has(x.date))).filter(x => !played.has(String(x.id))).sort((a, b) => a.date.localeCompare(b.date));
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
      const opp = oppName ? (rated(oppName) || FLOOR) : null;
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
      const eff = oppName ? effLine(team, oppName) : null;
      // ratings are points per game at an average pace; a fast game stretches the gap, a slow
      // one squeezes it (KenPom's tempo step, applied to our ratings gap)
      const paceK = eff ? eff.pace / _eff.avgT : 1;
      const res = !ex && RES[x.id];
      const final = res ? { ms: res.home === team ? res.hs : res.as, os: res.home === team ? res.as : res.hs } : null;
      if (final) final.won = final.ms > final.os;
      return { g: x, opp, oppName, venue, venuePts, sit, mf, of, known, restMe, restOpp, stintMe, stintOpp, eff, paceK, final,
        event: ex && ex.event || '', bracket: ex && ex.bracket ? ex.opps : null, pool: ex && ex.pool || null };
    });

    // listed games (ESPN or school-site ids) share one coin per sim across both teams' pages
    rows.forEach(r => {
      r.shared = !r.g.extra && !r.bracket && !r.pool && r.g.id != null;
      r.meHome = r.g.home === team;
      if (r.shared) { const k = hkey('g:' + r.g.id); r.coin = new Float64Array(SIMS); for (let s = 0; s < SIMS; s++) r.coin[s] = U(3, s, k); }
    });
    // pool of every rated team we might meet (for the per-sim rating draws)
    const names = new Set();
    rows.forEach(r => { if (r.oppName) names.add(r.oppName); (r.bracket || []).forEach(n => names.add(n)); (r.pool || []).forEach(n => names.add(n)); });
    const pool = {}; names.forEach(n => { pool[n] = rated(n) || Object.assign({ _tau: TAU }, FLOOR); });

    // ── Monte Carlo season ──
    const wins = new Array(rows.length).fill(0), W = new Int16Array(SIMS), CW = new Int16Array(SIMS);
    // ESPN doesn't flag conference games until the season starts — same 2026-27 league = league game
    const myLg = leagueOf(team, me);
    rows.forEach(r => { if (!r.g.conf && r.oppName && !r.g.extra && myLg && leagueOf(r.oppName, r.opp) === myLg) r.g.conf = true; });
    let confN = rows.filter(r => r.g.conf).length;
    for (let s = 0; s < SIMS; s++) {
      const rMe = me.rating + tauMe * zTeam(s, team);
      const rOpp = {}; for (const n in pool) rOpp[n] = pool[n].rating + (pool[n]._tau != null ? pool[n]._tau : TAU) * zTeam(s, n);
      let streak = 0, w = 0, cw = 0; const faced = new Set(); let day1Won = null;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; let oppName = r.oppName, venuePts = r.venuePts;
        if (r.final) { if (r.final.won) { wins[i]++; w++; if (r.g.conf) cw++; } continue; }   // already played
        if (r.bracket) {
          // day 2 of a 4-team bracket: our day-1 result decides whether we meet the other pair's winner or loser
          const [a, b] = r.bracket; const pa = phi((rOpp[a] - rOpp[b]) / SIGMA); const aWon = Math.random() < pa;
          const winner = aWon ? a : b, loser = aWon ? b : a;
          oppName = day1Won === false ? loser : winner;
        } else if (r.pool) {
          const cands = r.pool.filter(n => !faced.has(n)); oppName = cands[Math.floor(Math.random() * cands.length)] || r.pool[0];
        }
        const oppR = oppName ? (rOpp[oppName] != null ? rOpp[oppName] : FLOOR.rating) : FLOOR.rating;
        const m = tame((rMe - oppR) * STRETCH * r.paceK + venuePts + r.sit);
        const p = phi(m / SIGMA);
        // one coin per game per sim, read from the LISTED home side: home wins below p_home, so the
        // away page (p_away = 1 − p_home) wins above it — the same game can't go both ways
        const won = r.shared ? (r.meHome ? r.coin[s] < p : r.coin[s] > 1 - p) : Math.random() < p;
        if (rows[i + 1] && rows[i + 1].bracket && !r.bracket) day1Won = won;   // the game right before a bracket day-2 is our day-1
        if (oppName) faced.add(oppName);
        if (won) { wins[i]++; w++; if (r.g.conf) cw++; streak = streak > 0 ? streak + 1 : 1; }
        else { streak = streak < 0 ? streak - 1 : -1; }
      }
      W[s] = w; CW[s] = cw;
    }
    const sorted = Array.from(W).sort((a, b) => a - b), n = rows.length;
    const done = rows.filter(r => r.final), playedW = done.filter(r => r.final.won).length;
    const playedCW = done.filter(r => r.final.won && r.g.conf).length, playedCN = done.filter(r => r.g.conf).length;
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
      const margin = tame((me.rating - oppR) * STRETCH * r.paceK + r.venuePts + r.sit);
      r.margin = +margin.toFixed(1);
      r.p0 = phi(margin / SIGMA);                                          // point-estimate odds, no rating uncertainty / streak
      const total = r.eff ? r.eff.total : DEFAULT_TOTAL;                   // pace + efficiency total, flat when unknown
      r.total = +total.toFixed(1); r.pace = r.eff ? +r.eff.pace.toFixed(1) : null;
      r.scoreMe = Math.round(total / 2 + margin / 2); r.scoreOpp = Math.round(total / 2 - margin / 2);
      const oppLabel = r.bracket ? `${sn(r.bracket[0])} / ${sn(r.bracket[1])}` : r.pool ? 'TBD · ' + r.event.replace(/ · day.*/, '') : (r.oppName || 'TBD');
      r.label = oppLabel;
      r.spread = margin >= 0 ? `${sn(team)} −${margin.toFixed(1)}` : `${r.oppName ? sn(r.oppName) : 'Opp'} −${(-margin).toFixed(1)}`;
    });
    // GAME-BY-GAME PICKS (owner, Oct 12 2026): the record if every game goes to the side we favor. Runs extreme by design —
    // a top-10 team picked this way averages ~33 wins vs ~28 real (scratchpad backtest_wl.py); expW stays the honest number.
    const left = rows.filter(r => !r.final);
    const pickW = playedW + left.filter(r => r.margin > 0).length, pickCW = playedCW + left.filter(r => r.g.conf && r.margin > 0).length;
    // rows = the games still to play (what the schedule table projects); played = the results already in
    return { team, me, rows: left, played: done, pickW, pickL: n - pickW, pickCW, pickCL: confN - pickCW, playedW, playedL: done.length - playedW, playedCW, playedCL: playedCN - playedCW,
      counted: new Set(done.map(r => String(r.g.id))), sims: SIMS, tau: tauMe, sigma: SIGMA, n, confN, expW, expCW, modeW, lo: pct(0.1), hi: pct(0.9), W, CW, league: myLg,
      p20: pAtLeast(20), p25: pAtLeast(25), pHalf: sorted.filter(w => w * 2 >= n).length / sorted.length, model: _model, hist };
  }

  // ── render ────────────────────────────────────────────────────────────────
  // its own table class (not .sched-table) so the team page's mono/dim overrides don't apply
  // early-season events (MTEs) ride as a short tag in the opponent cell, full name on hover: the long names
  // ("WestStar Don Haskins Sun Bowl Invitational · TBD") used to sit in the Date cell and blow it out
  const EV_SHORT = [[/players era/i, 'Players Era'], [/maui/i, 'Maui'], [/battle 4 atlantis/i, 'B4A'], [/baha mar/i, 'Baha Mar'],
    [/canc[uú]n/i, 'Cancún'], [/paradise jam/i, 'Paradise Jam'], [/sun bowl|don haskins/i, 'Sun Bowl'], [/rady/i, 'Rady'],
    [/acrisure/i, 'Acrisure'], [/charleston classic/i, 'Charleston'], [/fort myers/i, 'Ft. Myers'], [/espn events/i, 'ESPN Events'],
    [/sunshine slam/i, 'Sunshine Slam'], [/greenbrier/i, 'Greenbrier'], [/rainbow/i, 'Rainbow'], [/resorts world/i, 'Resorts World'],
    [/live oak/i, 'Live Oak'], [/thanksgiving/i, 'Thanksgiving'], [/bourbon/i, 'Bourbon St'], [/dallas tournament/i, 'Dallas'], [/^event$/i, 'MTE']];
  const evEsc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // phones: initials for multi-word names (Players Era -> PE, Paradise Jam -> PJ), one-word names stay (Maui)
  function evTiny(s) {
    const full = evShort(s), [nm, day] = full.split(' · ');
    const w = nm.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const ini = w.length > 1 ? w.map(x => /^\d+$/.test(x) ? x : x[0].toUpperCase()).join('') : nm;
    return ini + (day ? ' · ' + day : '');
  }
  function evShort(s) {
    const [name, rest] = String(s).split(/\s*·\s*/);
    const hit = EV_SHORT.find(([re]) => re.test(name));
    const sh = hit ? hit[1] : name.replace(/\s+(MTE|Invitational|Classic|Tip-Off|Championship|Challenge|Tournament)$/i, '').trim();
    const day = (rest || '').match(/day\s*(\d+)/i);
    return sh + (day ? ' · D' + day[1] : '');
  }
  const CSS = `
  .tsp{font-family:'Inter',system-ui,sans-serif;}
  .tsp-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 12px;}
  .tsp-tile{border:1px solid var(--border);border-radius:9px;padding:9px 12px 8px;background:var(--bg2);min-width:0;}
  .tsp-tile .k{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:3px;white-space:nowrap;}
  .tsp-tile .v{font-family:'Playfair Display',serif;font-weight:800;font-size:21px;line-height:1;color:var(--text);white-space:nowrap;}
  .tsp-tile .v small{font-family:'Inter',sans-serif;font-size:10.5px;font-weight:600;color:var(--text3);margin:0 3px;}
  .tsp-tile .s{font-size:10.5px;color:var(--text3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  /* the table itself is the site sheet (tdc-sheets.css .sheet.dense) — only the extras here */
  .tsp-table td.tsp-o .tsp-lg{display:inline-block;width:16px;height:16px;object-fit:contain;vertical-align:middle;margin:-2px 7px 0 0;}
  .tsp-table td.tsp-o a{color:var(--text);text-decoration:none;} .tsp-table td.tsp-o a:hover{color:var(--accent);text-decoration:underline;}
  .tsp-table td.tsp-o .cfdot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--text3);margin-left:7px;vertical-align:middle;}
  .tsp-table .tsp-ev .ev-s{display:none;}
  .tsp-table .tsp-ev,.tsp-table .tsp-ev *{white-space:nowrap!important;}
  .tsp-table .tsp-ev{display:inline-block;margin-left:7px;padding:1px 6px;border:1px solid var(--border2);border-radius:4px;font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--text3);white-space:nowrap;vertical-align:1px;cursor:help;}
  .tsp-table tr.mo1 td{border-top:2px solid var(--border2);}
  /* the whole season, not a 600px box that scrolls on its own (a 2007-08 slate ended at 8-17 in view) */
  .tsp-wrap{max-height:none!important;}
  /* the whole row green for a win, red for a loss (opaque mixes so frozen columns tint too; heat cells keep their scale) */
  .tsp-table tbody tr.w td:not(.heat){background-color:color-mix(in srgb,#2e8b57 24%,var(--bg))!important;}
  .tsp-table tbody tr.x td:not(.heat){background-color:color-mix(in srgb,#c75d5d 24%,var(--bg))!important;}
  .tsp-table tbody tr.w:hover td:not(.heat){background-color:color-mix(in srgb,#2e8b57 32%,var(--bg))!important;}
  .tsp-table tbody tr.x:hover td:not(.heat){background-color:color-mix(in srgb,#c75d5d 32%,var(--bg))!important;}
  [data-theme="dark"] .tsp-table tbody tr.w td:not(.heat){background-color:color-mix(in srgb,#3fa86a 26%,var(--bg))!important;}
  [data-theme="dark"] .tsp-table tbody tr.x td:not(.heat){background-color:color-mix(in srgb,#d0605a 26%,var(--bg))!important;}
  /* winner / loser on the result */
  .tsp-table tr.w td.tsp-sc{color:#2e8b57;} .tsp-table tr.x td.tsp-sc{color:#c75d5d;}
  [data-theme="dark"] .tsp-table tr.w td.tsp-sc{color:#6fbf7e;} [data-theme="dark"] .tsp-table tr.x td.tsp-sc{color:#e07a7a;}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .tsp-table tr.w td.tsp-sc{color:#6fbf7e;}:root:not([data-theme="light"]) .tsp-table tr.x td.tsp-sc{color:#e07a7a;}}
  .tsp-table tbody tr.sec td{background:var(--bg2);color:var(--text3);font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;text-align:left;}
  .tsp-wi{position:relative;border:1px solid var(--border);border-radius:9px;background:var(--bg2);padding:10px 12px 8px;margin:0 0 12px;}
  .tsp-wi-h{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:12px;color:var(--text2);}
  .tsp-wi-h>b{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);}
  .tsp-wi-c b{color:var(--text);font-weight:800;} .tsp-wi-c .dim{color:var(--text3);}
  .tsp-wi-ctl{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
  .tsp-wi-ctl button{min-width:26px;height:24px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--text);font:700 12px Inter,sans-serif;cursor:pointer;}
  .tsp-wi-ctl button.rs{padding:0 8px;font-size:10.5px;color:var(--text3);}
  .tsp-wi-svg{display:block;width:100%;height:150px;margin-top:6px;overflow:visible;}
  .tsp-wi-svg .gl{stroke:var(--border);stroke-width:1;} .tsp-wi-svg .tk{font:600 9.5px Inter,sans-serif;fill:var(--text3);text-anchor:end;}
  .tsp-wi-svg .ln{fill:none;stroke:var(--accent,#c8a24a);stroke-width:2;vector-effect:non-scaling-stroke;}
  .tsp-wi-svg .bl{fill:none;stroke:var(--text3);stroke-width:1.5;stroke-dasharray:4 3;vector-effect:non-scaling-stroke;}
  .tsp-wi-svg .fp{fill:var(--accent,#c8a24a);stroke:var(--bg2);stroke-width:2;}
  .tsp-wi-svg .cx{stroke:var(--text3);stroke-width:1;vector-effect:non-scaling-stroke;}
  .tsp-wi-tip{position:absolute;top:34px;z-index:5;width:160px;padding:6px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--bg);font-size:11px;color:var(--text2);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.12);}
  .tsp-wi-tip b{color:var(--text);}
  .tsp-wi-n{font-size:10.5px;color:var(--text3);line-height:1.45;margin-top:4px;}
  .tsp-table .tsp-pkb{min-width:26px;height:22px;border:1px solid var(--border2);border-radius:5px;background:var(--bg);color:#2e8b57;font:800 11px Inter,sans-serif;cursor:pointer;}
  .tsp-table .tsp-pkb.lw{color:#c75d5d;} .tsp-table .tsp-pkb.on{border-color:var(--accent,#c8a24a);box-shadow:0 0 0 1px var(--accent,#c8a24a) inset;}
  .tsp-note{font-size:11px;color:var(--text3);line-height:1.5;margin:10px 2px 0;}
  .tsp-note b{color:var(--text2);}
  /* every column but Opponent hugs its content; the opponent takes the spare width (it used to land on Date and
     Rk, so a "Sat 10/17" column ran ~500px wide on desktop) */
  .tsp-table th,.tsp-table td{width:1%;white-space:nowrap;}
  .tsp-table th:nth-child(3),.tsp-table td.tsp-o{width:auto;}
  .tsp-table tr.sec td{width:auto;}
  @media(min-width:900px){ .tsp-table td:not(.tsp-o):not(.tsp-d):not([colspan]),.tsp-table th:not(:nth-child(1)):not(:nth-child(3)){min-width:76px;} .tsp-table td.tsp-d,.tsp-table th:first-child{min-width:80px;} }
  @media(max-width:760px){.tsp-sum{grid-template-columns:repeat(2,minmax(0,1fr));}}
  /* phones (every page that shows a schedule): fit the screen. The section label rows were nowrap, so one long
     "Preseason scrimmages · unofficial…" line stretched the table to ~660px; they wrap now. Opponent names
     wrap beside the logo, the weekday and the Rk / Quad / Opp PRtg columns go, cells tighten. */
  @media(max-width:640px){
    .tsp-table{width:100%!important;}
    .tsp-table tr.sec td{white-space:normal!important;line-height:1.35;}
    .tsp-table th,.tsp-table td{padding-left:3px!important;padding-right:3px!important;font-size:12px!important;}
    .tsp-table th{font-size:10.5px!important;letter-spacing:.02em;}
    .tsp-dw,.tsp-table .tsp-rk,.tsp-table .tsp-q,.tsp-table .tsp-pr,
    .tsp-table th[title="opponent's rank"],.tsp-table th[title^="NET-style"],.tsp-table th[title^="opponent's projected"]{display:none!important;}
    .tsp-table td.tsp-d,.tsp-table td.tsp-site{padding-left:3px!important;padding-right:3px!important;font-size:12px!important;}
    .tsp-table td.tsp-o{max-width:100px;white-space:normal!important;line-height:1.2;position:relative;padding-right:12px!important;}
    .tsp-table td.tsp-o .tsp-lg{width:16px;height:16px;margin-right:4px;vertical-align:middle;}
    .tsp-table td.tsp-o a{display:inline-block;max-width:calc(100% - 22px);vertical-align:middle;}
    .tsp-table td.tsp-o .cfdot{position:absolute;right:3px;top:50%;margin:-3px 0 0;}
    .tsp-table .tsp-ev .ev-l{display:none;} .tsp-table .tsp-ev .ev-s{display:inline;}
    .tsp-table .tsp-ev{margin-left:4px;padding:0 4px;font-size:9px;}
  }`;
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
  // red-to-green column shading from the shared sheet kit (tdc-sheets.js), when the page loads it
  const shade = host => { const t = host.querySelector('table.sheet'); if (t && g.tdcSheetHeat) g.tdcSheetHeat(t); };
  const restTxt = f => f.rest == null ? 'opener' : f.rest <= 1 ? 'b2b' : f.rest + 'd';
  function logoOf(name) { try { const r = g.tdcTeamColor && g.tdcTeamColor(name); return r && r.logo || ''; } catch (e) { return ''; } }
  const logoImg = name => { const u = logoOf(name); return u ? `<img class="tsp-lg" src="${u}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<i class="tsp-lg"></i>'; };

  function render(host, R, opts) {
    ensureCss(); opts = opts || {};
    const sn = g.tdcShortSchool || (x => x), team = R.team;
    let lastMo = null, rows = '';
    const moCls = key => { const c = lastMo !== null && key !== lastMo ? ' mo1' : ''; lastMo = key; return c; };
    // results already on the books: the page's own (database) rows + any the results file has that it doesn't,
    // one running record across both
    const idOf = x => x.id != null ? String(x.id) : ((String(x.href || '').match(/id=(\d+)/) || [])[1] || null);
    const pageIds = new Set((opts.played || []).map(idOf).filter(Boolean));
    const fromFile = (R.played || []).filter(r => !pageIds.has(String(r.g.id))).map(r => ({ id: r.g.id, date: r.g.date, opp: r.oppName,
      rank: r.opp && r.opp.rank, site: r.venue, won: r.final.won, ms: r.final.ms, os: r.final.os, conf: r.g.conf, href: 'game.html?id=' + r.g.id }));
    const playedAll = (opts.played || []).concat(fromFile).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (fromFile.length) { let w = 0, l = 0, cw = 0, cl = 0;
      playedAll.forEach(x => { x.won ? w++ : l++; const cf = x.conf != null ? x.conf : /\(/.test(x.rec || ''); if (x.conf) { x.won ? cw++ : cl++; } x.rec = `${w}–${l}` + (x.conf ? ` (${cw}–${cl})` : ''); }); }
    playedAll.forEach(x => {          // results already on the books
      const d = dParts(x.date);
      rows += `<tr class="${x.won ? 'w' : 'x'}${moCls(d.key)}" style="cursor:${x.href ? 'pointer' : 'default'}" onclick="${x.href ? `location.href='${x.href}'` : ''}">
        <td class="l dim tsp-d"><span class="tsp-dw">${d.dw} </span>${d.num}</td>
        <td class="dim tsp-rk">${x.rank || ''}</td>
        <td class="l nm tsp-o">${logoImg(x.opp)}<a href="team.html?team=${encodeURIComponent(sn(x.opp))}" onclick="event.stopPropagation()">${sn(x.opp)}</a></td>
        <td class="c strong tsp-sc">${x.won ? 'W' : 'L'} ${x.ms}–${x.os}</td>
        <td class="c tsp-site">${x.site}</td>
        <td class="c tsp-q">${quad(x.rank, x.site) ? 'Q' + quad(x.rank, x.site) : ''}</td>
        <td class="tsp-pr"></td>
        <td class="tsp-p"></td>
        <td class="tsp-line">${x.rec}</td>${opts.whatIf ? '<td class="tsp-pk"></td>' : ''}</tr>`;
    });
    R.rows.forEach(r => {
      const d = dParts(r.g.date);
      const tl = n => `<a href="team.html?team=${encodeURIComponent(sn(n))}" onclick="event.stopPropagation()">${sn(n)}</a>`;
      const oppTxt = r.bracket ? `${tl(r.bracket[0])} / ${tl(r.bracket[1])}` : r.pool ? 'TBD' : (r.oppName ? tl(r.oppName) : 'TBD');
      // encodeURIComponent leaves apostrophes alone, and the href sits inside a single-quoted onclick (St. John's)
      const enc = x => encodeURIComponent(x).replace(/'/g, '%27');
      const pv = r.oppName ? `preview.html?team=${enc(team)}&opp=${enc(r.oppName)}&date=${r.g.date}` : '';
      const restD = r.restMe - r.restOpp, trip = r.stintMe - r.stintOpp;
      const edge = r.venuePts + r.sit;
      const siteTitle = r.venue === 'H' ? `home edge ${sg(r.venuePts)}` : r.venue === 'A' ? `their building ${sg(r.venuePts)}` : 'neutral floor';
      const mc = moCls(d.key);
      const rk = r.opp && r.opp.rank ? r.opp.rank : null, q = quad(rk, r.venue);
      const pc = Math.round(r.p * 100);
      rows += `<tr class="${mc.trim()}"${pv ? ` style="cursor:pointer" onclick="location.href='${pv}'" title="open the game preview"` : ''}>
        <td class="l dim tsp-d"><span class="tsp-dw">${d.dw} </span>${d.num}</td>
        <td class="dim tsp-rk">${rk || ''}</td>
        <td class="l nm tsp-o">${r.oppName ? logoImg(r.oppName) : '<i class="tsp-lg"></i>'}${oppTxt}${r.g.conf ? '<i class="cfdot" title="conference game"></i>' : ''}${r.event ? `<span class="tsp-ev" title="${evEsc(r.event)}"><span class="ev-l">${evEsc(evShort(r.event))}</span><span class="ev-s">${evEsc(evTiny(r.event))}</span></span>` : ''}</td>
        <td class="c tsp-sc" title="${r.pace ? `${r.pace} possessions · total ${r.total}` : 'league-average total'}">${r.scoreMe}–${r.scoreOpp}</td>
        <td class="c tsp-site" title="${siteTitle} · rest ${restTxt(r.mf)} vs ${r.known ? restTxt(r.of) : (r.oppName ? '?' : 'same')}${Math.abs(restD) >= 0.15 ? ` (${sg(restD)})` : ''}${r.mf.stint >= 2 ? ` · ${r.mf.stint}${r.mf.stint === 2 ? 'nd' : r.mf.stint === 3 ? 'rd' : 'th'} straight away` : ''} · situational edge ${sg(edge)}">${r.venue}</td>
        <td class="c tsp-q" title="NET-style quadrant: opponent rank ${rk || '—'} ${r.venue === 'H' ? 'at home' : r.venue === 'A' ? 'on the road' : 'on a neutral floor'}">${q ? 'Q' + q : ''}</td>
        <td class="tsp-pr">${r.opp && isFinite(r.opp.rating) ? sg(r.opp.rating) : ''}</td>
        <td class="tsp-p" title="${Math.round(r.p0 * 100)}% on the line alone · ${pc}% across simulated seasons">${pc}%</td>
        <td class="tsp-line">${r.margin >= 0 ? '−' : '+'}${Math.abs(r.margin).toFixed(1)}</td>${opts.whatIf ? `<td class="c tsp-pk"><button type="button" class="tsp-pkb" data-i="${R.rows.indexOf(r)}" title="our pick — click to flip this result and see where the ranking goes" onclick="event.stopPropagation()">${r.margin > 0 ? 'W' : 'L'}</button></td>` : ''}</tr>`;
    });
    const W = Math.round(R.expW), L = R.n - W, cw = Math.round(R.expCW), cl = R.confN - cw;
    // the projection already counts every game in the results file; add only played games it doesn't know yet
    const extra = (opts.played || []).filter(x => !(R.counted && R.counted.has(idOf(x))));
    const pw = extra.filter(x => x.won).length, pl = extra.length - pw;
    const sw = pw + (R.playedW || 0), sl = pl + (R.playedL || 0);
    const m = R.model || {};
    const sum = `<div class="tsp-sum">
      <div class="tsp-tile" title="likely range ${pw + R.lo}–${pl + R.n - R.lo} to ${pw + R.hi}–${pl + R.n - R.hi} (10th–90th pct of ${R.sims.toLocaleString()} simulated seasons)"><div class="k">Projected record</div><div class="v">${pw + W}–${pl + L}</div><div class="s">${(pw + R.expW).toFixed(1)} expected wins${sw + sl ? ` · ${sw}–${sl} so far` : ''}</div></div>
      <div class="tsp-tile" title="the record if the side we favor wins every game — runs high for good teams and low for bad ones (favorites lose some); the projected record is the honest expectation"><div class="k">Game-by-game</div><div class="v">${pw + R.pickW}–${pl + R.pickL}</div><div class="s">if every favorite wins${R.confN ? ` · ${R.pickCW}–${R.pickCL} conf` : ''}</div></div>
      <div class="tsp-tile"><div class="k">Conference</div><div class="v">${R.confN ? `${cw}–${cl}` : '—'}</div><div class="s">${R.confN ? `${R.expCW.toFixed(1)} of ${R.confN} league games` : 'no league games listed yet'}</div></div>
      <div class="tsp-tile"><div class="k">20+ wins</div><div class="v">${Math.round(R.p20 * 100)}%</div><div class="s">25+ ${Math.round(R.p25 * 100)}% · .500+ ${Math.round(R.pHalf * 100)}%</div></div>
    </div>`;
    const note = `<div class="tsp-note"><b>Line</b> = projected margin (− favored, + underdog), built from the ratings, the host's measured home edge, and rest: back-to-backs cost ${sg(m.rest && m.rest.b2b || 0)} pts, 8+ days off ${sg(m.rest && m.rest.r8 || 0)}, a season opener ${sg(m.rest && m.rest.opener || 0)} (${(m.n || 0).toLocaleString()} games since ${m.firstSeason || 2008}; road trips and win streaks measure ≈ 0). Hover a Site badge for that game's breakdown. <b>Win %</b> is the share of ${R.sims.toLocaleString()} simulated seasons, each drawing every team's true strength ±${R.tau} around its projection.</div>`;
    host.innerHTML = `<div class="tsp">${sum}<div class="sheet-wrap tsp-wrap"><table class="sheet dense tsp-table"><thead><tr>
      <th class="l">Date</th><th title="opponent's rank">Rk</th><th class="l">Opponent</th><th class="c" title="projected score">Score</th><th class="c" title="H home · A away · N neutral">Site</th><th class="c" title="NET-style quadrant">Quad</th><th title="opponent's projected Power Rating">Opp PRtg</th><th data-heat="1" title="win probability across the simulated seasons">Win %</th><th data-heat="-1" title="projected margin: − favored, + underdog">Line</th>${opts.whatIf ? '<th class="c" title="our game-by-game pick — click one to flip it">Pick</th>' : ''}
    </tr></thead><tbody>${rows}</tbody></table></div>${note}</div>`;
    shade(host);
    if (opts.whatIf) whatIf(host, R, pw, pl);
  }

  // ── what-if rankings (owner, Oct 12 2026) ──────────────────────────────────────────────────────────
  // The Power Rating barely moves when a team plays to projection, so the rank line is flat as projected; flip a
  // game (or set a record) and every team's rating is re-solved with the REAL in-season formula
  // (TDC_RATINGS.applyForm: preseason = 8 games + opponent/venue-adjusted margins) after each of this team's games.
  // Unflipped games enter at their projected margin (they add weight, not movement); a flipped game enters at the
  // average margin of that outcome given our line: E[M | M>0] = m + σφ(m/σ)/(1−Φ(m/σ)), mirrored for a loss.
  const _dens = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  function flipMargin(m, sig) {
    const z = m / sig, P = phi(z);
    return m > 0 ? m - sig * _dens(z) / Math.max(1e-9, P) : m + sig * _dens(z) / Math.max(1e-9, 1 - P);
  }
  async function rankPath(R, flips) {
    const D = await g.TDC_RATINGS.get(), SIG = g.TDC_RATINGS.SIGMA || 11, team = R.team;
    const base = D.teams.map(t => ({ full: t.full, rating: t.preRating != null ? +t.preRating : +t.rating || 0, hcaOff: t.hcaOff || 0 }));
    const cur = {}; D.teams.forEach(t => { cur[t.full] = +t.rating || 0; });
    const pre = {}; base.forEach(t => { pre[t.full] = t; });
    const games = [];
    Object.values(RES).forEach(x => { if (pre[x.home] && pre[x.away]) games.push({ date: x.date, home: x.home, away: x.away, home_score: x.hs, away_score: x.as, neutral: x.neutral }); });
    const flipBy = {}; R.rows.forEach((r, i) => { if (flips.has(i) && r.g && r.g.id != null) flipBy[String(r.g.id)] = r; });
    allGames().forEach(x => {
      if (RES[x.id] || !pre[x.home] || !pre[x.away]) return;
      const hc = x.neutral ? 0 : g.TDC_RATINGS.baseHca(pre[x.away].rating) + (pre[x.home].hcaOff || 0);
      let m = cur[x.home] - cur[x.away] + hc;                        // at projection: no residual, no movement
      const f = flipBy[String(x.id)];
      if (f) { const mm = flipMargin(f.margin, SIG); m = x.home === team ? mm : -mm; }
      games.push({ date: x.date, home: x.home, away: x.away, home_score: m, away_score: 0, neutral: x.neutral, id: x.id });
    });
    games.sort((a, b) => a.date.localeCompare(b.date));
    const solveTo = d => {
      const rows = base.map(t => Object.assign({}, t));
      g.TDC_RATINGS.applyForm(rows, games.filter(x => x.date <= d));
      rows.sort((a, b) => b.rating - a.rating);
      const i = rows.findIndex(t => t.full === team); return { rank: i + 1, rating: rows[i] ? rows[i].rating : null };
    };
    let w = R.playedW || 0, l = R.playedL || 0;
    const pts = [Object.assign({ date: null, w, l, label: 'Now' }, solveTo(new Date().toISOString().slice(0, 10)))];   // results so far only
    R.rows.forEach((r, i) => {
      if (r.bracket || r.pool || !r.oppName) return;
      const won = (r.margin > 0) !== flips.has(i); won ? w++ : l++;
      pts.push(Object.assign({ date: r.g.date, w, l, i, won, flipped: flips.has(i), label: (g.tdcShortSchool || (x => x))(r.oppName) }, solveTo(r.g.date)));
    });
    return pts;
  }
  function whatIf(host, R, pw, pl) {
    const box = document.createElement('div'); box.className = 'tsp-wi';
    host.querySelector('.tsp-sum').after(box);
    const flips = new Set(), base0 = { v: null };
    const picks = R.rows.map(r => r.margin > 0);
    const totW = () => pw + (R.playedW || 0) + R.rows.reduce((a, r, i) => a + ((picks[i] !== flips.has(i)) ? 1 : 0), 0);
    const N = pw + pl + R.n;
    const setTarget = target => {          // flip the closest games first: they're the likeliest to go the other way
      flips.clear(); const k = totW(); if (target === k) return;
      const want = target > k;            // need more wins: flip projected losses, nearest the line first
      R.rows.map((r, i) => ({ i, m: r.margin })).filter(o => !(R.rows[o.i].bracket || R.rows[o.i].pool || !R.rows[o.i].oppName) && (want ? o.m <= 0 : o.m > 0))
        .sort((a, b) => Math.abs(a.m) - Math.abs(b.m)).slice(0, Math.abs(target - k)).forEach(o => flips.add(o.i));
    };
    let seq = 0;
    async function draw() {
      const my = ++seq;
      host.querySelectorAll('.tsp-pkb').forEach(b => { const i = +b.dataset.i, won = picks[i] !== flips.has(i);
        b.textContent = won ? 'W' : 'L'; b.classList.toggle('on', flips.has(i)); b.classList.toggle('lw', !won); });
      box.innerHTML = `<div class="tsp-wi-h"><b>Projected ranking</b><span class="tsp-wi-c">computing…</span></div>`;
      let pts; try { pts = await rankPath(R, flips); } catch (e) { box.innerHTML = ''; console.warn('what-if', e); return; }
      if (my !== seq) return;
      if (!flips.size) base0.v = pts;
      const B = base0.v || pts, last = pts[pts.length - 1], w = totW();
      box.innerHTML = `<div class="tsp-wi-h"><b>Projected ranking</b>
          <span class="tsp-wi-c">Now <b>#${pts[0].rank}</b> → finishes <b>#${last.rank}</b> at <b>${w}–${N - w}</b>${flips.size ? ` <span class="dim">(as projected: #${B[B.length - 1].rank})</span>` : ' · as projected'}</span>
          <span class="tsp-wi-ctl"><button type="button" data-d="-1" aria-label="one fewer win">−</button><span title="final record — flips the closest games first">${w}–${N - w}</span><button type="button" data-d="1" aria-label="one more win">+</button>${flips.size ? '<button type="button" class="rs">Reset</button>' : ''}</span></div>
        ${chart(pts, B)}
        <div class="tsp-wi-n">Our pick in every game keeps the rank flat — that's what playing to projection means. Click a <b>Pick</b> to flip a result, or step the record; each flipped game counts at the typical margin of that upset, and every team's rating is re-solved the way it will be in-season.</div>`;
      box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const t = Math.max(0, Math.min(N, totW() + +b.dataset.d)); setTarget(t); draw(); });
      const rs = box.querySelector('.rs'); if (rs) rs.onclick = () => { flips.clear(); draw(); };
      wireTip(box, pts);
    }
    host.querySelectorAll('.tsp-pkb').forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.i; flips.has(i) ? flips.delete(i) : flips.add(i); draw(); });
    draw();
  }
  function chart(pts, B) {
    const W = 720, H = 150, pl = 34, pr = 10, pt = 10, pb = 20, n = pts.length;
    const ranks = pts.map(p => p.rank).concat(B.map(p => p.rank));
    let lo = Math.max(1, Math.min.apply(null, ranks) - 3), hi = Math.max.apply(null, ranks) + 3;
    const x = i => pl + (n > 1 ? i * (W - pl - pr) / (n - 1) : 0), y = r => pt + (r - lo) * (H - pt - pb) / Math.max(1, hi - lo);
    const path = a => a.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join('');
    const ticks = []; const step = Math.max(1, Math.ceil((hi - lo) / 4)); for (let r = lo; r <= hi; r += step) ticks.push(r);
    return `<svg class="tsp-wi-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="projected rank after each game">
      ${ticks.map(r => `<line x1="${pl}" x2="${W - pr}" y1="${y(r)}" y2="${y(r)}" class="gl"/><text x="${pl - 6}" y="${y(r) + 3}" class="tk">#${r}</text>`).join('')}
      ${B !== pts ? `<path d="${path(B)}" class="bl"/>` : ''}
      <path d="${path(pts)}" class="ln"/>
      ${pts.map((p, i) => p.flipped ? `<circle cx="${x(i)}" cy="${y(p.rank)}" r="4" class="fp"/>` : '').join('')}
      <line class="cx" x1="0" x2="0" y1="${pt}" y2="${H - pb}" style="display:none"/>
      <rect class="hit" x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent"/>
    </svg><div class="tsp-wi-tip" style="display:none"></div>`;
  }
  function wireTip(box, pts) {
    const svg = box.querySelector('svg'), tip = box.querySelector('.tsp-wi-tip'), cx = svg && svg.querySelector('.cx');
    if (!svg) return;
    const n = pts.length;
    svg.addEventListener('mousemove', e => {
      const bb = svg.getBoundingClientRect(), fx = (e.clientX - bb.left) / bb.width * 720;
      const i = Math.max(0, Math.min(n - 1, Math.round((fx - 34) / ((720 - 44) / Math.max(1, n - 1)))));
      const p = pts[i], px = 34 + (n > 1 ? i * (720 - 44) / (n - 1) : 0);
      cx.setAttribute('x1', px); cx.setAttribute('x2', px); cx.style.display = '';
      tip.style.display = ''; tip.style.left = Math.min(bb.width - 170, Math.max(0, px / 720 * bb.width - 80)) + 'px';
      tip.innerHTML = p.date ? `<b>#${p.rank}</b> after ${p.won ? 'W' : 'L'} vs ${p.label}${p.flipped ? ' <i>(flipped)</i>' : ''}<br>${p.w}–${p.l} · ${p.date.slice(5).replace('-', '/')}` : `<b>#${p.rank}</b> today · ${p.w}–${p.l}`;
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cx.style.display = 'none'; });
  }

  // every rated team's projected record for the rankings table — lighter sims, cached in
  // localStorage until the ratings or the schedule file change
  const LS_ALL = 'tdc_projrec_v13';
  async function projectAll(opts) {
    opts = opts || {};
    await load();
    if (!_sched || !g.TDC_RATINGS) return {};
    const D = await g.TDC_RATINGS.get();
    const stamp = (D.generated || '') + '|' + (_sched.pulled || '') + '|' + (_sched.games || []).length + '|' + ((_results && _results.updated) || '');
    try { const c = JSON.parse(localStorage.getItem(LS_ALL) || 'null'); if (c && c.stamp === stamp) return c.recs; } catch (e) {}
    const recs = {};
    for (const t of D.teams) {
      const R = await project(t.full, { sims: opts.sims || 600 });
      if (R) recs[t.full] = { w: Math.round(R.expW), l: R.n - Math.round(R.expW), cw: Math.round(R.expCW), cl: R.confN - Math.round(R.expCW),
        n: R.n, confN: R.confN, lo: R.lo, hi: R.hi, p20: +R.p20.toFixed(2), kw: R.pickW, kl: R.pickL, kcw: R.pickCW, kcl: R.pickCL,
        // the record so far (every result incl. games that just went final)
        pw: R.playedW || 0, pl: R.playedL || 0, pcw: R.playedCW || 0, pcl: R.playedCL || 0 };
    }
    try { localStorage.setItem(LS_ALL, JSON.stringify({ stamp, recs })); } catch (e) {}
    return recs;
  }

  // played season, same grid: Date · Rk · Opponent · Result · Site · Quad · Opp PRtg · Exp · +/- · Record
  // rows: [{date, opp, rank, oppSrs, site, won, ms, os, rec, conf, href, section}] ; opts.mySrs
  function renderPast(host, rows, opts) {
    ensureCss(); opts = opts || {};
    const sn = g.tdcShortSchool || (x => x);
    // oppSrs / mySrs here are RAW team_seasons SRS (D-I average ≈ +12): use the raw-SRS reader
    const hca = g.TDC_RATINGS && g.TDC_RATINGS.baseHcaSrs ? g.TDC_RATINGS.baseHcaSrs : (() => 3.7);
    let lastMo = null, html = '';
    const moCls = key => { const c = lastMo !== null && key !== lastMo ? ' mo1' : ''; lastMo = key; return c; };
    rows.forEach(x => {
      if (x.section) { html += `<tr class="sec"><td colspan="10">${x.section}</td></tr>`; return; }
      const d = dParts(x.date), q = quad(x.rank, x.site), m = x.ms - x.os;
      const exp = (opts.mySrs != null && x.oppSrs != null) ? opts.mySrs - x.oppSrs + (x.site === 'H' ? hca(x.oppSrs) : x.site === 'A' ? -hca(opts.mySrs) : 0) : null;
      const diff = exp != null ? m - exp : null;
      html += `<tr class="${x.won ? 'w' : 'x'}${moCls(d.key)}" style="cursor:${x.href ? 'pointer' : 'default'}" onclick="${x.href ? `location.href='${x.href}'` : ''}">
        <td class="l dim tsp-d"><span class="tsp-dw">${d.dw} </span>${d.num}</td>
        <td class="dim tsp-rk">${x.rank || ''}</td>
        <td class="l nm tsp-o">${logoImg(x.opp)}<a href="team.html?team=${encodeURIComponent(sn(x.opp))}" onclick="event.stopPropagation()">${sn(x.opp)}</a>${x.conf ? '<i class="cfdot" title="conference game"></i>' : ''}</td>
        <td class="c strong tsp-sc">${x.won ? 'W' : 'L'} ${x.ms}–${x.os}</td>
        <td class="c tsp-site">${x.site}</td>
        <td class="c tsp-q">${q ? 'Q' + q : ''}</td>
        <td class="tsp-pr">${x.oppSrs != null ? sg(x.oppSrs) : ''}</td>
        <td class="tsp-line" title="expected margin from the two Power Ratings + venue">${exp != null ? sg(exp) : ''}</td>
        <td class="tsp-pm" title="actual margin vs expected">${diff != null ? sg(diff) : ''}</td>
        <td class="tsp-line">${x.rec}</td>${opts.whatIf ? '<td class="tsp-pk"></td>' : ''}</tr>`;
    });
    host.innerHTML = `<div class="tsp"><div class="sheet-wrap tsp-wrap"><table class="sheet dense tsp-table"><thead><tr>
      <th class="l">Date</th><th title="opponent's rank">Rk</th><th class="l">Opponent</th><th class="c">Result</th><th class="c" title="H home · A away · N neutral">Site</th><th class="c" title="NET-style quadrant">Quad</th><th title="opponent's Power Rating that season">Opp PRtg</th><th title="expected margin (Power Ratings + venue)">Exp</th><th data-heat="1" title="actual margin minus expected">+/−</th><th>Record</th>
    </tr></thead><tbody>${html}</tbody></table></div></div>`;
    shade(host);
  }

  // One game's pregame line from the HOME team's side — the same deterministic pricing project()
  // uses per game (ratings gap × stretch × pace, venue edge, rest), for the live scores layer.
  // q = {id, home, away, neutral, date} with ESPN full names; the listed game (by ESPN id) wins.
  async function lineFor(q) {
    await load();
    if (!g.TDC_RATINGS) return null;
    const D = await g.TDC_RATINGS.get();
    const rowOf = n => D.teams.find(t => t.full === n) || null;
    const listed = q.id != null ? allGames().find(r => String(r.id) === String(q.id)) : null;
    const x = listed || { id: q.id, date: q.date, home: q.home, away: q.away, neutral: !!q.neutral };
    buildRates(D);
    const H0 = rowOf(x.home), A0 = rowOf(x.away);
    if (!H0 || !A0) return null;
    const H = Object.assign({}, H0, { rating: rateOf(x.home, H0) }), A = Object.assign({}, A0, { rating: rateOf(x.away, A0) });
    const STRETCH = g.TDC_RATINGS.GAP_STRETCH || 1, SIGMA = g.TDC_RATINGS.SIGMA || 11;
    const venue = x.neutral ? 0 : g.TDC_RATINGS.baseHca(A.rating) + (H.hcaOff || 0);
    let sit = 0;
    if (listed) {                                   // rest / road stint only when both slates are known
      const all = allGames();
      const wh = (_walkCache[x.home] = _walkCache[x.home] || walk(x.home, all))[x.date];
      const wa = (_walkCache[x.away] = _walkCache[x.away] || walk(x.away, all))[x.date];
      if (wh && wa) sit = restPts(wh.rest) - restPts(wa.rest) + stintPts(wh.stint) - stintPts(wa.stint);
    }
    const eff = effLine(x.home, x.away), paceK = eff ? eff.pace / _eff.avgT : 1;
    const margin = tame((H.rating - A.rating) * STRETCH * paceK + venue + sit);
    return { margin: +margin.toFixed(1), p: phi(margin / SIGMA), total: eff ? +eff.total.toFixed(1) : DEFAULT_TOTAL,
      home: H.team, away: A.team };
  }

  // shared simulation pieces for the conference-tournament projection (tdc-conftourney.js): the same
  // per-sim team strength draw every schedule uses, the hashed coins, and the 2026-27 league map
  const sim = { TAU, U, hkey, zTeam, leagueOf, members: () => _members, tame, phi, rate: rateOf, tau: tauOf, results: () => RES, resultsMeta: () => _results && { updated: _results.updated, n: (_results.games || []).length } };
  g.TDCSched = { load, project, projectAll, render, renderPast, gamesFor, extrasFor, lineFor, SEASON, sim };
})(window);
