/* tdc-plays.js — one ESPN men's college basketball game → searchable plays, each with:
 *   wpa   win probability added for the team that made the play (the live model in
 *         tdc-live.js: home margin ~ Normal(margin + spread·f + ball, 13.5·f^0.4), with the ball
 *         worth about a point to whoever has it, so steals and turnovers move it too)
 *   xpts  expected points of a shot: the D-I make rate from that spot (the ten shot-chart
 *         zones, per season, scripts/data/shot_zone_ref.json) × its value; by shot type when
 *         ESPN has no location. poe = points scored − xpts.
 * Pregame spread = season Power Rating gap + 3.7 at home (same as the live pages for past
 * seasons). Works in the browser (window.TDC_PLAYS) and in Node (module.exports) so the
 * standout-play batch (scripts/build_plays_top.mjs) uses the exact same numbers.
 */
(function (root) {
  'use strict';
  const SD = 13.5, EXP = 0.4, REG = 2400, HALF = 1200, OTS = 300, BALL = 0.5, HFA = 3.7;   // ±0.5 = a one-point swing between having and not having the ball
  const HOOP_X = 25, HOOP_Y = 5.25, R3 = 22.15, CORNER_X = 3.35;
  const CORNER_Y = HOOP_Y + Math.sqrt(Math.max(0, R3 * R3 - (HOOP_X - CORNER_X) ** 2));
  // make rates when ESPN has no shot location (D-I, 2020-25 shot cache)
  const BY_TYPE = { dunk: 0.89, layup: 0.57, tip: 0.55, jumper: 0.36, three: 0.34, ft: 0.71 };

  function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
  function clockSecs(c) { const s = String(c == null ? '' : c).trim(); const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s); if (m) return +m[1] * 60 + +m[2]; const n = parseFloat(s); return isFinite(n) ? n : 0; }
  function shareLeft(p, secs) { if (p <= 2) return ((2 - p) * HALF + Math.min(HALF, secs)) / REG; return Math.min(OTS, secs) / REG; }
  /** Home win probability. poss: +1 home ball, -1 away ball, 0 loose/unknown. */
  function wpHome(spread, margin, frac, poss) {
    if (frac <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const f = Math.max(frac, 3 / REG);
    return Math.min(0.995, Math.max(0.005, Phi((margin + spread * f + BALL * poss) / (SD * Math.pow(f, EXP)))));
  }
  function zone10(x, y, sv) {       // mirror of tdc-shotchart.js (x across, y feet from the baseline)
    const d = Math.hypot(x - HOOP_X, y - HOOP_Y);
    if (sv === 3) { if (y <= CORNER_Y - 0.4) return x < HOOP_X ? 'c3l' : 'c3r'; return x < 19 ? 'w3l' : (x > 31 ? 'w3r' : 't3'); }
    if (d <= 4) return 'rim';
    if (x >= 19 && x <= 31 && y <= 19) return 'paint';
    return x < 19 ? 'midl' : (x > 31 ? 'midr' : 'midc');
  }

  /** Play kind from ESPN's type + text. */
  function kind(p) {
    const t = (p.type && p.type.text) || '', x = p.text || '';
    if (/free throw/i.test(x) || /FreeThrow/.test(t)) return 'ft';
    if (p.shootingPlay || /Shot$|Jumper|Layup|Dunk|Tip/i.test(t)) {
      if (p.pointsAttempted === 3 || /three point/i.test(x)) return 'three';
      if (/dunk/i.test(t + x)) return 'dunk';
      if (/tip/i.test(t + x)) return 'tip';
      if (/layup|lay up/i.test(t + x)) return 'layup';
      return 'jumper';
    }
    if (/turnover/i.test(t + ' ' + x)) return 'to';
    if (/steal/i.test(t)) return 'stl';
    if (/block/i.test(t)) return 'blk';
    if (/offensive rebound/i.test(t)) return 'oreb';
    if (/defensive rebound/i.test(t)) return 'dreb';
    if (/foul/i.test(t)) return 'foul';
    return null;                                     // timeouts, jump balls, period ends, dead-ball rebounds
  }

  /**
   * summary: ESPN summary JSON. opts: { srs: {teamId: power rating}, zones: {rim:{p},...} for the season }.
   * Returns { game, rows }. rows are plain objects (see below).
   */
  function parseGame(summary, opts) {
    opts = opts || {};
    const comp = (summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
    const cs = comp.competitors || [];
    const H = cs.find(c => c.homeAway === 'home') || cs[0] || {}, A = cs.find(c => c.homeAway === 'away') || cs[1] || {};
    const hid = String((H.team || {}).id || ''), aid = String((A.team || {}).id || '');
    const team = c => ({ id: String((c.team || {}).id || ''), abbr: (c.team || {}).abbreviation || '', name: (c.team || {}).location || (c.team || {}).displayName || '', score: +(c.score || 0) });
    const srs = opts.srs || {};
    const spread = srs[hid] != null && srs[aid] != null ? srs[hid] - srs[aid] + (comp.neutralSite ? 0 : HFA) : 0;
    const names = {};
    for (const t of (summary.boxscore && summary.boxscore.players) || []) for (const st of t.statistics || []) for (const a of st.athletes || []) {
      if (a.athlete && a.athlete.id) names[String(a.athlete.id)] = a.athlete.displayName || a.athlete.shortName || '';
    }
    const zones = opts.zones || null;
    const plays = summary.plays || [];
    const rows = [];
    let poss = 0, ph = 0, pa = 0, pf = 1;            // ball (+1 home / -1 away / 0 loose), score and time before the play
    const frac = p => shareLeft((p.period && p.period.number) || 1, clockSecs(p.clock && p.clock.displayValue));
    for (let i = 0; i < plays.length; i++) {
      const p = plays[i], k = kind(p);
      const per = (p.period && p.period.number) || 1, clock = (p.clock && p.clock.displayValue) || '';
      const hs = +p.homeScore || 0, as = +p.awayScore || 0;
      const tid = String((p.team && p.team.id) || '');
      const sign = tid === hid ? 1 : tid === aid ? -1 : 0;
      const f0 = frac(p);
      // "before" is the state after the previous play (a buzzer-beater is taken with time on the clock)
      const w0 = wpHome(spread, ph - pa, Math.max(f0, 2 / REG, Math.min(pf, f0 + 10 / REG)), poss);
      // who has the ball after this play
      let next = poss;
      if (k === 'dreb' || k === 'oreb' || k === 'stl') next = sign;
      else if (k === 'to') next = -sign;
      else if (k && k !== 'ft' && k !== 'foul' && k !== 'blk') next = p.scoringPlay ? -sign : 0;
      else if (k === 'ft') next = p.scoringPlay && !/1 of 2|2 of 3|1 of 3/i.test(p.text || '') ? -sign : 0;
      else if (k === 'blk') next = 0;
      const last = i === plays.length - 1;
      const w1 = last ? (hs > as ? 1 : hs < as ? 0 : 0.5) : wpHome(spread, hs - as, f0, next);
      poss = next; ph = hs; pa = as; pf = f0;
      if (!k || !sign) continue;
      const parts = (p.participants || []).map(x => String((x.athlete || {}).id || '')).filter(Boolean);
      const shot = ['three', 'jumper', 'layup', 'dunk', 'tip', 'ft'].includes(k);
      const sv = k === 'ft' ? 1 : k === 'three' ? 3 : 2;
      let xpts = null, zone = null, x = null, y = null, dist = null;
      if (shot) {
        const c = p.coordinate;
        if (k !== 'ft' && c && c.x != null && c.x >= 0 && c.x <= 50 && c.y != null && c.y >= 0) {
          x = +c.x; y = +c.y + HOOP_Y;                 // ESPN: feet from the basket → feet from the baseline
          zone = zone10(x, y, sv);
          dist = Math.round(Math.hypot(x - HOOP_X, y - HOOP_Y));
        }
        const rate = zone && zones && zones[zone] ? zones[zone].p : BY_TYPE[k];
        xpts = +(rate * sv).toFixed(3);
      }
      const made = shot ? !!p.scoringPlay : null;
      rows.push({
        seq: String(p.sequenceNumber || p.id || i), per, clock, secs: Math.round(f0 * REG), team: tid, opp: sign > 0 ? aid : hid,
        kind: k, text: p.text || '', pid: parts[0] || null, pname: names[parts[0]] || null, aid: parts[1] || null, aname: names[parts[1]] || null,
        made, sv: shot ? sv : null, xpts, poe: shot ? +((made ? sv : 0) - xpts).toFixed(3) : null, zone, dist,
        hs, as, wpa: +((w1 - w0) * sign).toFixed(4), wp: +((sign > 0 ? w1 : 1 - w1)).toFixed(3),
        margin: (hs - as) * sign, ast: /assisted by/i.test(p.text || ''),
      });
    }
    return {
      game: { id: String((summary.header || {}).id || comp.id || ''), date: comp.date || null, home: team(H), away: team(A), neutral: !!comp.neutralSite, spread: +spread.toFixed(1) },
      rows,
    };
  }

  const KINDS = { three: '3PT', jumper: '2PT jumper', layup: 'Layup', dunk: 'Dunk', tip: 'Tip-in', ft: 'Free throw', to: 'Turnover', stl: 'Steal', blk: 'Block', oreb: 'Off. rebound', dreb: 'Def. rebound', foul: 'Foul' };
  const api = { parseGame, wpHome, zone10, kind, clockSecs, KINDS, HFA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TDC_PLAYS = api;
})(typeof window !== 'undefined' ? window : globalThis);
