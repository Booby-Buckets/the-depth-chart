/* tdc-live.js — live scores + live win probability (no dependencies).
 *
 * Reads ESPN's keyless college-basketball scoreboard / summary straight from the browser
 * (they send Access-Control-Allow-Origin: *), polls every 20s while a game is live and every
 * 5 min otherwise, and pauses while the tab is hidden. sw.js never caches these (network-only).
 *
 *   TDC_LIVE.subscribe(fn)        fn({at, day, games:[game…]}) on every scoreboard poll; returns unsubscribe
 *   TDC_LIVE.winProb(o)           home win probability, o = {spread, margin, period, clock} (or frac)
 *   TDC_LIVE.summary(id)          one game in detail (plays, box) — Promise
 *   TDC_LIVE.watchGame(id, fn)    polls summary(id) (20s live / 60s pregame / stops once final); returns stop()
 *   TDC_LIVE.pregame(game)        Promise → {margin (home, pts), p, src} TDC pregame line, or null
 *
 * game = {id, date, state 'pre'|'in'|'post', detail, period, clock, neutral, conf, tv,
 *         home:{id, abbr, name, loc, score, rank, logo, color}, away:{…}, poss (team id|null), lastPlay}
 *
 * WIN PROBABILITY (scripts/calibrate_live_wp.py, every play of 314 2025-26 D-I games vs the
 * closing line, picked by log loss — table in scripts/data/live_wp_calibration.json):
 *   home final margin ~ Normal(mu, SD * f^EXP),  mu = margin + pregame spread * f,
 *   f = share of regulation left (2 × 20:00; in OT the OT clock / 2400).
 *   SD 13.5, EXP 0.4 (log loss .4032; the pure random walk EXP .5 wants SD 15.5, .4042) —
 *   late leads are less safe than a random walk says (fouling, end-of-game variance).
 *   Clamped to 1–99% while the game is on.
 *
 * TEST MODE (offseason): ?livetest=1 feeds scripts/data/live-fixture-scoreboard.json +
 * live-fixture-summary.json (real Feb 14 2026 games cut mid-game); ?livetest=replay also
 * advances each fixture game a few plays per poll. ?livedate=YYYYMMDD shows that day's real slate.
 */
(function (g) {
  'use strict';
  const HOSTS = ['https://site.web.api.espn.com', 'https://site.api.espn.com'];
  const BASE = '/apis/site/v2/sports/basketball/mens-college-basketball';
  const SD = 13.5, EXP = 0.4, REG = 2400, HALF = 1200, OT = 300;
  const FAST = 20000, SLOW = 300000;
  const qs = new URLSearchParams(g.location ? g.location.search : '');
  const TEST = qs.get('livetest');                 // '1' | 'replay' | null
  const DATE = /^\d{8}$/.test(qs.get('livedate') || '') ? qs.get('livedate') : null;
  const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

  // ── ESPN fetch (host fallback, never cached) ─────────────────────────────
  async function espn(path) {
    let err;
    for (const h of HOSTS) {
      try {
        const r = await fetch(h + BASE + path, { cache: 'no-store' });
        if (r.ok) return await r.json();
        err = new Error('espn ' + r.status);
      } catch (e) { err = e; }
    }
    throw err;
  }
  let _fx = null, _replay = 0;
  function fixtures() {
    if (!_fx) _fx = Promise.all([
      fetch('scripts/data/live-fixture-scoreboard.json?v=1', { cache: 'no-store' }).then(r => r.json()),
      fetch('scripts/data/live-fixture-summary.json?v=1', { cache: 'no-store' }).then(r => r.json()),
    ]).then(([sb, sum]) => ({ sb, sum }));
    return _fx;
  }

  // ── time / clock ─────────────────────────────────────────────────────────
  function clockSecs(clock) {
    const s = String(clock == null ? '' : clock).trim();
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return +m[1] * 60 + +m[2];
    const n = parseFloat(s);                       // under a minute ESPN can send "45.2"
    return isFinite(n) ? n : 0;
  }
  // share of the game left: regulation seconds / 2400; in OT the OT clock / 2400
  function shareLeft(period, clock) {
    const p = +period || 0, c = clockSecs(clock);
    if (p <= 0) return 1;
    if (p <= 2) return ((2 - p) * HALF + Math.min(HALF, c)) / REG;
    return Math.min(OT, c) / REG;
  }
  function etDay(d) {                              // YYYYMMDD in US Eastern
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    return f.format(d || new Date()).replace(/-/g, '');
  }

  // ── win probability ──────────────────────────────────────────────────────
  function erf(x) {                                // Abramowitz-Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
  function winProb(o) {
    const spread = +o.spread || 0, margin = +o.margin || 0;
    const frac = o.frac != null ? o.frac : shareLeft(o.period, o.clock);
    if (frac <= 0) {                               // buzzer: decided unless tied (→ OT)
      if (margin !== 0) return o.clamp === false ? (margin > 0 ? 1 : 0) : (margin > 0 ? 0.99 : 0.01);
      return 0.5;
    }
    const f = Math.max(frac, 3 / REG);
    const p = Phi((margin + spread * f) / (SD * Math.pow(f, EXP)));
    return o.clamp === false ? p : Math.min(0.99, Math.max(0.01, p));
  }

  // ── normalizers ──────────────────────────────────────────────────────────
  function side(c) {
    const t = c.team || {};
    return {
      id: String(t.id || c.id || ''), abbr: t.abbreviation || '', name: t.displayName || t.location || '',
      loc: t.location || t.shortDisplayName || '', short: t.shortDisplayName || t.location || '',
      score: c.score != null && c.score !== '' ? +(typeof c.score === 'object' ? c.score.value : c.score) : null,
      rank: c.curatedRank && c.curatedRank.current && c.curatedRank.current <= 25 ? c.curatedRank.current : (c.rank && +c.rank <= 25 ? +c.rank : null),
      logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || (t.id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png` : ''),
      color: t.color ? '#' + t.color : null, record: (c.records && c.records[0] && c.records[0].summary) || (c.record && c.record[0] && c.record[0].summary) || null,
      halves: (c.linescores || []).map(x => +(x.value != null ? x.value : x.displayValue) || 0),
    };
  }
  function normEvent(e) {
    const c = e.competitions[0], st = c.status || e.status || {}, ty = st.type || {};
    const s = {}; c.competitors.forEach(x => { s[x.homeAway] = x; });
    const sit = c.situation || {};
    const bc = (c.broadcasts || []).flatMap(b => b.names || []);
    return {
      id: String(e.id), date: e.date || c.date, state: ty.state || 'pre', detail: ty.shortDetail || ty.detail || '',
      period: st.period || 0, clock: st.displayClock || '', timeValid: c.timeValid !== false, neutral: !!c.neutralSite, conf: !!c.conferenceCompetition,
      tv: bc[0] || null, home: side(s.home), away: side(s.away),
      poss: sit.possession ? String(sit.possession) : null,
      lastPlay: sit.lastPlay && sit.lastPlay.text || null,
      note: (c.notes && c.notes[0] && c.notes[0].headline) || null,
    };
  }
  function normSummary(d, id) {
    const comp = d.header.competitions[0], st = comp.status || {}, ty = st.type || {};
    const s = {}; comp.competitors.forEach(x => { s[x.homeAway] = x; });
    const home = side(s.home), away = side(s.away);
    const plays = (d.plays || []).filter(p => p.period && p.period.number).map(p => ({
      seq: String(p.sequenceNumber || p.id), q: p.period.number, clock: p.clock && p.clock.displayValue || '',
      hs: +p.homeScore || 0, as: +p.awayScore || 0, text: p.text || '', type: p.type && p.type.text || '',
      score: !!p.scoringPlay, pts: +p.scoreValue || 0, team: p.team && p.team.id ? String(p.team.id) : null,
    }));
    const last = plays[plays.length - 1];
    const box = (d.boxscore && d.boxscore.teams || []).map(t => ({
      id: String(t.team.id), stats: (t.statistics || []).map(x => [x.label, x.displayValue]),
    }));
    const players = (d.boxscore && d.boxscore.players || []).map(tp => {
      const sx = (tp.statistics || [])[0] || {};
      return {
        id: String(tp.team.id), labels: sx.labels || sx.names || [], totals: sx.totals || [],
        athletes: (sx.athletes || []).map(a => ({
          id: String(a.athlete.id), name: a.athlete.displayName, short: a.athlete.shortName, jersey: a.athlete.jersey || '',
          pos: a.athlete.position && a.athlete.position.abbreviation || '', starter: !!a.starter, dnp: !!a.didNotPlay || !(a.stats || []).length,
          stats: a.stats || [],
        })),
      };
    });
    let poss = null;
    comp.competitors.forEach(x => { if (x.possession) poss = String(x.team.id); });
    const pc = (d.pickcenter || [])[0];
    return {
      id: String(id || comp.id || d.header.id), state: ty.state || 'pre', detail: ty.shortDetail || ty.detail || '',
      period: st.period || (last ? last.q : 0), clock: st.displayClock || (last ? last.clock : ''),
      date: comp.date, neutral: !!comp.neutralSite, conf: !!comp.conferenceCompetition, home, away, poss, plays, box, players,
      venue: d.gameInfo && d.gameInfo.venue ? d.gameInfo.venue.fullName : null,
      market: pc && pc.spread != null ? -pc.spread : null,
    };
  }

  // replay mode: walk each fixture game forward a few plays per poll
  function replayCut(d, id) {
    const all = d.plays || [];
    const n = Math.min(all.length, Math.max(20, Math.round(all.length * 0.35)) + _replay * 6);
    const plays = all.slice(0, n), last = plays[plays.length - 1];
    const out = JSON.parse(JSON.stringify(d));
    out.plays = plays;
    const hc = out.header.competitions[0];
    hc.status = { period: last.period.number, displayClock: last.clock.displayValue,
      type: { state: 'in', shortDetail: `${last.clock.displayValue} - ${last.period.number === 1 ? '1st' : last.period.number === 2 ? '2nd' : 'OT'}${last.period.number <= 2 ? ' Half' : ''}` } };
    hc.competitors.forEach(x => {
      const k = x.homeAway === 'home' ? 'homeScore' : 'awayScore', byQ = [];
      plays.forEach(p => { byQ[p.period.number - 1] = p[k]; });
      x.score = String(last[k]);
      x.linescores = byQ.map((v, i) => ({ value: (v || 0) - (i ? (byQ[i - 1] || 0) : 0) }));
    });
    return out;
  }

  // ── scoreboard poller ────────────────────────────────────────────────────
  const subs = new Set();
  let timer = null, last = null, inflight = false;
  async function fetchBoard() {
    if (TEST) {
      const { sb, sum } = await fixtures();
      const games = sb.events.map(normEvent);
      if (TEST === 'replay') games.forEach(x => {
        if (sum[x.id]) { const n = normSummary(replayCut(sum[x.id], x.id), x.id);
          Object.assign(x, { state: n.state, detail: n.detail, period: n.period, clock: n.clock });
          x.home.score = n.home.score; x.away.score = n.away.score; }
      });
      return { at: new Date().toISOString(), day: DATE || '20260214', test: true, games };
    }
    const day = DATE || etDay();
    const d = await espn(`/scoreboard?groups=50&limit=400&dates=${day}`);
    return { at: new Date().toISOString(), day, games: (d.events || []).map(normEvent) };
  }
  function nextDelay(data) {
    if (TEST) return TEST === 'replay' ? 5000 : FAST;
    if (!data) return 60000;
    const now = Date.now();
    const hot = data.games.some(x => x.state === 'in' || (x.state === 'pre' && new Date(x.date).getTime() - now < 10 * 60000 && new Date(x.date).getTime() - now > -6 * 3600000));
    return hot ? FAST : SLOW;
  }
  async function poll() {
    clearTimeout(timer); timer = null;
    if (!subs.size) return;
    if (document.hidden && last && !TEST) return;  // paused in a background tab; resumes on visibilitychange
    if (inflight) return;
    inflight = true;
    try { last = await fetchBoard(); if (TEST === 'replay') _replay++; subs.forEach(fn => { try { fn(last); } catch (e) { console.error(e); } }); }
    catch (e) { /* network hiccup: keep the last board, retry on the slow-ish path */ }
    inflight = false;
    if (subs.size) timer = setTimeout(poll, nextDelay(last));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && subs.size && !inflight) poll(); });
  function subscribe(fn) {
    subs.add(fn);
    if (last) { try { fn(last); } catch (e) { console.error(e); } }
    if (!timer && !inflight) poll();
    return () => { subs.delete(fn); if (!subs.size) { clearTimeout(timer); timer = null; } };
  }

  // ── one game ─────────────────────────────────────────────────────────────
  async function summary(id) {
    if (TEST) {
      const { sum } = await fixtures();
      if (sum[id]) return normSummary(TEST === 'replay' ? replayCut(sum[id], id) : sum[id], id);
    }
    return normSummary(await espn(`/summary?event=${encodeURIComponent(id)}`), id);
  }
  function watchGame(id, fn) {
    let stop = false, t = null, seen = false;
    async function tick() {
      if (stop) return;
      if (document.hidden && seen && !TEST) { t = setTimeout(tick, 5000); return; }   // background tab: idle-check only
      seen = true;
      let again = SLOW;
      try {
        const d = await summary(id);
        if (!stop) fn(d, null);
        again = d.state === 'in' ? (TEST === 'replay' ? 5000 : FAST) : d.state === 'pre' ? 60000 : 0;
        if (TEST === 'replay') _replay++;
      } catch (e) { console.error("tdc-live", e); if (!stop) fn(null, e); again = 30000; }
      if (again && !stop) t = setTimeout(tick, again);
    }
    tick();
    return () => { stop = true; clearTimeout(t); };
  }

  // ── pregame line ─────────────────────────────────────────────────────────
  // 2026-27 on: tdc-schedule's per-game pricing (ratings + venue + rest), else the bare
  // TDC_RATINGS line. Earlier seasons (testing on past dates): that season's Power Rating gap.
  const _srs = {};
  function seasonOf(date) { const d = new Date(date); return d.getUTCMonth() >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(); }
  async function srsFor(season) {
    if (!_srs[season]) _srs[season] = fetch(`${SB}/rest/v1/team_seasons?season_year=eq.${season}&srs=not.is.null&select=team,srs`,
      { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).then(r => r.ok ? r.json() : []).then(rows => {
      const m = {}; (rows || []).forEach(x => { m[x.team] = +x.srs; }); return m; }).catch(() => ({}));
    return _srs[season];
  }
  const _lines = {};
  function pregame(x) {
    if (_lines[x.id]) return _lines[x.id];
    _lines[x.id] = (async () => {
      const season = seasonOf(x.date);
      const RT = g.TDC_RATINGS;
      if (season >= (RT && RT.SEASON || 2027)) {
        if (g.TDCSched && g.TDCSched.lineFor) {
          const l = await g.TDCSched.lineFor({ id: x.id, home: x.home.name, away: x.away.name, neutral: x.neutral, date: (x.date || '').slice(0, 10) }).catch(() => null);
          if (l) return { margin: l.margin, p: l.p, src: 'tdc', homeKey: l.home, awayKey: l.away };
        }
        if (RT) {
          const D = await RT.get(); const rowOf = n => D.teams.find(t => t.full === n);
          const H = rowOf(x.home.name), A = rowOf(x.away.name);
          if (H && A) { const l = RT.lineFor(H, A, x.neutral ? 'neutral' : 'home'); return { margin: l.margin, p: l.probA / 100, src: 'tdc', homeKey: H.team, awayKey: A.team }; }
        }
        return null;
      }
      const m = await srsFor(season), h = m[x.home.name], a = m[x.away.name];
      if (h == null || a == null) return null;
      const margin = +(h - a + (x.neutral ? 0 : 3.7)).toFixed(1);
      return { margin, p: Phi(margin / 11), src: 'srs' };
    })();
    return _lines[x.id];
  }

  g.TDC_LIVE = { subscribe, winProb, shareLeft, clockSecs, summary, watchGame, pregame, normEvent, normSummary,
    etDay, test: TEST, date: DATE, SD, EXP, get last() { return last; } };
})(window);
